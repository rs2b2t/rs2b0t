// docs/reference/quest-engine.md#quest-state
import { reader } from '../../../../adapter/ClientAdapter.js';
import { type Task } from '../../../bot/Bot.js';
import { EventSignal } from '../../../execution/EventSignal.js';
import { Execution } from '../../../execution/Execution.js';
import { Game } from '../../../game/Game.js';
import Tile from '../../../../geometry/Tile.js';
import { Bank } from '../../../bank/Bank.js';
import { ChatDialog } from '../../../ui/dialogue/ChatDialog.js';
import { Equipment } from '../../../equipment/Equipment.js';
import { Inventory } from '../../../inventory/Inventory.js';
import { Modals } from '../../../ui/widgets/Modals.js';
import { Quests } from '../../../ui/questlog/Quests.js';
import { evaluate } from '../EligibilityEvaluator.js';
import { QUESTS } from '../data/quests.js';
import { QUEST_DEFS, defById } from '../defs/index.js';
import { executeStep } from '../exec/steps.js';
import type { BankInventorySnapshot, PlayerState, QuestEligibility, QuestRecord } from '../types.js';
import { coinFloatWithdraw, depositPlan, floatWithdraw, planProvisioning } from './provisioning.js';
import { nextQuest, queueRows, type QueueRow } from './queue.js';
import type { QuestModule, QuestProgress, QuestSnapshot, QuestStep } from './types.js';
import { NO_PROGRESS_PARK, NO_PROGRESS_WARN, ProgressWatchdog, progressSignature } from './watchdog.js';
import { FAIL_WARN, StepTracker, formatDuration, formatTile, invDelta } from './trace.js';
import { GameMessages } from '../../../chatbox/gameMessages.js';
/** What the engine needs from whatever script is driving it. */
export interface QuestHost {
    log(msg: string): void;
    verbose(): boolean;
    foodItem(): string | null;
    pickedIds(): Set<string>;
    skipPending(): boolean;
    consumeSkip(): boolean;
    consumeDeath(): boolean;
    noteState(rows: QueueRow[], runningId: string | null, stepDesc: string, noProgress: number, parked: number): void;
    /** Why: the engine reports that it is out of work; stopping the run is the script's call, not the engine's. */
    finish(reason: string): void;
}

const PARK_GIVE_UP = 3;

const WAIT_PARK = 15;

/** Walks back to a bank to try before leaving the character where it finished. */
const RETREAT_GIVE_UP = 4;

export const COIN_FLOAT = 1000;

export const PROVISION_BANK = new Tile(3093, 3243, 0);

import { Skills } from '../../../skills/Skills.js';

/** `'nearest'` means "let the step work it out from where the bot is standing". */
function bankFor(module: QuestModule): Tile | undefined {
    return module.bank === 'nearest' ? undefined : (module.bank ?? PROVISION_BANK);
}

/**
 * Main-modal roots the engine must not auto-close. Pack ids from
 * content/pack/interface.pack (rev 274).
 */
const INTERACTIVE_QUEST_MAIN: ReadonlySet<number> = new Set([
    6675, // death_dice — Harold gambling (Death Plateau)
    8119 // messagescroll_handwriting — combination after reading the IOU
]);

