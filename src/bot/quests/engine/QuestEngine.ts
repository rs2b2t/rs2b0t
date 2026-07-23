import { actions, reader } from '../../adapter/ClientAdapter.js';
import { type Task } from '../../api/Bot.js';
import { EventSignal } from '../../api/EventSignal.js';
import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import Tile from '../../api/Tile.js';
import { Bank } from '../../api/hud/Bank.js';
import { ChatDialog } from '../../api/hud/ChatDialog.js';
import { Equipment } from '../../api/hud/Equipment.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { Quests } from '../../api/hud/Quests.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import { evaluate } from '../EligibilityEvaluator.js';
import { QUEST_DEFS, defById } from '../defs/index.js';
import { executeStep } from '../exec/steps.js';
import type { BankInventorySnapshot, PlayerState, QuestEligibility, QuestRecord } from '../types.js';
import { coinFloatWithdraw, depositPlan, floatWithdraw, planProvisioning } from './provisioning.js';
import { nextQuest, queueRows, type QueueRow } from './queue.js';
import type { QuestModule, QuestSnapshot, QuestStep } from './types.js';
import { NO_PROGRESS_PARK, NO_PROGRESS_WARN, ProgressWatchdog, progressSignature } from './watchdog.js';
import type AIOQuester from '../../scripts/AIOQuester.js';

const PARK_GIVE_UP = 3;

const WAIT_PARK = 15;

export const COIN_FLOAT = 1000;

export const PROVISION_BANK = new Tile(3093, 3243, 0);

import { Skills } from '../../api/hud/Skills.js';

function advancesWorld(step: QuestStep): boolean {
    return step.kind !== 'wait' && step.kind !== 'done';
}

function describeStep(step: QuestStep): string {
    switch (step.kind) {
        case 'talk': return `talk to ${step.stop.npc}`;
        case 'grabGround': return `grab ${step.item}`;
        case 'pickLoc': return `${step.op} ${step.loc}`;
        case 'interactLoc': return `${step.op} ${step.loc}`;
        case 'useOn': return `use ${step.item} on ${step.target}`;
        case 'equip': return `equip ${step.item}`;
        case 'withdraw': return `withdraw ${step.items.map(i => `${i.name}×${i.qty}`).join(', ')}`;
        case 'deposit': return 'bank spillover from the last quest';
        case 'mineRock': return `mine ${step.item}`;
        case 'buy': return `buy ${step.qty}× ${step.item} from ${step.shop.npc}`;
        case 'custom': return step.name;
        case 'wait': return step.reason;
        case 'done': return 'done';
    }
}

export class QuestEngine implements Task {
    private readonly order = QUEST_DEFS.map(d => d.record.id);
    private readonly records: QuestRecord[] = QUEST_DEFS.map(d => d.record);

    private readonly watchdog = new ProgressWatchdog();
    private noProgressCount = 0;

    private readonly parked = new Set<string>();
    private readonly parkCounts = new Map<string, number>();
    private readonly parkedReasons = new Map<string, string[]>();
    private readonly provisioned = new Set<string>();
    private readonly deposited = new Set<string>();
    private readonly blocked = new Map<string, string[]>();

    private lastBankCounts = new Map<string, number>();

    private runningId: string | null = null;

    private waitKey = '';
    private waitCount = 0;

    private lastStepLogged = '';

    private readonly stepSubLog = new Set<string>();

    constructor(private readonly host: AIOQuester) {}

    validate(): boolean {
        return !ChatDialog.canContinue() && Game.tile() !== null;
    }

