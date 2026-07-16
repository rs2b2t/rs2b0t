import { type Task } from '../../api/Bot.js';
import { EventSignal } from '../../api/EventSignal.js';
import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
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
import { planProvisioning } from './provisioning.js';
import { nextQuest, queueRows, type QueueRow } from './queue.js';
import type { QuestModule, QuestSnapshot, QuestStep } from './types.js';
import { NO_PROGRESS_PARK, NO_PROGRESS_WARN, ProgressWatchdog, progressSignature } from './watchdog.js';
import type AIOQuester from '../../scripts/AIOQuester.js'; // type-only: no runtime cycle

// The Skills reader is only needed to build the PlayerState for the eligibility
// sweep; pulled in lazily-shaped (same idiom as QuestDashboard).
import { Skills } from '../../api/hud/Skills.js';

/**
 * A step whose success we count toward the no-progress watchdog. `wait`/`done`
 * are deliberately excluded: `wait` is the engine idling for the journal to
 * load (Rune Mysteries' 'unknown' colour), and feeding those idles to the
 * watchdog would park a quest that is only waiting to become readable.
 */
function advancesWorld(step: QuestStep): boolean {
    return step.kind !== 'wait' && step.kind !== 'done';
}

/** One-line human description of the step for the paint's Current tab. Pure and
 *  purely cosmetic — kept inline (not a tested module) since nothing but the
 *  overlay reads it. */
function describeStep(step: QuestStep): string {
    switch (step.kind) {
        case 'talk': return `talk to ${step.stop.npc}`;
        case 'grabGround': return `grab ${step.item}`;
        case 'pickLoc': return `${step.op} ${step.loc}`;
        case 'interactLoc': return `${step.op} ${step.loc}`;
        case 'useOn': return `use ${step.item} on ${step.target}`;
        case 'equip': return `equip ${step.item}`;
        case 'withdraw': return `withdraw ${step.items.map(i => `${i.name}×${i.qty}`).join(', ')}`;
        case 'mineRock': return `mine ${step.item}`;
        case 'custom': return step.name;
        case 'wait': return step.reason;
        case 'done': return 'done';
    }
}

/**
 * The live AIO quest orchestrator: one queue pass per loop. It sweeps
 * eligibility over the IMPLEMENTED quests, picks the next runnable one, assembles
 * a plain QuestSnapshot, provisions items bank-first (once per quest — quests
 * CONSUME their items, so re-diffing after a hand-in would re-gather forever),
 * runs the module's next step, and watches for no-progress stalls. Every exit
 * from execute() either advances the world, parks the running quest, or stops
 * the script — nothing loops silently.
 *
 * Constructed as the TaskBot's sole decision Task (the RuneMysteries QuestStep
 * shape, generalised). All paint/settings live on the host AIOQuester; all
 * orchestration lives here.
 */
export class QuestEngine implements Task {
    /** Run order = def order (cheapest/most-certain first). */
    private readonly order = QUEST_DEFS.map(d => d.record.id);
    private readonly records: QuestRecord[] = QUEST_DEFS.map(d => d.record);

    private readonly watchdog = new ProgressWatchdog();
    /** Current accumulated no-progress count (mirror of the watchdog's private
     *  counter, kept because ProgressWatchdog only RETURNS the count from note()
     *  and never exposes it — and snap.noProgress must carry it into decide() so
     *  stage-invisible quests can rotate empty-handed probes). */
    private noProgressCount = 0;

    /** Quests benched for no-progress; retried after every other quest's turn. */
    private readonly parked = new Set<string>();
    /** Quests whose items have been provisioned once (consume-safe guard). */
    private readonly provisioned = new Set<string>();
    /** Quests that can't proceed (unobtainable mustHave / def bug) -> reasons for
     *  the queue rows; excluded from selection so they never re-pick-loop. */
    private readonly blocked = new Map<string, string[]>();

    /** Bank-only counts (LOWERCASED), refreshed whenever the bank is open — the
     *  bank half of both eligibility and provisioning (bank is unreadable while
     *  closed, so we reuse the last seen; QuestDashboard.readItemSnapshot idiom). */
    private lastBankCounts = new Map<string, number>();

    private runningId: string | null = null;

    constructor(private readonly host: AIOQuester) {}

    /** Same guard as RuneMysteries' QuestStep: never decide while a chat dialog
     *  blocks (ContinueDialog outranks us) or before the world is loaded. */
    validate(): boolean {
        return !ChatDialog.canContinue() && Game.tile() !== null;
    }