function isInteractiveQuestMainModal(mainId: number): boolean {
    return INTERACTIVE_QUEST_MAIN.has(mainId);
}

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
        case 'scanBank': return 'check the bank';
        case 'withdraw': return `withdraw ${step.items.map(i => `${i.name}×${i.qty}`).join(', ')}`;
        // Not always spillover from the previous quest any more — Family Crest
        // banks its coin float mid-quest before walking into the wilderness.
        case 'deposit': return `bank all but ${step.keep.length} kept item type(s)`;
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
    private readonly retreated = new Set<string>();
    private readonly retreatTries = new Map<string, number>();
    private readonly deposited = new Set<string>();
    private readonly blocked = new Map<string, string[]>();
    /** Modules that have already emitted {@link QuestModule.warnReadiness}. */
    private readonly readinessWarned = new Set<string>();

    private lastBankCounts = new Map<string, number>();
    private lastBankIdCounts = new Map<number, number>();
    private bankKnown = false;

    private runningId: string | null = null;

    private waitKey = '';
    private waitCount = 0;

    private lastStepLogged = '';

    private readonly stepSubLog = new Set<string>();

    private readonly tracker = new StepTracker();
    private tick = 0;
    private failStreak = 0;

    constructor(private readonly host: QuestHost) {}

    validate(): boolean {
        return !ChatDialog.canContinue() && Game.tile() !== null;
    }

    async execute(): Promise<void> {
        // Death participates in EventSignal, so consume it before checking that signal.
        if (await this.recoverDeathIfPending()) {
            return;
        }
        // Apply Skip before random-event yield so a mid-walk interrupt lands on
        // the next quest instead of spinning on EventSignal.pending().
        const skipEarly = this.host.skipPending();
        if (!skipEarly && EventSignal.pending()) {
            await Execution.delayTicks(1);
            return;
        }

        // StartupWithdraw and bank-aware quest steps deliberately leave the bank open so this
        // task can take an authoritative snapshot before the interface disappears.
        if (!skipEarly && Bank.isOpen()) {
            await Execution.delayUntil(() => Bank.loaded(), 3000);
            this.refreshBankCounts(true);
            await Modals.close();
            return;
        }

        // Why: quest-complete scrolls and similar leftovers sit on main and block the next decide() tick.
        // Why: interactive quest UIs also use main and are never auto-closed, as the Death Plateau dice and combination handwriting were being killed mid-step.
        const mainModal = reader.modals().main;
        if (
            !skipEarly
            && mainModal !== -1
            && !Bank.isOpen()
            && !ChatDialog.isMakeMenu()
            && !ChatDialog.isMainMakePanel()
            && !isInteractiveQuestMainModal(mainModal)
        ) {
            if (await Modals.close()) {
                this.host.log('closed a leftover main modal (quest-complete scroll)');
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
            this.applyUserSkip(this.runningId, elig);
        }

        if (this.runningId === null) {
            const selectable = new Set([...picked].filter(id => !this.blocked.has(id)));
            this.runningId = nextQuest(this.order, selectable, elig, this.parked);
        }
        const rows = this.applyBlocked(queueRows(this.order, picked, elig, this.parked, this.runningId));

        if (this.runningId === null) {
            this.host.noteState(rows, null, 'queue drained', this.noProgressCount, this.parked.size);
            for (const r of rows) {
                this.host.log(`  ${r.name}: ${r.status}${r.reasons.length ? ' — ' + r.reasons.join('; ') : ''}`);
            }
            this.host.finish('quest queue drained — nothing left to run (per-quest status logged above)');
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
        if (!this.readinessWarned.has(id) && module.warnReadiness) {
            this.readinessWarned.add(id);
            const note = module.warnReadiness();
            if (note) {
                this.host.log(`${module.record.name}: ${note}`);
            }
        }
        const progress = await module.readProgress?.();
        const stage = progress ? progress.stage : await module.readStage?.();
        const snap = this.buildSnapshot(module, stage, progress);

        if (module.ownsInventory) {
            // Some quests have one-way, bankless areas. Their stage oracle must run before any
            // generic attempt to bank spillover or provision items on the mainland.
            this.deposited.add(id);
            this.provisioned.add(id);
        }

        if (snap.journal === 'complete') {
            // Why: these quests end in a dragon's lair, a wilderness, a dungeon, and a bot dropped where it stood logs out there, or does not, and dies there.
            // Why: the job is done when the character is standing at a bank.
            if (!this.retreated.has(id) && !(await this.retreatToBank(module, id, rows))) {
                return;
            }
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
            const foodName = this.host.foodItem()?.toLowerCase();
            const keep = [
                ...module.record.items.map(i => i.name.toLowerCase()),
                ...(module.tools ?? []).map(t => t.toLowerCase()),
                ...(foodName ? [foodName] : [])
            ];
            const spillover = depositPlan(snap.inv, keep);
            if (spillover.length === 0) {
                this.deposited.add(id);
            } else {
                this.host.noteState(rows, id, 'banking spillover', this.noProgressCount, this.parked.size);
                const banked = await executeStep({ kind: 'deposit', keep, bank: bankFor(module), leaveOpen: true }, module.hops ?? [], m => this.host.log(`  ${m}`));
                if (banked) {
                    this.deposited.add(id);
                }
                await Execution.delayUntil(() => Bank.loaded(), 3000);
                this.refreshBankCounts(true);
                await Modals.closeIfOpen();
                return;
            }
        }
        if (!this.provisioned.has(id)) {
            const plan = planProvisioning(module.record.items, snap.inv, this.lastBankCounts);
            // Why: a quest that fetches coins at the point of sale wants no float, as this runs every loop while anything is outstanding and a standing balance is restored after every purchase.
            const coinFloat = coinFloatWithdraw(snap.inv, this.lastBankCounts, module.coinFloat ?? COIN_FLOAT);
            const foodItem = this.host.foodItem();
            // Only withdraw food once the bank inventory is known — guessing a
            // shortfall forces a failed booth trip and can scramble a full pack.
            const foodReady = module.foodReady?.(snap) ?? true;
            const foodFloat = (module.food && foodItem && this.bankKnown && foodReady)
                ? floatWithdraw(snap.inv, this.lastBankCounts, foodItem, module.food)
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
                step = { kind: 'withdraw', items: [...plan.withdraw, ...extras], bank: bankFor(module) };
            } else if (plan.satisfied) {
                // Why: holding the food back is not being provisioned — closing the block here would
                // retire it for the run and the quest would fight on an empty stomach.
                if (foodReady) {
                    this.provisioned.add(id);
                }
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

        const verbose = this.host.verbose();
        const now = Date.now();
        const attempt = this.tracker.open(`${id}|${stepDesc}`, now);
        const stepLine = `${module.record.name}: ${stepDesc}`;
        const fresh = stepLine !== this.lastStepLogged;
        // Why: a leg that keeps re-deciding to the same step is the normal way this engine loops, so silence on the repeat is the default.
        // Why: the heartbeat is what stops a long chain — mine, smelt, hammer, all called `smith 8 nails` — from looking like a hang.
        const announce = verbose || fresh || this.tracker.beat(now);
        if (announce) {
            const context = `stage ${snap.stage ?? '?'} · ${formatTile(snap.tile)} · ${snap.freeSlots} free`;
            const repeat = attempt > 1
                ? ` — attempt ${attempt}, ${formatDuration(this.tracker.elapsed(now))} on this step`
                : '';
            this.host.log(`${verbose ? `[t${++this.tick}] ` : ''}${stepLine}${repeat} · ${context}`);
            this.lastStepLogged = stepLine;
            this.stepSubLog.clear();
            if (module.observe) {
                for (const line of module.observe(snap, step)) {
                    this.host.log(`  ${line}`);
                }
            }
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

        const bankAwareStep: QuestStep = step.kind === 'withdraw' || step.kind === 'deposit'
            ? { ...step, leaveOpen: true }
            : step;
        const startedAt = Date.now();
        const ok = await executeStep(bankAwareStep, module.hops ?? [], m => {
            // Verbose keeps the repeats: a sub-log that fires once per rock is the
            // record of a mining leg, and de-duping it erases the leg.
            if (verbose) {
                this.host.log(`  ${m}`);
                return;
            }
            if (!this.stepSubLog.has(m)) {
                this.host.log(`  ${m}`);
                this.stepSubLog.add(m);
            }
        });
        const took = Date.now() - startedAt;

        // Why: a cooperative step may have returned because death interrupted it.
        if (await this.recoverDeathIfPending()) {
            return;
        }

        if (announce || !ok) {
            const after = this.buildSnapshot(module, stage, progress);
            this.host.log(`  → ${ok ? 'ok' : 'FAILED'} in ${formatDuration(took)} · ${invDelta(snap.inv, after.inv)}`);
            if (!ok && module.observe) {
                for (const line of module.observe(after, step)) {
                    this.host.log(`  ${line}`);
                }
            }
        }

        // Why: the no-progress watchdog below only counts steps that succeeded, so a step failing forever parks nothing and, before the heartbeat above, said nothing either.
        if (ok) {
            this.failStreak = 0;
        } else if (++this.failStreak % FAIL_WARN === 0) {
            this.host.log(`WARN: '${stepDesc}' has failed ${this.failStreak}x in a row `
                + `over ${formatDuration(this.tracker.elapsed(Date.now()))} — failures do not feed the no-progress watchdog, so this will not park itself`);
        }

        if (Bank.isOpen()) {
            await Execution.delayUntil(() => Bank.loaded(), 3000);
            this.refreshBankCounts(true);
            await Modals.close();
        }

        if (ok && advancesWorld(step)) {
            const count = this.watchdog.note(progressSignature(this.buildSnapshot(module, stage, progress)));
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

    private async recoverDeathIfPending(): Promise<boolean> {
        if (!this.host.consumeDeath()) {
            return false;
        }
        if (this.runningId === null) {
            this.host.log('died before a quest step was active — restarting quest selection');
            this.resetWatchdog();
            this.stepSubLog.clear();
            this.lastStepLogged = '';
            this.waitKey = '';
            this.waitCount = 0;
            return true;
        }

        const deadId = this.runningId;
        const deadModule = defById(deadId);
        this.host.log(`died during ${deadModule?.record.name ?? deadId} — re-provisioning and resuming`);
        const chat = GameMessages.recent(10);
        if (chat.length > 0) {
            this.host.log(`  chat: ${chat.map(m => m.text).join(' | ')}`);
        }
        if (deadModule?.observe) {
            const progress = await deadModule.readProgress?.();
            const stage = progress ? progress.stage : await deadModule.readStage?.();
            const deathSnap = this.buildSnapshot(deadModule, stage, progress);
            for (const line of deadModule.observe(deathSnap, { kind: 'wait', reason: 'death' })) {
                this.host.log(`  ${line}`);
            }
        }
        this.provisioned.delete(deadId);
        this.deposited.delete(deadId);
        this.resetWatchdog();
        this.stepSubLog.clear();
        this.lastStepLogged = '';
        this.waitKey = '';
        this.waitCount = 0;
        return true;
    }

    // Why: `exit` comes first for the quests whose last step leaves them somewhere the navigator has no route out of.
    // Why: the bank walk itself is a `scanBank`, so it picks the nearest reachable bank like every other bank leg.
    // Why: it is bounded, as a bot standing safely on the wrong side of a broken route is a better outcome than one that never finishes its queue.

    /** Drive a finished quest's character back to a bank before the queue moves on. */
    private async retreatToBank(module: QuestModule, id: string, rows: QueueRow[]): Promise<boolean> {
        const tries = (this.retreatTries.get(id) ?? 0) + 1;
        this.retreatTries.set(id, tries);
        if (tries > RETREAT_GIVE_UP) {
            this.host.log(`${module.record.name}: no way back to a bank after ${RETREAT_GIVE_UP} tries — leaving the character where it finished`);
            this.retreated.add(id);
            return true;
        }
        this.host.noteState(rows, id, 'walking back to a bank', this.noProgressCount, this.parked.size);
        this.host.log(`${module.record.name} finished — walking back to a bank (${tries}/${RETREAT_GIVE_UP})`);
        const log = (m: string): void => this.host.log(`  ${m}`);
        if (module.exit && !(await module.exit(log))) {
            return false;
        }
        if (!(await executeStep({ kind: 'scanBank', bank: bankFor(module) }, module.hops ?? [], log))) {
            return false;
        }
        this.retreated.add(id);
        return true;
    }

    private resetWatchdog(): void {
        this.watchdog.reset();
        this.noProgressCount = 0;
        this.tracker.reset();
        this.failStreak = 0;
    }

    /**
     * User "Skip quest": stop the current quest for this script session and move on.
     * Parks are temporary (retry later); a skip is a hard session block (#432).
     */
    private applyUserSkip(id: string, elig: Map<string, QuestEligibility>): void {
        const name = this.nameOf(id, elig);
        this.host.log(`skip requested — blocking ${name} for this session`);
        this.block(id, ['skipped by user this session']);
        this.parked.delete(id);
        this.parkedReasons.delete(id);
        this.parkCounts.delete(id);
        this.provisioned.delete(id);
        this.deposited.delete(id);
        this.retreated.delete(id);
        this.retreatTries.delete(id);
        this.waitKey = '';
        this.waitCount = 0;
        this.stepSubLog.clear();
        this.lastStepLogged = '';
        this.runningId = null;
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

    private buildSnapshot(module: QuestModule, stage?: number, progress?: QuestProgress): QuestSnapshot {
        const inv = new Map<string, number>();
        const invIds = new Map<number, number>();
        for (const it of Inventory.items()) {
            if (it.name) {
                const key = it.name.toLowerCase();
                inv.set(key, (inv.get(key) ?? 0) + it.count);
            }
            invIds.set(it.id, (invIds.get(it.id) ?? 0) + it.count);
        }
        const worn = new Set<string>();
        const wornIds = new Set<number>();
        for (const it of Equipment.items()) {
            if (it.name) {
                worn.add(it.name.toLowerCase());
            }
            wornIds.add(it.id);
        }
        return {
            journal: Quests.status(module.record.name),
            inv,
            invIds,
            worn,
            wornIds,
            noProgress: this.noProgressCount,
            bankCoins: this.lastBankCounts.get('coins') ?? 0,
            stage,
            progress,
            bank: new Map(this.lastBankCounts),
            bankIds: new Map(this.lastBankIdCounts),
            bankKnown: this.bankKnown,
            tile: Game.tile(),
            freeSlots: Inventory.free()
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
        // Why: what the account has finished is read from every known quest, not only the ones with a module. A prerequisite whose own quest has no module yet — Biohazard ahead of Underground Pass — would otherwise be unsatisfiable, and the quest it gates would report BLOCKED forever.
        const completedQuests = new Set<string>();
        for (const r of QUESTS) {
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

    private refreshBankCounts(acceptSettledEmpty = false): void {
        if (!Bank.isOpen() || (!Bank.loaded() && !acceptSettledEmpty)) {
            return;
        }
        const next = new Map<string, number>();
        const nextIds = new Map<number, number>();
        for (const item of Bank.items()) {
            if (item.name) {
                const key = item.name.toLowerCase();
                next.set(key, (next.get(key) ?? 0) + item.count);
            }
            nextIds.set(item.id, (nextIds.get(item.id) ?? 0) + item.count);
        }
        this.lastBankCounts = next;
        this.lastBankIdCounts = nextIds;
        this.bankKnown = true;
    }
}
