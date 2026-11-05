// docs/reference/quest-engine.md#quest-state
import { reader } from '../../../../adapter/ClientAdapter.js';
import { type Task } from '../../../bot/Bot.js';
import { EventSignal } from '../../../execution/EventSignal.js';
import { Execution } from '../../../execution/Execution.js';
import { Game } from '../../../game/Game.js';
import Tile from '../../../../geometry/Tile.js';
import { Bank } from '../../../bank/Bank.js';
import { bankCostForNavigator, nearestBank, nearestWalkableBankAsync } from '../../../bank/BankLocations.js';
import { Navigator } from '../../../../event/webwalk/Navigator.js';
import { NEARBY_BANK_RADIUS } from '../../../bank/Banking.js';
import { NAV_PURE_WALK, Traversal } from '../../../walking/Traversal.js';
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
import { COIN_FLOAT, coinFloatPlan, depositPlan, floatDrawPlan, planProvisioning, shouldFreshenPack } from './provisioning.js';

export { COIN_FLOAT };
import { nextQuest, queueRows, type QueueRow } from './queue.js';
import { resumePreparation } from './resumePreparation.js';
import type { QuestModule, QuestProgress, QuestSnapshot, QuestStep } from './types.js';
import { NO_PROGRESS_PARK, NO_PROGRESS_WARN, ProgressWatchdog, progressSignature } from './watchdog.js';
import { PRAYER_POTION, prayerUpkeep } from '../prayer.js';
import { FAIL_WARN, StepTracker, formatDuration, formatTile, invDelta } from './trace.js';
import { GameMessages } from '../../../chatbox/gameMessages.js';
import { QuestBankReset } from './recovery.js';
import { questPreparationRequest } from './preparationPolicy.js';
import type { QuestPreparationRequest, QuestPreparationResult } from './preparationTypes.js';
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
    /** Why: the engine only reports it's out of work; stopping the run is the script's call. */
    finish(reason: string): void;
    automaticRecovery?(): boolean;
    restartPending?(): boolean;
    consumeRestart?(): boolean;
    prepare?(request: QuestPreparationRequest): Promise<QuestPreparationResult>;
    preparationStatus?(): string;
    stopPreparation?(): void;
}

const PARK_GIVE_UP = 3;

const WAIT_PARK = 15;
const COMBAT_STALL_MS = 60_000;

/** Walks back to a bank to try before leaving the character where it finished. */
const RETREAT_GIVE_UP = 4;

/** Bank trips to try emptying the pack before a quest starts on whatever it is carrying. */
const FRESH_GIVE_UP = 3;

export const PROVISION_BANK = new Tile(3093, 3243, 0);

function equipmentCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const item of Equipment.items()) {
        if (!item.name) continue;
        const key = item.name.toLowerCase();
        counts.set(key, (counts.get(key) ?? 0) + item.count);
    }
    return counts;
}

import { Skills } from '../../../skills/Skills.js';

/** `'nearest'` means "let the step work it out from where the bot is standing". */
function bankFor(module: QuestModule): Tile | undefined {
    return module.bank === 'nearest' ? undefined : (module.bank ?? PROVISION_BANK);
}