    async execute(): Promise<void> {
        if (EventSignal.pending()) {
            await Execution.delayTicks(1);
            return;
        }

        if (reader.modals().main !== -1 && !Bank.isOpen() && !ChatDialog.isMakeMenu() && !ChatDialog.isMainMakePanel()) {
            if (actions.closeModal()) {
                this.host.log('closed a leftover main modal (quest-complete scroll)');
                await Execution.delayTicks(1);
                return;
            }
        }

        const picked = this.host.pickedIds();

        this.refreshBankCounts();
        const player = this.readPlayerState();
        const itemSnap = this.readItemSnapshot();
        const elig = new Map<string, QuestEligibility>();
        for (const r of this.records) {
            elig.set(r.id, evaluate(r, player, itemSnap, Quests.status(r.name)));
        }

        const skip = this.host.consumeSkip();
        if (skip && this.runningId !== null) {
            this.host.log(`skip requested — parking ${this.nameOf(this.runningId, elig)}`);
            this.parked.add(this.runningId);
            this.resetWatchdog();
            this.runningId = null;
        }

        if (this.host.consumeDeath() && this.runningId !== null) {
            const dead = this.nameOf(this.runningId, elig);
            this.host.log(`died during ${dead} — re-provisioning and resuming`);
            this.provisioned.delete(this.runningId);
            this.deposited.delete(this.runningId);
            this.resetWatchdog();
            this.waitKey = '';
            this.waitCount = 0;
            return;
        }

        if (this.runningId === null) {
            const selectable = new Set([...picked].filter(id => !this.blocked.has(id)));
            this.runningId = nextQuest(this.order, selectable, elig, this.parked);
        }
        const rows = this.applyBlocked(queueRows(this.order, picked, elig, this.parked, this.runningId));

        if (this.runningId === null) {
            this.host.noteState(rows, null, 'queue drained', this.noProgressCount, this.parked.size);
            this.host.log('queue drained — nothing left to run:');
            for (const r of rows) {
                this.host.log(`  ${r.name}: ${r.status}${r.reasons.length ? ' — ' + r.reasons.join('; ') : ''}`);
            }
            ScriptRunner.stop();
            return;
        }

        const id = this.runningId;
        const module = defById(id);
        if (!module) {
            this.host.log(`ERROR: no module for '${id}' — blocking`);
            this.block(id, ['internal: no module']);
            this.runningId = null;
            return;
        }
        const snap = this.buildSnapshot(module);

        if (snap.journal === 'complete') {
            this.host.log(`${module.record.name} COMPLETE — ${Quests.points()} QP`);
            this.parked.delete(id);
            this.parkedReasons.delete(id);
            this.parkCounts.delete(id);
            this.provisioned.delete(id);
            this.deposited.delete(id);
            this.blocked.delete(id);
            this.resetWatchdog();
            this.runningId = null;
            const done = this.applyBlocked(queueRows(this.order, picked, elig, this.parked, null));
            this.host.noteState(done, null, `${module.record.name} complete`, 0, this.parked.size);
            return;
        }

        let step: QuestStep;
        if (!this.deposited.has(id)) {
            const keep = [
                ...module.record.items.map(i => i.name.toLowerCase()),
                ...(module.tools ?? [])
            ];
            const spillover = depositPlan(snap.inv, keep);
            if (spillover.length === 0) {
                this.deposited.add(id);
            } else {
                this.host.noteState(rows, id, 'banking spillover', this.noProgressCount, this.parked.size);
                const banked = await executeStep({ kind: 'deposit', keep, bank: module.bank ?? PROVISION_BANK }, module.hops ?? [], m => this.host.log(`  ${m}`));
                if (banked) {
                    this.deposited.add(id);
                }
                this.refreshBankCounts();
                await Execution.delayTicks(1);
                return;
            }
        }
        if (!this.provisioned.has(id)) {
            const plan = planProvisioning(module.record.items, snap.inv, this.lastBankCounts);
            const coinFloat = coinFloatWithdraw(snap.inv, this.lastBankCounts, COIN_FLOAT);
            const foodItem = this.host.foodItem();
            const packFood = foodItem ? (snap.inv.get(foodItem.toLowerCase()) ?? 0) : 0;
            const foodFloat = (module.food && foodItem)
                ? (this.lastBankCounts.size > 0
                    ? floatWithdraw(snap.inv, this.lastBankCounts, foodItem, module.food)
                    : (module.food - packFood > 0 ? { name: foodItem, qty: module.food - packFood } : null))
                : null;
            const extras = [coinFloat, foodFloat].filter((w): w is { name: string; qty: number } => w !== null);
            if (plan.blocked.length > 0 && plan.withdraw.length === 0) {
                this.host.log(`${module.record.name} short on items: ${plan.blocked.join(', ')} — parking`);
                this.parkedReasons.set(id, plan.blocked.map(b => `missing: ${b}`));
                this.parkOrGiveUp(id, module.record.name);
                this.resetWatchdog();
                this.runningId = null;
                const blk = this.applyBlocked(queueRows(this.order, picked, elig, this.parked, null));
                this.host.noteState(blk, null, `parked: ${plan.blocked.join(', ')}`, this.noProgressCount, this.parked.size);
                return;
            } else if (plan.withdraw.length > 0 || extras.length > 0) {
                step = { kind: 'withdraw', items: [...plan.withdraw, ...extras], bank: module.bank ?? PROVISION_BANK };
            } else if (plan.satisfied) {
                this.provisioned.add(id);
                step = module.decide(snap);
            } else {
                const want = plan.gather[0];
                const gatherFn = module.gather?.[want.name.toLowerCase()];
                if (!gatherFn) {
                    this.host.log(`ERROR: ${module.record.name} needs '${want.name}' but has no gather fn (def bug)`);
                    this.block(id, [`def bug: no gather for ${want.name}`]);
                    this.runningId = null;
                    const bug = this.applyBlocked(queueRows(this.order, picked, elig, this.parked, null));
                    this.host.noteState(bug, null, `def bug: no gather for ${want.name}`, this.noProgressCount, this.parked.size);
                    return;
                }
                step = gatherFn(snap, want.need);
            }
        } else {
            step = module.decide(snap);
        }

        const stepDesc = describeStep(step);
        this.host.noteState(rows, id, stepDesc, this.noProgressCount, this.parked.size);
        const stepLine = `${module.record.name}: ${stepDesc}`;
        if (stepLine !== this.lastStepLogged) {
            this.host.log(stepLine);
            this.lastStepLogged = stepLine;
            this.stepSubLog.clear();
        }

        if (step.kind === 'wait') {
            const key = `${id}|${step.reason}`;
            this.waitCount = key === this.waitKey ? this.waitCount + 1 : 1;
            this.waitKey = key;
            if (this.waitCount >= WAIT_PARK) {
                this.host.log(`${module.record.name} waiting on '${step.reason}' with no way to resolve it — parking`);
                this.parkedReasons.set(id, [`waiting: ${step.reason}`]);
                this.parkOrGiveUp(id, module.record.name);
                this.resetWatchdog();
                this.runningId = null;
                this.waitKey = '';
                this.waitCount = 0;
                return;
            }
        } else {
            this.waitKey = '';
            this.waitCount = 0;
        }

        const ok = await executeStep(step, module.hops ?? [], m => {
            if (!this.stepSubLog.has(m)) {
                this.host.log(`  ${m}`);
                this.stepSubLog.add(m);
            }
        });

        if (ok && advancesWorld(step)) {
            const count = this.watchdog.note(progressSignature(this.buildSnapshot(module)));
            this.noProgressCount = count;
            if (count === NO_PROGRESS_WARN) {
                this.host.log(`WARN: ${count} steps with no progress on ${module.record.name} — check the decide()/prefer lists`);
            } else if (count >= NO_PROGRESS_PARK) {
                this.host.log(`no progress after ${count} steps on ${module.record.name}`);
                this.parkOrGiveUp(id, module.record.name);
                this.resetWatchdog();
                this.runningId = null;
            }
        }

        this.refreshBankCounts();
        await Execution.delayTicks(1);
    }

