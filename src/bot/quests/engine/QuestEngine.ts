import { actions, reader } from '../../adapter/ClientAdapter.js';
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
import { coinFloatWithdraw, depositPlan, floatWithdraw, planProvisioning } from './provisioning.js';
import { nextQuest, queueRows, type QueueRow } from './queue.js';
import type { QuestModule, QuestSnapshot, QuestStep } from './types.js';
import { NO_PROGRESS_PARK, NO_PROGRESS_WARN, ProgressWatchdog, progressSignature } from './watchdog.js';
import type AIOQuester from '../../scripts/AIOQuester.js'; // type-only: no runtime cycle

/** How many no-progress parks a quest gets before we give up on it for good.
 *  A parked quest that is the only runnable one is re-picked IMMEDIATELY
 *  (parked = retry-last) and, with the watchdog reset on park, burns another
 *  full no-progress budget and re-parks — forever. Live: Doric's Quest froze at
 *  Clay x3 then alternated 'no progress after 8 steps — parking' endlessly, the
 *  queue never draining and the runner never stopping. After this many parks we
 *  block() the quest instead so the queue drains and the runner stops. */
const PARK_GIVE_UP = 3;

/** Consecutive IDENTICAL wait steps (same quest + same reason) before the quest
 *  is parked with that reason. Waits are excluded from the no-progress watchdog
 *  (see advancesWorld) because journal-load waits at quest start must not park —
 *  but a wait that never resolves (live 2026-07-16: a pickaxe-less account hit
 *  Doric's 'need a pickaxe' wait and spun silently forever under the Rune
 *  Mysteries completion scroll) needs its own liveness bound. ~1.5-2s per wait
 *  loop, so 15 ≈ 25-30s — far above any journal-load (1-3 loops), far below a
 *  human noticing the wedge. Failing (ok=false) steps are deliberately NOT
 *  counted: the custom-step contract uses false = re-enter (the imp grind
 *  returns false per attempt BY DESIGN). */
const WAIT_PARK = 15;