    async execute(): Promise<void> {
        // Yield to the random-event handler first (RockCrab idiom) so teleports
        // and stuns clear before we act on a possibly-displaced world.
        if (EventSignal.pending()) {
            await Execution.delayTicks(1);
            return;
        }

        const picked = this.host.pickedIds();

        // --- 1. eligibility sweep over the IMPLEMENTED quests only ---
        this.refreshBankCounts(); // hoisted so provisioning sees a fresh bank
        const player = this.readPlayerState();
        const itemSnap = this.readItemSnapshot();
        const elig = new Map<string, QuestEligibility>();
        for (const r of this.records) {
            elig.set(r.id, evaluate(r, player, itemSnap, Quests.status(r.name)));
        }

        // A manual Skip from the paint parks the running quest before selection.
        if (this.runningId !== null && this.host.consumeSkip()) {
            this.host.log(`skip requested — parking ${this.nameOf(this.runningId, elig)}`);
            this.parked.add(this.runningId);
            this.resetWatchdog();
            this.runningId = null;
        }

        // --- 2. pick the next quest (blocked ones are never selectable) ---
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

        // --- 3. module + snapshot for the running quest ---
        const id = this.runningId;
        const module = defById(id);
        if (!module) {
            // Can't happen (order is derived from QUEST_DEFS) — defensive.
            this.host.log(`ERROR: no module for '${id}' — blocking`);
            this.block(id, ['internal: no module']);
            this.runningId = null;
            return;
        }
        const snap = this.buildSnapshot(module);

        // --- 4. already complete: bank the QP, clear its state, re-pick next loop ---
        if (snap.journal === 'complete') {
            this.host.log(`${module.record.name} COMPLETE — ${Quests.points()} QP`);
            this.parked.delete(id);
            this.provisioned.delete(id);
            this.blocked.delete(id);
            this.resetWatchdog();
            this.runningId = null;
            const done = this.applyBlocked(queueRows(this.order, picked, elig, this.parked, null));
            this.host.noteState(done, null, `${module.record.name} complete`, 0, this.parked.size);
            return;
        }

        // --- 5. provisioning (once per quest) then decide ---
        let step: QuestStep;
        if (!this.provisioned.has(id)) {
            const plan = planProvisioning(module.record.items, snap.inv, this.lastBankCounts);
            if (plan.satisfied) {
                this.provisioned.add(id);
                step = module.decide(snap);
            } else if (plan.blocked.length > 0 && plan.withdraw.length === 0) {
                // A mustHave we can't buy/gather and the bank doesn't hold — park
                // with the reasons on the row (usually eligibility already caught
                // this as BLOCKED, but a bank/inv race can surface it here).
                this.host.log(`${module.record.name} blocked: ${plan.blocked.join(', ')}`);
                this.block(id, plan.blocked.map(b => `missing: ${b}`));
                this.runningId = null;
                const blk = this.applyBlocked(queueRows(this.order, picked, elig, this.parked, null));
                this.host.noteState(blk, null, `blocked: ${plan.blocked.join(', ')}`, this.noProgressCount, this.parked.size);
                return;
            } else if (plan.withdraw.length > 0) {
                // Withdraw first, even if a gather is also pending — the bank trip
                // is cheaper and re-planning next loop picks up the rest.
                step = { kind: 'withdraw', items: plan.withdraw };
            } else {
                // Gather the first shortfall via the module's per-item gatherer.
                const want = plan.gather[0];
                const gatherFn = module.gather?.[want.name.toLowerCase()];
                if (!gatherFn) {
                    // An acquirable item with no gatherer is a def bug — block it
                    // (rather than spin) so the ERROR is visible and non-fatal.
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

        // --- 6. run the step ---
        this.host.noteState(rows, id, describeStep(step), this.noProgressCount, this.parked.size);
        const ok = await executeStep(step, module.hops ?? [], m => this.host.log(`  ${m}`));

        // --- 7. watchdog: only steps that TRIED to move the world are counted ---
        if (ok && advancesWorld(step)) {
            const count = this.watchdog.note(progressSignature(this.buildSnapshot(module)));
            this.noProgressCount = count;
            if (count === NO_PROGRESS_WARN) {
                this.host.log(`WARN: ${count} steps with no progress on ${module.record.name} — check the decide()/prefer lists`);
            } else if (count >= NO_PROGRESS_PARK) {
                this.host.log(`no progress after ${count} steps — parking ${module.record.name}`);
                this.parked.add(id);
                this.resetWatchdog();
                this.runningId = null;
            }
        }

        // --- 8. capture bank counts if the step opened the bank (for next loop) ---
        this.refreshBankCounts();
        await Execution.delayTicks(1);
    }

    // --- helpers -----------------------------------------------------------

    private resetWatchdog(): void {
        this.watchdog.reset();
        this.noProgressCount = 0;
    }

    private block(id: string, reasons: string[]): void {
        this.blocked.set(id, reasons);
        this.resetWatchdog();
    }

    /** Overlay locally-tracked block reasons onto the pure queue rows. */
    private applyBlocked(rows: QueueRow[]): QueueRow[] {
        return rows.map(r => {
            const reasons = this.blocked.get(r.id);
            return reasons ? { ...r, status: 'BLOCKED' as const, reasons } : r;
        });
    }

    private nameOf(id: string, elig: Map<string, QuestEligibility>): string {
        return elig.get(id)?.name ?? id;
    }

    /** Assemble the plain per-quest snapshot decide() consumes. inv/worn are
     *  LOWERCASED; noProgress carries the current watchdog count so pure
     *  decide()s can rotate stage-invisible probes without module state. */
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
            noProgress: this.noProgressCount
        };
    }

    /** PlayerState for the eligibility sweep — only the gated skills of the
     *  IMPLEMENTED quests are read (QuestDashboard.readPlayerState, scoped). */
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

    /** Combined bank+inventory counts (LOWERCASED) for eligibility. Bank comes
     *  from lastBankCounts, kept fresh by refreshBankCounts. */
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

    /** Snapshot bank counts (LOWERCASED) whenever the bank is open; otherwise
     *  keep the last seen — the bank is unreadable while closed. */
    private refreshBankCounts(): void {
        if (!Bank.isOpen()) {
            return;
        }
        const next = new Map<string, number>();
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