    private resetWatchdog(): void {
        this.watchdog.reset();
        this.noProgressCount = 0;
    }

    private block(id: string, reasons: string[]): void {
        this.blocked.set(id, reasons);
        this.resetWatchdog();
    }

    private parkOrGiveUp(id: string, name: string): void {
        const count = (this.parkCounts.get(id) ?? 0) + 1;
        this.parkCounts.set(id, count);
        if (count >= PARK_GIVE_UP) {
            this.host.log(`${name} parked ${PARK_GIVE_UP}x with no progress — giving up`);
            this.block(id, [`parked ${PARK_GIVE_UP}x with no progress — giving up`]);
            return;
        }
        this.host.log(`parking ${name} (park ${count}/${PARK_GIVE_UP})`);
        this.parked.add(id);
    }

    private applyBlocked(rows: QueueRow[]): QueueRow[] {
        return rows.map(r => {
            const blocked = this.blocked.get(r.id);
            if (blocked) {
                return { ...r, status: 'BLOCKED' as const, reasons: blocked };
            }
            const prov = this.parkedReasons.get(r.id);
            if (prov && r.status === 'PARKED') {
                return { ...r, reasons: prov };
            }
            return r;
        });
    }

    private nameOf(id: string, elig: Map<string, QuestEligibility>): string {
        return elig.get(id)?.name ?? id;
    }

    private buildSnapshot(module: QuestModule): QuestSnapshot {
        const inv = new Map<string, number>();
        for (const it of Inventory.items()) {
            if (it.name) {
                const key = it.name.toLowerCase();
                inv.set(key, (inv.get(key) ?? 0) + it.count);
            }
        }
        const worn = new Set<string>();
        for (const it of Equipment.items()) {
            if (it.name) {
                worn.add(it.name.toLowerCase());
            }
        }
        return {
            journal: Quests.status(module.record.name),
            inv,
            worn,
            noProgress: this.noProgressCount,
            bankCoins: this.lastBankCounts.get('coins') ?? 0
        };
    }

    private readPlayerState(): PlayerState {
        const skillNames = new Set<string>();
        for (const r of this.records) {
            for (const s of r.requirements.skills ?? []) {
                skillNames.add(s.skill);
            }
        }
        const skillLevels = new Map<string, number>();
        for (const name of skillNames) {
            skillLevels.set(name, Skills.level(name));
        }
        const completedQuests = new Set<string>();
        for (const r of this.records) {
            if (Quests.status(r.name) === 'complete') {
                completedQuests.add(r.id);
            }
        }
        return { questPoints: Quests.points(), skillLevels, completedQuests };
    }

    private readItemSnapshot(): BankInventorySnapshot {
        const wanted = new Set<string>();
        for (const r of this.records) {
            for (const it of r.items) {
                wanted.add(it.name);
            }
        }
        const counts = new Map<string, number>();
        for (const name of wanted) {
            const key = name.toLowerCase();
            counts.set(key, Inventory.count(name) + (this.lastBankCounts.get(key) ?? 0));
        }
        return { counts };
    }

    private refreshBankCounts(): void {
        if (!Bank.isOpen()) {
            return;
        }
        const next = new Map<string, number>();
        next.set('coins', Bank.count('Coins'));
        const food = this.host.foodItem();
        if (food) {
            next.set(food.toLowerCase(), Bank.count(food));
        }
        for (const r of this.records) {
            for (const it of r.items) {
                const key = it.name.toLowerCase();
                if (!next.has(key)) {
                    next.set(key, Bank.count(it.name));
                }
            }
        }
        this.lastBankCounts = next;
    }
}