// Default coin float pulled from the bank at provisioning time. Coins are useful
// in nearly every quest (gate tolls, shop buys), so every quest starts by topping
// the pack up to this from the bank — capped at what the bank holds.
export const COIN_FLOAT = 1000;

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
        case 'deposit': return 'bank spillover from the last quest';
        case 'mineRock': return `mine ${step.item}`;
        case 'buy': return `buy ${step.qty}× ${step.item}`;
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
    /** Per-quest tally of no-progress parks. At PARK_GIVE_UP the quest is
     *  block()ed instead of parked again (see parkOrGiveUp) so a quest that can
     *  never progress stops re-parking forever. Manual skips are excluded — a
     *  human pressed Skip, so it should not count toward giving up. */
    private readonly parkCounts = new Map<string, number>();
    /** Reasons for quests parked on a provisioning shortfall (unprovisionable
     *  mustHave). Overlaid onto the PARKED row so the display names the specific
     *  missing item instead of the generic 'no progress' string — the quest stays
     *  in `parked` (retryable), NOT `blocked` (permanently excluded). */
    private readonly parkedReasons = new Map<string, string[]>();
    /** Quests whose items have been provisioned once (consume-safe guard). */
    private readonly provisioned = new Set<string>();
    /** Quests that already had their between-quest spillover deposit. Once per
     *  quest, BEFORE provisioning: everything the module doesn't keep goes to
     *  the bank so long queues can't overflow the pack (live: sheep needs
     *  shears + 20 wool = 21 free slots). Bank-first provisioning pulls back
     *  whatever the quest actually needs, so depositing is always safe. */
    private readonly deposited = new Set<string>();
    /** Quests that can't proceed at all (def bug / internal error) -> reasons for
     *  the queue rows; excluded from selection so they never re-pick-loop. A
     *  provisioning shortfall is PARKED (retryable), not blocked — see parkedReasons. */
    private readonly blocked = new Map<string, string[]>();

    /** Bank-only counts (LOWERCASED), refreshed whenever the bank is open — the
     *  bank half of both eligibility and provisioning (bank is unreadable while
     *  closed, so we reuse the last seen; QuestDashboard.readItemSnapshot idiom). */
    private lastBankCounts = new Map<string, number>();

    private runningId: string | null = null;

    /** Consecutive-identical-wait tracking (quest id + reason); see WAIT_PARK.
     *  Reset on any non-wait step, key change, park, or quest completion. */
    private waitKey = '';
    private waitCount = 0;

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

        // Dismiss a leftover MAIN modal we don't recognize as one of ours — the
        // quest-completion reward scroll (send_quest_complete opens it; nothing
        // else in the loop closes it). A move packet closes it as a side effect,
        // which is why walk-first transitions never showed this — but a
        // transition that starts with a talk, or a quest that immediately waits
        // (live 2026-07-16: pickaxe-less Doric after Rune Mysteries), leaves the
        // scroll up and interactions swallowed. Bank/make-menu modals are OURS
        // mid-step and must never be closed from here.
        if (reader.modals().main !== -1 && !Bank.isOpen() && !ChatDialog.isMakeMenu() && !ChatDialog.isMainMakePanel()) {
            // closeModal() clicks the modal's CLOSE_BUTTON — it clears reward scrolls
            // and shops, but interfaces with NO close button (the Baxtorian book,
            // opheld Read) make it return false. Only intercept-and-reenter when we
            // actually closed something; otherwise fall through so the quest STEP
            // runs — its own movement dismisses the buttonless modal server-side (a
            // move packet closes these). Returning unconditionally livelocked at the
            // waterfall bookcase, re-logging every loop while the book never closed
            // and the quest step never got to walk (live 2026-07-17).
            if (actions.closeModal()) {
                this.host.log('closed a leftover main modal (quest-complete scroll)');
                await Execution.delayTicks(1);
                return;
            }
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
        // Consume the flag EVERY loop (clearing it) regardless of runningId —
        // otherwise a Skip pressed while nothing runs stays latched and would
        // silently park the NEXT quest picked. Act on it only when one is running.
        const skip = this.host.consumeSkip();
        if (skip && this.runningId !== null) {
            // Plain park, NOT parkOrGiveUp: a human pressed Skip, so it must not
            // count toward the no-progress give-up tally (that cap is only for
            // quests the engine itself can't make progress on).
            this.host.log(`skip requested — parking ${this.nameOf(this.runningId, elig)}`);
            this.parked.add(this.runningId);
            this.resetWatchdog();
            this.runningId = null;
        }

        // Death recovery (spec: death = involuntary deposit-everything + a
        // teleport). Everything re-derives from journal + inventory, so the
        // whole recovery is: forget this quest's provisioning state so
        // bank-first re-gears it (spares come back out of the bank), reset the
        // watchdog, and let the ordinary decide loop walk back via its own
        // next step. No park: the quest keeps running. consumeDeath fires EVERY
        // loop (clearing the latch) even when no quest runs — same
        // unconditional-consume lesson as Skip above.
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

        // --- 5. spillover deposit (once per quest), provisioning, then decide ---
        let step: QuestStep;
        if (!this.deposited.has(id)) {
            // Keep = the quest's own record items + its declared tools/internals.
            const keep = [
                ...module.record.items.map(i => i.name.toLowerCase()),
                ...(module.tools ?? [])
            ];
            const spillover = depositPlan(snap.inv, keep);
            if (spillover.length === 0) {
                this.deposited.add(id); // clean pack: no bank trip earned
            } else {
                this.host.noteState(rows, id, 'banking spillover', this.noProgressCount, this.parked.size);
                const banked = await executeStep({ kind: 'deposit', keep }, module.hops ?? [], m => this.host.log(`  ${m}`));
                if (banked) {
                    this.deposited.add(id);
                }
                this.refreshBankCounts(); // the trip just updated what bank-first can see
                await Execution.delayTicks(1);
                return; // re-enter with a fresh snapshot next loop
            }
        }
        if (!this.provisioned.has(id)) {
            const plan = planProvisioning(module.record.items, snap.inv, this.lastBankCounts);
            // Default coin float rides along with the record-item withdrawals so it
            // costs no extra bank trip. null once the pack holds the float or the
            // bank is dry; refreshBankCounts() after each step terminates a partial
            // drain (next pass sees banked===0), so this can't re-withdraw forever.
            const coinFloat = coinFloatWithdraw(snap.inv, this.lastBankCounts, COIN_FLOAT);
            // Quests that declare `food` carry N of the AIOQuester's configured food
            // item, withdrawn from the bank once here (rides the same bank trip).
            // Best-effort: no food configured or a dry bank simply carries none.
            const foodItem = this.host.foodItem();
            const foodFloat = (module.food && foodItem)
                ? floatWithdraw(snap.inv, this.lastBankCounts, foodItem, module.food)
                : null;
            const extras = [coinFloat, foodFloat].filter((w): w is { name: string; qty: number } => w !== null);
            if (plan.blocked.length > 0 && plan.withdraw.length === 0) {
                // A mustHave we can't buy/gather and the bank doesn't hold. PARK
                // (not block): this is usually a transient bank/inv read race, so
                // the quest must stay retryable after everything else has had a
                // turn — block() would permanently exclude it for the session.
                // Mirror the watchdog park path (parked/reset/runningId=null) and
                // record the shortfall so the PARKED row names the missing item.
                this.host.log(`${module.record.name} short on items: ${plan.blocked.join(', ')} — parking`);
                this.parkedReasons.set(id, plan.blocked.map(b => `missing: ${b}`));
                this.parkOrGiveUp(id, module.record.name);
                this.resetWatchdog();
                this.runningId = null;
                const blk = this.applyBlocked(queueRows(this.order, picked, elig, this.parked, null));
                this.host.noteState(blk, null, `parked: ${plan.blocked.join(', ')}`, this.noProgressCount, this.parked.size);
                return;
            } else if (plan.withdraw.length > 0 || extras.length > 0) {
                // Withdraw record items and/or the coin/food floats first (one bank
                // trip); re-planning next loop picks up any pending gather.
                step = { kind: 'withdraw', items: [...plan.withdraw, ...extras] };
            } else if (plan.satisfied) {
                this.provisioned.add(id);
                step = module.decide(snap);
            } else {
                // Gather the first shortfall via the module's per-item gatherer.
                const want = plan.gather[0];
                const gatherFn = module.gather?.[want.name.toLowerCase()];
                if (!gatherFn) {
                    // An acquirable item with no gatherer is a def bug — PERMANENTLY
                    // block it (deliberate: unlike a provisioning race, a broken def
                    // cannot fix itself by retrying, so we exclude it for the session
                    // rather than park — a reviewed deviation from the plan's 'park').
                    // Blocks (not spins) so the ERROR is visible and non-fatal.
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

        // Wait-step liveness: a wait that never resolves must park, not spin
        // (see WAIT_PARK). Keyed by quest+reason so a NEW reason restarts the
        // count and ordinary journal-load waits (1-3 loops) never come close.
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

        const ok = await executeStep(step, module.hops ?? [], m => this.host.log(`  ${m}`));

        // --- 7. watchdog: only steps that TRIED to move the world are counted ---
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

    /** Park a quest for no-progress — or, once it has been parked PARK_GIVE_UP
     *  times, permanently block() it instead. Live: a parked quest that is the
     *  only runnable one is re-picked immediately (parked = retry-last) and the
     *  watchdog was reset on park, so it burns another no-progress budget and
     *  re-parks, forever (Doric alternating 'no progress … parking' after the
     *  Clay x3 freeze — queue never drains, runner never stops). Routing to the
     *  existing block() path after N parks lets the queue drain and surfaces the
     *  reason in the Queue tab. Callers still reset the watchdog / clear
     *  runningId themselves. Manual Skip does NOT come through here (a human's
     *  choice must not count toward giving up). */
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

    /** Overlay locally-tracked reasons onto the pure queue rows: hard blocks
     *  become BLOCKED; a provisioning shortfall keeps its PARKED status but swaps
     *  the generic 'no progress — parked' string for the specific missing item(s)
     *  (guarded to the PARKED row so it never bleeds onto a RUNNING/READY row). */
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
            noProgress: this.noProgressCount,
            bankCoins: this.lastBankCounts.get('coins') ?? 0
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
        // Coins are engine-relevant (buy steps / gpShort affordability), not a
        // quest-record item — track them unconditionally or snap.bankCoins would
        // stay 0 forever (no record declares Coins; review catch, PAW Task 1).
        next.set('coins', Bank.count('Coins'));
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