/** Main-modal roots the engine must not auto-close. Pack ids from content/pack/interface.pack (rev 274). */
const INTERACTIVE_QUEST_MAIN: ReadonlySet<number> = new Set([
    6675, // death_dice, Harold gambling (Death Plateau)
    8119 // messagescroll_handwriting, combination after reading the IOU
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
        // Family Crest banks its coin float mid-quest, so this isn't always previous-quest spillover.
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
    private readonly failedWatchdog = new ProgressWatchdog();
    private pendingFailedSignature: string | null = null;
    private noProgressCount = 0;
    private combatIdleSince: number | null = null;
    private combatXp = 0;
    private progressKey = '';
    private progressAt = 0;

    private readonly parked = new Set<string>();
    private readonly parkCounts = new Map<string, number>();
    private readonly parkedReasons = new Map<string, string[]>();
    private readonly provisioned = new Set<string>();
    private readonly retreated = new Set<string>();
    private readonly retreatTries = new Map<string, number>();
    private readonly recoveryTries = new Map<string, number>();
    private readonly deposited = new Set<string>();
    private readonly freshened = new Set<string>();
    private readonly freshenTries = new Map<string, number>();
    private readonly foodDrawn = new Set<string>();
    private readonly potionsDrawn = new Set<string>();
    private readonly coinsDrawn = new Set<string>();
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
    private readonly prepared = new Set<string>();
    private readonly deathCounts = new Map<string, number>();
    private readonly restartCounts = new Map<string, number>();
    private recovery: { id: string; mode: 'refresh' | 'bank'; reset: QuestBankReset; tries: number; skip?: boolean; abort?: string } | null = null;
    private preparation: {
        id: string; request: QuestPreparationRequest; reset: QuestBankReset;
        phase: 'bank' | 'work' | 'restore'; tries: number; error?: string; skip?: boolean; retry?: boolean;
    } | null = null;

    constructor(private readonly host: QuestHost) {}

    validate(): boolean {
        return !ChatDialog.canContinue() && Game.tile() !== null;
    }

    async execute(): Promise<void> {
        // Death participates in EventSignal, so consume it before checking that signal.
        if (await this.recoverDeathIfPending()) {
            return;
        }
        if (this.preparation) {
            await this.runPreparation();
            return;
        }
        if (this.recovery) {
            await this.runRecovery();
            return;
        }
        if (this.host.consumeRestart?.() && this.runningId) {
            this.beginRecovery(this.runningId, 'restart requested', true);
            await this.runRecovery();
            return;
        }
        // Apply Skip before the random-event yield so a mid-walk interrupt lands on the next quest instead of spinning on EventSignal.pending().
        const skipEarly = this.host.skipPending();
        if (!skipEarly && EventSignal.pending()) {
            await Execution.delayTicks(1);
            return;
        }

        // Bank-aware steps leave the bank open so this task can snapshot it before the interface closes.
        if (!skipEarly && Bank.isOpen()) {
            await Execution.delayUntil(() => Bank.loaded(), 3000);
            this.refreshBankCounts(true);
            await Modals.close();
            return;
        }

        // Why: quest-complete scrolls and similar leftovers sit on main and block the next decide() tick.
        // Why: interactive quest UIs also use main and must stay open (the Death Plateau dice and combination handwriting were being killed mid-step).
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
            if (this.host.automaticRecovery?.()) {
                this.recovery = { id: this.runningId, mode: 'bank', reset: new QuestBankReset(this.host.foodItem()), tries: 0, skip: true };
                await this.runRecovery();
                return;
            }
            this.applyUserSkip(this.runningId, elig);
        }

        if (await this.recoverArea(picked, elig)) return;

        if (this.runningId === null) {
            const selectable = new Set([...picked].filter(id => !this.blocked.has(id)));
            const tile = Game.tile();
            const owner = tile && QUEST_DEFS.find(module => module.resumeAt?.(tile) && Quests.status(module.record.name) === 'inProgress');
            if (owner) {
                const id = owner.record.id;
                if (!selectable.has(id) || elig.get(id)?.status !== 'READY') {
                    const reasons = !picked.has(id) ? ['quest not selected'] : this.blocked.get(id) ?? elig.get(id)?.reasons ?? ['quest unavailable'];
                    this.host.finish(`${owner.record.name}: cannot switch quests from this area: ${reasons.join('; ')}`);
                    return;
                }
                this.runningId = id;
            } else {
                this.runningId = nextQuest(this.order, selectable, elig, this.parked);
                if (!this.runningId && this.host.prepare) {
                    this.runningId = this.order.find(id => {
                        const record = defById(id)?.record;
                        return selectable.has(id) && record && elig.get(id)?.status !== 'DONE'
                            && Quests.status(record.name) !== 'unknown'
                            && player.questPoints >= (record.requirements.minQuestPoints ?? 0)
                            && (record.requirements.quests ?? []).every(q => player.completedQuests.has(q));
                    }) ?? null;
                }
            }
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
        if (!this.readinessWarned.has(id)) {
            this.host.noteState(rows, id, 'checking quest requirements', this.noProgressCount, this.parked.size);
            this.readinessWarned.add(id);
            module.onStart?.();
            const note = module.warnReadiness?.();
            if (note) {
                this.host.log(`${module.record.name}: ${note}`);
            }
        }
        const progress = await module.readProgress?.();
        const stage = progress ? progress.stage : await module.readStage?.();
        const snap = this.buildSnapshot(module, stage, progress);
        if (snap.journal === 'unknown') {
            this.host.noteState(rows, id, 'waiting for quest journal', 0, this.parked.size);
            return;
        }
        if (this.host.prepare && !this.prepared.has(id) && snap.journal !== 'complete') {
            const stock = new Map(this.lastBankCounts);
            const stockIds = new Map(this.lastBankIdCounts);
            for (const item of [...Inventory.items(), ...Equipment.items()]) {
                if (item.name) stock.set(item.name.toLowerCase(), (stock.get(item.name.toLowerCase()) ?? 0) + item.count);
                stockIds.set(item.id, (stockIds.get(item.id) ?? 0) + item.count);
            }
            const request = questPreparationRequest(module, this.host.foodItem(), snap.journal, stock, stockIds);
            if (request && this.needsPreparation(request, stock)) {
                this.preparation = { id, request, reset: new QuestBankReset(this.host.foodItem()), phase: 'bank', tries: 0 };
                await this.runPreparation();
                return;
            }
            this.prepared.add(id);
        }
        const inQuestArea = snap.tile !== null && snap.tile !== undefined && module.resumeAt?.(snap.tile) === true;
        const combatActive = this.combatAdvancing(snap);
        if (this.host.automaticRecovery?.()) {
            const key = `${id}|${progressSignature({ ...snap, tile: undefined })}`;
            if (key !== this.progressKey || combatActive) {
                this.progressKey = key;
                this.progressAt = Date.now();
            } else if (Date.now() - this.progressAt >= 300_000) {
                this.beginRecovery(id, 'five minutes without quest, inventory or combat progress');
                return;
            }
        }

        if (this.pendingFailedSignature !== null) {
            if (!combatActive && progressSignature(snap) === this.pendingFailedSignature) {
                this.host.log(`no progress after ${this.noProgressCount} steps on ${module.record.name}`);
                if (this.beginRecovery(id, 'no progress after failed step')) return;
                this.parkOrGiveUp(id, module.record.name);
                this.resetWatchdog();
                this.runningId = null;
                return;
            }
            this.pendingFailedSignature = null;
            this.failedWatchdog.reset();
            this.noProgressCount = 0;
            snap.noProgress = 0;
        }

        // Why: a fight shaped as a step returns here every pass, so this is the only place its prayer can be held.
        // Why: the server runs one op per tick, so a pass that prays yields instead of also swinging.
        if (await prayerUpkeep()) {
            return;
        }

        if (!inQuestArea && await this.freshenPack(module, id, snap, rows)) {
            return;
        }

        if (!inQuestArea && await this.prepareResume(module, id, snap, rows)) return;

        if (module.ownsInventory) {
            // Some quests have one-way, bankless areas, so their stage oracle runs before any generic spillover banking or provisioning on the mainland.
            this.deposited.add(id);
            this.provisioned.add(id);
        }

        if (snap.journal === 'complete') {
            // Why: quests end in lairs, the wilderness and dungeons, and a bot left standing there dies there.
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
            this.freshened.delete(id);
            this.freshenTries.delete(id);
            this.foodDrawn.delete(id);
            this.potionsDrawn.delete(id);
            this.coinsDrawn.delete(id);
            this.blocked.delete(id);
            this.resetWatchdog();
            this.runningId = null;
            const done = this.applyBlocked(queueRows(this.order, picked, elig, this.parked, null));
            this.host.noteState(done, null, `${module.record.name} complete`, 0, this.parked.size);
            return;
        }

        let step: QuestStep;
        if (!inQuestArea && !this.deposited.has(id)) {
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
                } else {
                    const tries = (this.freshenTries.get(id) ?? 0) + 1;
                    this.freshenTries.set(id, tries);
                    if (tries >= FRESH_GIVE_UP) {
                        this.block(id, ['could not prepare inventory: bank unreachable or deposit refused']);
                        this.runningId = null;
                    }
                }
                await Execution.delayUntil(() => Bank.loaded(), 3000);
                this.refreshBankCounts(true);
                await Modals.closeIfOpen();
                return;
            }
        }
        if (!inQuestArea && !this.provisioned.has(id)) {
            const plan = planProvisioning(snap.journal === 'inProgress' && this.host.prepare ? [] : module.record.items, snap.inv, this.lastBankCounts, equipmentCounts());
            // Why: restoring the float after every purchase made a 10gp gate emit withdraw Coins every tick while egg/milk/flour were outstanding.
            const coinPlan = coinFloatPlan(
                snap.inv.get('coins') ?? 0,
                this.lastBankCounts.get('coins') ?? 0,
                module.coinFloat ?? COIN_FLOAT,
                this.coinsDrawn.has(id)
            );
            let coinFloat: { name: string; qty: number } | null = null;
            if (coinPlan.drawn) {
                this.coinsDrawn.add(id);
            } else if (coinPlan.qty > 0) {
                coinFloat = { name: 'Coins', qty: coinPlan.qty };
            }
            const foodItem = this.host.foodItem();
            // Only withdraw food once the bank inventory is known; a guessed shortfall forces a failed booth trip and can scramble a full pack.
            const foodReady = module.foodReady?.(snap) ?? true;
            let foodFloat: { name: string; qty: number } | null = null;
            if (module.food && foodItem && this.bankKnown && foodReady) {
                const key = foodItem.toLowerCase();
                const foodPlan = floatDrawPlan(
                    snap.inv.get(key) ?? 0,
                    this.lastBankCounts.get(key) ?? 0,
                    module.food,
                    this.foodDrawn.has(id)
                );
                if (foodPlan.drawn) {
                    this.foodDrawn.add(id);
                } else if (foodPlan.qty > 0) {
                    foodFloat = { name: foodItem, qty: foodPlan.qty };
                }
            }
            let potionFloat: { name: string; qty: number } | null = null;
            if (module.pray?.potions && this.bankKnown) {
                const key = PRAYER_POTION.toLowerCase();
                const potionPlan = floatDrawPlan(
                    snap.inv.get(key) ?? 0,
                    this.lastBankCounts.get(key) ?? 0,
                    module.pray.potions,
                    this.potionsDrawn.has(id)
                );
                if (potionPlan.drawn) {
                    this.potionsDrawn.add(id);
                } else if (potionPlan.qty > 0) {
                    potionFloat = { name: PRAYER_POTION, qty: potionPlan.qty };
                }
            }
            const extras = [coinFloat, foodFloat, potionFloat].filter((w): w is { name: string; qty: number } => w !== null);
            const needsBankSnapshot = plan.blocked.length > 0 || plan.gather.length > 0 || !coinPlan.drawn
                || (foodReady && foodItem && module.food && !this.foodDrawn.has(id) && (snap.inv.get(foodItem.toLowerCase()) ?? 0) < module.food)
                || (module.pray?.potions && !this.potionsDrawn.has(id) && (snap.inv.get(PRAYER_POTION.toLowerCase()) ?? 0) < module.pray.potions);
            if (!this.bankKnown && needsBankSnapshot) {
                step = { kind: 'scanBank', bank: bankFor(module) };
            } else if (plan.blocked.length > 0 && plan.withdraw.length === 0) {
                this.host.log(`${module.record.name} short on items: ${plan.blocked.join(', ')} — parking`);
                this.parkOrGiveUp(id, module.record.name, plan.blocked.map(b => `missing: ${b}`));
                this.resetWatchdog();
                this.runningId = null;
                const blk = this.applyBlocked(queueRows(this.order, picked, elig, this.parked, null));
                this.host.noteState(blk, null, `parked: ${plan.blocked.join(', ')}`, this.noProgressCount, this.parked.size);
                return;
            } else if (plan.withdraw.length > 0 || extras.length > 0) {
                step = { kind: 'withdraw', items: [...plan.withdraw, ...extras], bank: bankFor(module) };
            } else if (plan.satisfied) {
                // Why: with food held back the quest isn't provisioned yet, and closing the block here would retire it for the run.
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

        if (!inQuestArea && await this.prepareResume(module, id, snap, rows, step)) return;

        const stepDesc = describeStep(step);
        this.host.noteState(rows, id, stepDesc, this.noProgressCount, this.parked.size);

        const verbose = this.host.verbose();
        const now = Date.now();
        const attempt = this.tracker.open(`${id}|${stepDesc}`, now);
        const stepLine = `${module.record.name}: ${stepDesc}`;
        const fresh = stepLine !== this.lastStepLogged;
        // Why: re-deciding the same step is how this engine loops, so repeats are silent by default.
        // Why: the heartbeat stops a long mine, smelt and hammer chain, all called `smith 8 nails`, from looking like a hang.
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
                if (this.beginRecovery(id, `waiting: ${step.reason}`)) return;
                this.host.log(`${module.record.name} waiting on '${step.reason}' with no way to resolve it — parking`);
                this.parkOrGiveUp(id, module.record.name, [`waiting: ${step.reason}`]);
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
            // Verbose keeps the repeats: a sub-log that fires once per rock is the record of a mining leg.
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

        if (ok) {
            this.failStreak = 0;
            this.failedWatchdog.reset();
        } else if (++this.failStreak % FAIL_WARN === 0) {
            this.host.log(`WARN: '${stepDesc}' has failed ${this.failStreak}x in a row `
                + `over ${formatDuration(this.tracker.elapsed(Date.now()))}`);
        }

        if (Bank.isOpen()) {
            await Execution.delayUntil(() => Bank.loaded(), 3000);
            this.refreshBankCounts(true);
            await Modals.close();
        }

        if (advancesWorld(step)) {
            const after = this.buildSnapshot(module, stage, progress);
            const signature = progressSignature(after);
            const combatActive = this.combatAdvancing(after);
            if (combatActive) {
                this.watchdog.reset();
                this.failedWatchdog.reset();
            }
            const count = combatActive ? 0 : ok
                ? this.watchdog.note(signature)
                : this.failedWatchdog.noteFailure(progressSignature(snap), signature);
            this.noProgressCount = count;
            if (count === NO_PROGRESS_WARN) {
                this.host.log(`WARN: ${count} steps with no progress on ${module.record.name} — check the decide()/prefer lists`);
            } else if (count >= NO_PROGRESS_PARK && !ok && (module.readProgress || module.readStage)) {
                // Why: journal oracles can open/close modals; confirm on the next normal read, not with an extra post-step action.
                this.pendingFailedSignature = signature;
            } else if (count >= NO_PROGRESS_PARK) {
                this.host.log(`no progress after ${count} steps on ${module.record.name}`);
                if (this.beginRecovery(id, `no progress on ${stepDesc}`)) return;
                this.parkOrGiveUp(id, module.record.name);
                this.resetWatchdog();
                this.runningId = null;
            }
        }

        this.refreshBankCounts();
        await Execution.delayTicks(1);
    }

    private needsPreparation(request: QuestPreparationRequest, stock: ReadonlyMap<string, number>): boolean {
        return (request.skills ?? []).some(req => Skills.level(req.skill) < req.level)
            || (request.items ?? []).some(req => (stock.get(req.item.toLowerCase()) ?? 0) < req.count)
            || !!request.food && (stock.get(request.food.item.toLowerCase()) ?? 0) < request.food.count;
    }

    private currentRows(): QueueRow[] {
        const player = this.readPlayerState();
        const items = this.readItemSnapshot();
        const elig = new Map(this.records.map(record => [record.id, evaluate(record, player, items, Quests.status(record.name))]));
        return this.applyBlocked(queueRows(this.order, this.host.pickedIds(), elig, this.parked, this.runningId));
    }

    private preparationNote(id: string, message: string): void {
        this.host.noteState(this.currentRows(), id, message, this.noProgressCount, this.parked.size);
    }

    private async runPreparation(): Promise<void> {
        const task = this.preparation;
        if (!task) return;
        const module = defById(task.id)!;
        const log = (message: string): void => this.host.log(`${module.record.name}: ${message}`);
        if (this.host.consumeSkip()) {
            this.host.stopPreparation?.();
            task.skip = true;
            if (task.phase !== 'bank') task.phase = 'restore';
        } else if (this.host.consumeRestart?.()) {
            this.host.stopPreparation?.();
            task.retry = true;
            if (task.phase !== 'bank') task.phase = 'restore';
        }
        if (EventSignal.pending()) return;
        try {
            if (task.phase === 'bank') {
                this.preparationNote(task.id, 'banking before quest preparation');
                if (!(await task.reset.prepare(module, this.buildSnapshot(module), log))) {
                    if (++task.tries >= FRESH_GIVE_UP) {
                        this.host.finish(`cannot safely prepare ${module.record.name}: ${task.reset.reason || 'could not reach the bank'}`);
                    }
                    return;
                }
                task.tries = 0;
                this.refreshBankCounts(true);
                task.request = questPreparationRequest(module, this.host.foodItem(), Quests.status(module.record.name), this.lastBankCounts, this.lastBankIdCounts) ?? task.request;
                task.request = { ...task.request, items: [...task.request.items ?? [], ...task.reset.supplies] };
                task.phase = task.skip || task.retry ? 'restore' : 'work';
            }
            if (task.phase === 'work') {
                const result = await this.host.prepare!(task.request);
                this.preparationNote(task.id, this.host.preparationStatus?.() ?? 'preparing quest requirements');
                if (result === 'working') return;
                this.host.stopPreparation?.();
                task.phase = 'restore';
            }
            this.preparationNote(task.id, 'restoring quest inventory and equipment');
            if (task.reset.pending && !(await task.reset.restore(log))) {
                if (++task.tries >= FRESH_GIVE_UP) this.host.finish(`cannot restore ${module.record.name}: ${task.reset.reason}`);
                return;
            }
            this.preparation = null;
            this.bankKnown = false;
            this.lastBankCounts.clear();
            this.lastBankIdCounts.clear();
            this.resetWatchdog();
            this.provisioned.delete(task.id);
            this.foodDrawn.delete(task.id);
            this.potionsDrawn.delete(task.id);
            this.coinsDrawn.delete(task.id);
            this.deposited.add(task.id);
            this.freshened.add(task.id);
            module.onStart?.();
            if (task.skip) this.applyUserSkip(task.id, new Map());
            else if (task.error) {
                this.block(task.id, [task.error]);
                this.runningId = null;
            } else {
                if (task.retry) this.prepared.delete(task.id);
                else this.prepared.add(task.id);
                log('requirements ready; resuming quest');
            }
        } catch (error) {
            if (error instanceof Error && error.name === 'ScriptAborted') throw error;
            this.host.stopPreparation?.();
            task.error = error instanceof Error ? error.message : String(error);
            if (task.reset.pending) task.phase = 'restore';
            if (++task.tries >= FRESH_GIVE_UP) this.host.finish(`cannot safely finish preparation for ${module.record.name}: ${task.error}`);
        }
    }

    private beginRecovery(id: string, reason: string, forceBank = false): boolean {
        if (!this.host.automaticRecovery?.()) return false;
        const count = (this.restartCounts.get(id) ?? 0) + 1;
        this.restartCounts.set(id, count);
        this.resetWatchdog();
        this.waitKey = '';
        this.waitCount = 0;
        if (count > 2) {
            this.recovery = { id, mode: 'bank', reset: new QuestBankReset(this.host.foodItem()), tries: 0,
                abort: `${reason}; refresh and bank restart exhausted; aborted for this session` };
        } else {
            this.recovery = { id, mode: forceBank || count === 2 ? 'bank' : 'refresh', reset: new QuestBankReset(this.host.foodItem()), tries: 0 };
            this.host.log(`${defById(id)?.record.name}: ${reason}; ${this.recovery.mode} recovery (${count}/2)`);
        }
        return true;
    }

    private async runRecovery(): Promise<void> {
        const task = this.recovery;
        if (!task) return;
        const module = defById(task.id)!;
        if (this.host.consumeSkip()) { task.skip = true; task.mode = 'bank'; }
        if (this.host.consumeRestart?.()) task.mode = 'bank';
        if (EventSignal.pending()) return;
        try {
            this.preparationNote(task.id, task.mode === 'refresh' ? 'refreshing quest state' : 'restarting from a clean bank loadout');
            if (task.mode === 'refresh') {
                await Modals.closeIfOpen();
                module.onStart?.();
                if (!Game.inCombat()) {
                    await Quests.journal(module.record.name);
                    await Modals.closeIfOpen();
                }
            } else {
                if (!(await task.reset.tick(module, this.buildSnapshot(module), message => this.host.log(message)))) {
                    if (++task.tries >= FRESH_GIVE_UP) {
                        this.host.finish(`cannot safely restart ${module.record.name}: ${task.reset.reason}`);
                    }
                    return;
                }
                this.bankKnown = false;
                this.lastBankCounts.clear();
                this.lastBankIdCounts.clear();
                this.prepared.delete(task.id);
                this.provisioned.delete(task.id);
                this.deposited.add(task.id);
                this.freshened.add(task.id);
                this.foodDrawn.delete(task.id);
                this.potionsDrawn.delete(task.id);
                this.coinsDrawn.delete(task.id);
                module.onStart?.();
            }
            this.recovery = null;
            this.resetWatchdog();
            this.lastStepLogged = '';
            if (task.skip) this.applyUserSkip(task.id, new Map());
            else if (task.abort) {
                this.block(task.id, [task.abort]);
                this.runningId = null;
            }
        } catch (error) {
            if (error instanceof Error && error.name === 'ScriptAborted') throw error;
            if (++task.tries >= FRESH_GIVE_UP) this.host.finish(`cannot safely restart ${module.record.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
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
        if (this.host.automaticRecovery?.()) {
            const deaths = (this.deathCounts.get(deadId) ?? 0) + 1;
            this.deathCounts.set(deadId, deaths);
            this.host.stopPreparation?.();
            if (this.recovery?.reset.pending) {
                this.host.finish(`died while restoring ${deadModule?.record.name ?? deadId}; loadout snapshot retained, check the bank before restarting`);
                return true;
            }
            this.recovery = null;
            if (this.preparation) {
                this.preparation.phase = 'restore';
                this.preparation.retry = true;
                if (deaths >= 3) this.preparation.error = '3 deaths during quest preparation';
            } else if (deaths >= 3) {
                this.block(deadId, ['3 deaths during this quest; aborting for this session']);
                this.runningId = null;
                return true;
            }
            this.prepared.delete(deadId);
            deadModule?.onStart?.();
        }
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
        this.foodDrawn.delete(deadId);
        this.potionsDrawn.delete(deadId);
        this.coinsDrawn.delete(deadId);
        this.resetWatchdog();
        this.stepSubLog.clear();
        this.lastStepLogged = '';
        this.waitKey = '';
        this.waitCount = 0;
        return true;
    }

    /** Bank the pack to nothing before a quest opens; true when the loop should yield after the trip. */
    private async freshenPack(module: QuestModule, id: string, snap: QuestSnapshot, rows: QueueRow[]): Promise<boolean> {
        const carried = Inventory.used();
        if (snap.journal === 'notStarted' && carried === 0) {
            this.freshened.add(id);
        }
        if (!shouldFreshenPack(snap.journal, carried, this.freshened.has(id))) {
            return false;
        }
        const tries = (this.freshenTries.get(id) ?? 0) + 1;
        this.freshenTries.set(id, tries);
        this.host.noteState(rows, id, 'banking the pack to nothing', this.noProgressCount, this.parked.size);
        this.host.log(`${module.record.name} not started, banking ${carried} carried slot(s) so it provisions from empty (${tries}/${FRESH_GIVE_UP})`);
        const emptied = await executeStep(
            { kind: 'deposit', keep: [], bank: bankFor(module), leaveOpen: true },
            module.hops ?? [],
            m => this.host.log(`  ${m}`)
        );
        if (emptied) this.freshened.add(id);
        else if (tries >= FRESH_GIVE_UP) {
            this.block(id, ['could not prepare inventory: bank unreachable or deposit refused']);
            this.runningId = null;
        }
        await Execution.delayUntil(() => Bank.loaded(), 3000);
        this.refreshBankCounts(true);
        await Modals.closeIfOpen();
        return true;
    }

    private async prepareResume(module: QuestModule, id: string, snap: QuestSnapshot, rows: QueueRow[], step?: QuestStep): Promise<boolean> {
        if (this.freshened.has(id) || snap.journal !== 'inProgress') return false;
        if (Inventory.countById(431) > 0) return false;
        const plan = resumePreparation(module, snap, Inventory.items(), this.host.foodItem());
        if (!plan) {
            this.freshened.add(id);
            return false;
        }
        if (!snap.tile || Game.inCombat() || step?.kind === 'deposit') return false;
        const nearby = nearestBank(snap.tile);
        const atBank = nearby?.tile.level === snap.tile.level && nearby.tile.distanceTo(snap.tile) <= NEARBY_BANK_RADIUS;
        const bankStep = step?.kind === 'scanBank' || step?.kind === 'withdraw';
        const mainland = snap.tile.level === 0 && snap.tile.x >= 2944 && snap.tile.x < 3392 && snap.tile.z >= 3200 && snap.tile.z < 3520;
        const detour = !atBank && !bankStep && mainland && nearby !== null;
        if (!atBank && !bankStep && !detour) return false;
        const bank = detour
            ? (await nearestWalkableBankAsync(snap.tile, bankCostForNavigator(Navigator, {
                ...NAV_PURE_WALK, maxExpansions: 500_000, timeoutMs: 5_000
            })))?.tile
            : atBank ? nearby!.tile : bankStep ? step.bank : undefined;
        const tries = (this.freshenTries.get(id) ?? 0) + 1;
        this.freshenTries.set(id, tries);
        this.host.noteState(rows, id, 'preparing inventory for resumed quest', this.noProgressCount, this.parked.size);
        const log = (message: string): void => this.host.log(`  ${message}`);
        const arrived = !detour || (bank !== undefined && await Traversal.walkResilient(bank, { ...NAV_PURE_WALK, radius: 3, attempts: 2, timeoutMs: 90_000, log }));
        let prepared = arrived && await executeStep({ kind: 'deposit', keep: [], keepIds: plan.keepIds, bank, leaveOpen: true }, module.hops ?? [], log);
        if (prepared) {
            for (const cap of plan.caps) {
                while (Inventory.countById(cap.id) > cap.qty) {
                    if (!(await Bank.backpackReady())) {
                        prepared = false;
                        break;
                    }
                    const item = Inventory.items().find(item => item.id === cap.id);
                    const op = item?.actions().find(op => /^deposit[\s-]+1$/i.test(op));
                    const before = Inventory.countById(cap.id);
                    if (!item || !op || !(await item.interact(op))
                        || !(await Execution.delayUntil(() => Inventory.countById(cap.id) < before, 3000))) {
                        prepared = false;
                        break;
                    }
                }
                if (!prepared) break;
            }
        }
        this.refreshBankCounts(true);
        await Modals.closeIfOpen();
        if (prepared) this.freshened.add(id);
        else if (tries >= FRESH_GIVE_UP) {
            this.block(id, ['could not prepare inventory: bank unreachable or deposit refused']);
            this.runningId = null;
        }
        return true;
    }

    // Why: `exit` comes first for the quests whose last step leaves them somewhere the navigator has no route out of.
    // Why: the bank walk itself is a `scanBank`, so it picks the nearest reachable bank like every other bank leg.

    /** Drive a finished quest's character back to a bank before the queue moves on. */
    private async retreatToBank(module: QuestModule, id: string, rows: QueueRow[]): Promise<boolean> {
        const tries = (this.retreatTries.get(id) ?? 0) + 1;
        this.retreatTries.set(id, tries);
        if (tries > RETREAT_GIVE_UP) {
            this.host.finish(`could not leave ${module.record.name} after ${RETREAT_GIVE_UP} attempts`);
            return false;
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

    private async recoverArea(picked: Set<string>, elig: Map<string, QuestEligibility>): Promise<boolean> {
        const tile = Game.tile();
        if (!tile) return false;
        for (const module of QUEST_DEFS) {
            const step = module.recover?.(tile);
            if (!step) continue;
            const id = module.record.id;
            const rows = this.applyBlocked(queueRows(this.order, picked, elig, this.parked, this.runningId));
            const description = describeStep(step);
            this.host.noteState(rows, id, description, this.noProgressCount, this.parked.size);
            this.host.log(`${module.record.name}: recovering: ${description}`);
            if (await executeStep(step, module.hops ?? [], message => this.host.log(`  ${message}`))) {
                this.recoveryTries.delete(id);
                this.resetWatchdog();
            } else {
                const tries = (this.recoveryTries.get(id) ?? 0) + 1;
                this.recoveryTries.set(id, tries);
                if (tries >= RETREAT_GIVE_UP) this.host.finish(`could not recover from ${module.record.name}: ${description} after ${tries} attempts`);
            }
            return true;
        }
        this.recoveryTries.clear();
        return false;
    }

    private resetWatchdog(): void {
        this.watchdog.reset();
        this.failedWatchdog.reset();
        this.pendingFailedSignature = null;
        this.noProgressCount = 0;
        this.tracker.reset();
        this.failStreak = 0;
        this.combatIdleSince = null;
        this.progressKey = '';
        this.progressAt = 0;
    }

    private combatAdvancing(snap: QuestSnapshot): boolean {
        if (!Game.inCombat()) {
            this.combatIdleSince = null;
            return false;
        }
        const xp = snap.combatXp ?? 0;
        if (this.combatIdleSince === null || xp !== this.combatXp) this.combatIdleSince = Date.now();
        this.combatXp = xp;
        return Date.now() - this.combatIdleSince < COMBAT_STALL_MS;
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
        this.freshened.delete(id);
        this.freshenTries.delete(id);
        this.foodDrawn.delete(id);
        this.potionsDrawn.delete(id);
        this.coinsDrawn.delete(id);
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

    private parkOrGiveUp(id: string, name: string, reasons: string[] = []): void {
        if (!reasons.length && this.lastStepLogged) reasons = [`no progress on ${this.lastStepLogged}`];
        if (reasons.length) this.parkedReasons.set(id, reasons);
        else this.parkedReasons.delete(id);
        const count = (this.parkCounts.get(id) ?? 0) + 1;
        this.parkCounts.set(id, count);
        if (count >= PARK_GIVE_UP) {
            this.host.log(`${name} parked ${PARK_GIVE_UP}x with no progress — giving up`);
            this.block(id, [...reasons, `parked ${PARK_GIVE_UP}x with no progress — giving up`]);
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
            prayer: Skills.effective('prayer'),
            attack: Skills.level('attack'),
            ranged: Skills.level('ranged'),
            magic: Skills.effective('magic'),
            mining: Skills.effective('mining'),
            freeSlots: Inventory.free(),
            combatXp: Skills.xp('attack') + Skills.xp('strength') + Skills.xp('defence') + Skills.xp('ranged') + Skills.xp('magic') + Skills.xp('hitpoints')
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
        // Why: completion is read from every known quest, so a prerequisite without a module yet (Biohazard for Underground Pass, Heroes' Quest for Legends) can still be satisfied.
        const completedQuests = new Set<string>();
        for (const r of QUESTS) {
            if (Quests.status(r.name) === 'complete') {
                completedQuests.add(r.id);
            }
        }
        return { questPoints: Quests.points(), skillLevels, completedQuests };
    }

    private readItemSnapshot(): BankInventorySnapshot {
        const worn = equipmentCounts();
        const wanted = new Set<string>();
        for (const r of this.records) {
            for (const it of r.items) {
                wanted.add(it.name);
            }
        }
        const counts = new Map<string, number>();
        for (const name of wanted) {
            const key = name.toLowerCase();
            counts.set(key, Inventory.count(name) + (this.lastBankCounts.get(key) ?? 0) + (worn.get(key) ?? 0));
        }
        return { counts, bankKnown: this.bankKnown };
    }

    private refreshBankCounts(acceptSettledEmpty = false): void {
        if (!Bank.isOpen() || (!Bank.ready() && !acceptSettledEmpty)) {
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
