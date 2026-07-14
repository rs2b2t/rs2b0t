/**
 * ClueExecutor — the reactive easy-clue solve loop.
 *
 * Drives a held clue trail to completion by RE-IDENTIFYING the next step from
 * the pack every iteration (identifyStep is pure) and dispatching the
 * matching client action. Because the whole decision is a function of the held
 * items, the loop is idempotent: a relog or mis-timed interrupt just re-enters
 * at the same step on the next call. No progress varp is read (trail_status is
 * server-only), and no client state is cached.
 *
 * Random events: this function CANNOT handle them itself — the Supervisor only
 * runs the event handler on a fresh loop() launch, and Scheduler.pump() gates
 * that on `!loopInFlight`, which stays true for this entire call. So on a
 * pending event solveHeldClue RETURNS 'yield' immediately, handing control back
 * to the loop() boundary; the caller re-invokes it after the Supervisor clears
 * the event and the idempotent re-identify resumes the same step.
 *
 * Step mechanics (verified against the rs2b2t-content game_trail scripts):
 *   - search: walk to the clue coord and interact the loc there with its
 *     search-style op. Crates/boxes/open-chests offer 'Search'; a closed
 *     chest/drawer offers 'Open' — and BOTH fire the trail interaction directly
 *     (chests.rs2/crates.rs2/drawers.rs2 all call `@trail_clue_loc_interact`
 *     off the container op when the held clue's trail_coord matches loc_coord).
 *   - dig: stand within 1 tile of the coord and use the Spade's 'Dig' op
 *     (spade.rs2 opheld1 dels the clue, adds the casket). Needs a Spade.
 *   - talk: walk to the NPC's area and Talk-to; the clue check is the FIRST
 *     branch of each opnpc1 handler and jumps to the clue label, so the normal
 *     dialogue options are bypassed (verified: ned/bluemoon_bartender/squire) —
 *     hence `prefer: []` is safe.
 *   - open-casket: use the held casket's 'Open' op. A reward casket takes
 *     precedence over a scroll (identifyStep), so this always runs first.
 *
 * Modal shapes: intermediate "another clue"/"found a casket!" popups are
 * objboxes → CHAT modals with a continue button (drain via ChatDialog); the
 * final trail_reward is `if_openmain` → a MAIN modal dismissed with
 * actions.closeModal() (its BUTTON_CLOSE is present). Reward loot is added to the
 * pack before the interface shows, so a null step == trail complete.
 *
 * Progress is verified by watching the HELD id set change — a step consumed its
 * own object (the tracked id leaves the pack) or the inventory signature moved
 * at all. No unit tests: behaviour is proven by the Task 7 live smoke; the
 * decision logic it leans on (identifyStep) is already tested.
 */
import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/Execution.js';
import { EventSignal } from '#/bot/api/EventSignal.js';
import Tile from '#/bot/api/Tile.js';
import { Traversal } from '#/bot/api/Traversal.js';
import { ChatDialog } from '#/bot/api/hud/ChatDialog.js';
import { Inventory } from '#/bot/api/hud/Inventory.js';
import { Locs } from '#/bot/api/queries/Locs.js';
import type { Loc } from '#/bot/api/entities/index.js';
import { identifyStep } from '#/bot/clues/ClueLogic.js';
import { ClueTrace, pushTraceRing } from '#/bot/clues/ClueTrace.js';
import { CASKET_IDS, CLUE_DB } from '#/bot/clues/data/cluedb.js';
import type { ClueStep } from '#/bot/clues/types.js';
import type { NavPoint } from '#/bot/nav/PathFinder.js';
import { gotoNpc, talkThrough, type NpcStop } from '#/bot/quests/exec/primitives.js';

const SPADE = 'Spade';

/** Search-style loc ops that trigger the trail interaction, in priority order.
 *  'Search' covers crates/boxes/open containers; 'Open' covers closed chests and
 *  drawers (op1 Open fires the interaction directly when the clue matches).
 *  Deliberately excludes 'Look-at' and the like — those are no-ops for trails. */
const SEARCH_OPS = ['Search', 'Open'];

const ARRIVE_RADIUS = 1; // dig checks distance<=1; search locs sit on the clue coord
const NPC_LEASH = 10; // NPCs wander; talkThrough re-finds them from the anchor
const WALK_ATTEMPTS = 4; // bounded so an unreachable coord escalates to abandon
const WALK_TIMEOUT_MS = 45_000; // per baked-walk pass
const STEP_ATTEMPTS = 4; // interact tries per step before abandoning
const PROGRESS_MS = 6000; // wait for the held id set to change after an action
const MAX_STEPS = 20; // trail steps solved before giving up (trails are 2-4)
const OUTER_GUARD = 1000; // total loop iterations incl. random-event yields
const REWARD_WAIT_MS = 2000; // let the trail_reward main modal open after the last step
const REWARD_CLOSE_TRIES = 5;

/**
 * Talk-clue NPC anchors, keyed by CLUE obj id (NOT display name — two easy clues
 * both talk to a "Bartender": id 2686 = Blue Moon Inn, Varrock and id 2696 =
 * Rusty Anchor, Port Sarim, at completely different tiles). Each tile is the
 * NPC's exact spawn read from the map's `==== NPC ====` section
 * (rs2b2t-content/maps); gotoNpc arrives within 1 tile and talkThrough re-finds
 * the NPC within NPC_LEASH, so a counter-front arrival is fine.
 */
export const TALK_ANCHORS: Record<number, Tile> = {
    2681: new Tile(3207, 3233, 0), // Hans — Lumbridge Castle courtyard
    2683: new Tile(3288, 3190, 0), // Zeke — Al Kharid scimitar stall
    2684: new Tile(3276, 3193, 0), // Tanner (Ellis) — Al Kharid tannery
    2686: new Tile(3226, 3399, 0), // Bartender — Blue Moon Inn, Varrock
    2693: new Tile(2977, 3342, 0), // Squire — White Knights' Castle, Falador
    2696: new Tile(3045, 3257, 0), // Bartender — Rusty Anchor Inn, Port Sarim
    2697: new Tile(3100, 3258, 0), // Ned — Draynor Village wheat field (smoke target)
    2698: new Tile(2952, 3451, 0), // Doric — Doric's hut, north of Falador
    2699: new Tile(2885, 3449, 0), // Gaius — weapon shop, Taverley
    2701: new Tile(2803, 3430, 0), // Arhein — Catherby waterfront
    2702: new Tile(2761, 3497, 0), // Sir Kay — Camelot Castle
    3496: new Tile(3028, 3216, 0), // Captain Tobias — Port Sarim docks
    3513: new Tile(2734, 3581, 0), // Louisa — Sinclair Mansion (Seers' area)
    3514: new Tile(3361, 3242, 0) // Jeed — Duel Arena, east of Al Kharid
};

export const TRACE_STORAGE_KEY = 'rs2b0t:cluetrace';

/** Live progress of the solve in flight (overlays/debugging), null when idle.
 *  `leg` is the trail position BEST GUESS — steps completed this session + 1;
 *  the server's real trail position isn't client-readable. */
export interface ClueProgress {
    clueId: number;
    name: string;
    step: string;
    leg: number;
    attempt: number;
    startedAt: number;
}

/** 'trail_clue_easy_simple021' → 'easy simple021' (overlay-sized name). */
function shortClueName(obj: string): string {
    return obj.replace(/^trail_clue_/, '').replace(/_/g, ' ');
}

const trace = new ClueTrace({
    pos: () => {
        const me = reader.worldTile();
        return me ? `${me.x},${me.z},${me.level}` : '?';
    }
});

// One logical solve spans MANY solveHeldClue calls (every random event yields
// back to loop() and the caller re-invokes) — so the trace, the leg counter,
// and the published progress live at module scope and only reset when the
// solve genuinely ends (done/abandon), not on a yield.
let sessionActive = false;
let sessionLegs = 0;

/** Held obj ids in the pack right now. */
function heldIds(): number[] {
    return Inventory.items().map(i => i.id);
}

/** Signature of the whole pack (id + count) — changes when any step consumes a
 *  clue/casket, digs up a casket, or drops reward loot. */
function heldSignature(): string {
    return Inventory.items()
        .map(i => `${i.id}x${i.count}`)
        .sort()
        .join(',');
}

/** The obj id this step consumes — a scroll's id, or the casket's id. */
function trackedId(step: ClueStep): number {
    return step.type === 'open-casket' ? step.casketId : step.id;
}

/** Human log label for a step. */
function describeStep(step: ClueStep): string {
    if (step.type === 'open-casket') {
        return `${step.casketObj} (open-casket)`;
    }
    if (step.type === 'talk') {
        return `${step.obj} (talk ${step.npc ?? '?'})`;
    }
    const c = step.coord;
    return `${step.obj} (${step.type})${c ? ` at (${c.x},${c.z},${c.level})` : ''}`;
}

/** The loc at (or beside) `coord` whose ops include a search-style verb, and the
 *  op to use. Prefers the loc nearest the exact coord, then the higher-priority
 *  op ('Search' over 'Open'). Null when nothing searchable is in scene there. */
function pickSearchLoc(coord: NavPoint): { loc: Loc; op: string } | null {
    let best: { loc: Loc; op: string; dist: number; rank: number } | null = null;
    for (const loc of Locs.query().results()) {
        const tile = loc.tile();
        if (tile.level !== coord.level) {
            continue;
        }
        const dist = tile.distanceTo(coord);
        if (dist > ARRIVE_RADIUS) {
            continue;
        }
        const ops = loc.actions();
        const rank = SEARCH_OPS.findIndex(v => ops.some(a => a.toLowerCase() === v.toLowerCase()));
        if (rank === -1) {
            continue;
        }
        if (best === null || dist < best.dist || (dist === best.dist && rank < best.rank)) {
            best = { loc, op: SEARCH_OPS[rank], dist, rank };
        }
    }
    return best ? { loc: best.loc, op: best.op } : null;
}

/** Drain any open objbox / continue-page chat popup so the next interact isn't
 *  blocked by a busy player. Bounded — clue objboxes are 1-2 pages; the cap only
 *  guards against a modal that never advances. */
async function drainChat(): Promise<void> {
    for (let i = 0; i < 10 && ChatDialog.canContinue(); i++) {
        await ChatDialog.continue();
    }
}

/** Dispatch the one client action for `step`. Positioning + interaction only —
 *  progress is verified by the caller. */
async function dispatch(step: ClueStep, log: (m: string) => void): Promise<void> {
    switch (step.type) {
        case 'search': {
            if (!step.coord) {
                return;
            }
            // On a failed/interrupted walk, don't interact from wherever we
            // stopped — bail and let the next attempt re-walk (or the outer loop
            // yield on a pending event). Avoids wasted attempts mid-event.
            if (!(await Traversal.walkResilient(step.coord, { radius: ARRIVE_RADIUS, attempts: WALK_ATTEMPTS, timeoutMs: WALK_TIMEOUT_MS, log }))) {
                return;
            }
            const pick = pickSearchLoc(step.coord);
            if (pick) {
                await pick.loc.interact(pick.op);
            } else {
                log(`no searchable loc at (${step.coord.x},${step.coord.z},${step.coord.level})`);
            }
            return;
        }
        case 'dig': {
            if (!step.coord) {
                return;
            }
            // Dig is a held-op that acts in place, so we MUST be within 1 tile —
            // bail if the walk didn't arrive rather than dig at the wrong spot.
            if (!(await Traversal.walkResilient(step.coord, { radius: ARRIVE_RADIUS, attempts: WALK_ATTEMPTS, timeoutMs: WALK_TIMEOUT_MS, log }))) {
                return;
            }
            const spade = Inventory.first(SPADE);
            if (spade) {
                await spade.interact('Dig');
            }
            return;
        }
        case 'talk': {
            const anchor = TALK_ANCHORS[step.id];
            if (!anchor || !step.npc) {
                return;
            }
            const stop: NpcStop = { npc: step.npc, anchor, leash: NPC_LEASH, prefer: [] };
            if (await gotoNpc(stop, [], log)) {
                await talkThrough(step.npc, [], log);
            }
            return;
        }
        case 'open-casket': {
            const casket = Inventory.items().find(i => i.id === step.casketId);
            if (casket) {
                await casket.interact('Open');
            }
            return;
        }
    }
}

/** Reasons a step can't be attempted at all (missing tool / no anchor). */
function blockReason(step: ClueStep): string | null {
    if (step.type === 'dig' && !Inventory.first(SPADE)) {
        return 'no Spade held';
    }
    if (step.type === 'talk' && (!step.npc || !TALK_ANCHORS[step.id])) {
        return `no anchor for NPC '${step.npc ?? '?'}'`;
    }
    return null;
}

/**
 * Solve one identified step: retry the client action up to STEP_ATTEMPTS times,
 * verifying after each that the held id set moved (the step consumed its clue /
 * casket, or dug one up). Returns true once progress is seen; false if the step
 * is stuck OR a random event fired mid-step — the caller distinguishes the two
 * (it re-checks EventSignal.pending() and yields rather than abandoning).
 */
async function solveStep(step: ClueStep, log: (m: string) => void, onAttempt: (n: number) => void): Promise<boolean> {
    const tracked = trackedId(step);
    const sigBefore = heldSignature();
    const progressed = (): boolean => !heldIds().includes(tracked) || heldSignature() !== sigBefore;

    for (let attempt = 0; attempt < STEP_ATTEMPTS; attempt++) {
        if (progressed()) {
            return true;
        }
        if (EventSignal.pending()) {
            return false; // bail to the caller → loop() boundary so the Supervisor can handle it
        }
        onAttempt(attempt + 1);
        await drainChat();
        await dispatch(step, log);
        if (await Execution.delayUntil(progressed, PROGRESS_MS)) {
            return true;
        }
    }
    return progressed();
}

/** Close the trail_reward main modal (loot is already in the pack). */
async function dismissRewardModal(): Promise<void> {
    await Execution.delayUntil(() => reader.modals().main !== -1, REWARD_WAIT_MS);
    for (let i = 0; i < REWARD_CLOSE_TRIES && reader.modals().main !== -1; i++) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
}

export const ClueExecutor = {
    /** Live progress of the solve in flight — overlays read this; null when idle. */
    current: null as ClueProgress | null,

    /**
     * Run the held clue trail. Returns 'done' when nothing clue-like remains in
     * the pack (the trail finished — the reward modal is dismissed on the way
     * out); 'abandon' when a step can't be made or makes no progress after its
     * bounded attempts; or 'yield' when a random event is pending — solveHeldClue
     * returns to the loop() boundary so the Supervisor can handle it, and the
     * caller re-invokes this (the re-identify resumes the same step).
     */
    async solveHeldClue(log: (m: string) => void): Promise<'done' | 'abandon' | 'yield'> {
        const tlog = (m: string): void => {
            trace.note(m);
            log(m);
        };
        const end = (outcome: 'done' | 'abandon', reason?: string): 'done' | 'abandon' => {
            if (outcome === 'abandon') {
                dumpFailure(reason ?? 'unknown', log);
            }
            sessionActive = false;
            sessionLegs = 0;
            ClueExecutor.current = null;
            return outcome;
        };

        for (let guard = 0; guard < OUTER_GUARD; guard++) {
            if (EventSignal.pending()) {
                trace.note('yield — random event pending');
                return 'yield'; // hand back to loop(); loopInFlight blocks the Supervisor until we return
            }
            await drainChat();

            const step = identifyStep(heldIds(), CLUE_DB, CASKET_IDS);
            if (step === null) {
                await dismissRewardModal();
                tlog('trail complete');
                return end('done');
            }

            const clueId = trackedId(step);
            const name = shortClueName(step.type === 'open-casket' ? step.casketObj : step.obj);
            if (!sessionActive) {
                // First step of a NEW solve (yield re-entries keep the session)
                trace.begin(clueId, name);
                sessionActive = true;
                sessionLegs = 0;
            }
            ClueExecutor.current = { clueId, name, step: describeStep(step), leg: sessionLegs + 1, attempt: 0, startedAt: ClueExecutor.current?.startedAt ?? Date.now() };

            if (sessionLegs >= MAX_STEPS) {
                const reason = `exceeded ${MAX_STEPS} steps`;
                tlog(`abandoning ${describeStep(step)}: ${reason}`);
                return end('abandon', reason);
            }

            const blocked = blockReason(step);
            if (blocked) {
                tlog(`abandoning ${describeStep(step)}: ${blocked}`);
                return end('abandon', blocked);
            }

            tlog(`leg ${sessionLegs + 1} — solving ${describeStep(step)} [${clueId}]`);
            const onAttempt = (n: number): void => {
                if (ClueExecutor.current) {
                    ClueExecutor.current.attempt = n;
                }
                if (n > 1) {
                    trace.note(`attempt ${n}/${STEP_ATTEMPTS}`);
                }
            };
            if (!(await solveStep(step, tlog, onAttempt))) {
                if (EventSignal.pending()) {
                    trace.note('yield — event fired mid-step');
                    return 'yield'; // Supervisor handles it next loop; idempotent re-identify resumes this step
                }
                const reason = `no progress after ${STEP_ATTEMPTS} attempts`;
                tlog(`abandoning ${describeStep(step)}: ${reason}`);
                return end('abandon', reason);
            }
            tlog('step done');
            sessionLegs++;
        }
        tlog('abandoning: loop guard reached (stuck?)');
        return end('abandon', 'loop guard reached');
    }
};

/** Emit the trace three ways: a marked block in the script log, one structured
 *  console.error (copy from devtools), and the persisted last-5-failures ring
 *  (localStorage) that rs2b0t.clueTraces() reads back. */
function dumpFailure(reason: string, log: (m: string) => void): void {
    const dump = trace.dump(reason, sessionLegs);
    log(`==== clue trace (abandon: ${reason}) — ${dump.name} [${dump.clueId ?? '?'}], ${dump.legs} leg${dump.legs === 1 ? '' : 's'} solved ====`);
    const t0 = dump.lines[0]?.t ?? dump.startedAt;
    for (let i = 0; i < dump.lines.length; i++) {
        const l = dump.lines[i];
        log(`  ${i + 1}. +${((l.t - t0) / 1000).toFixed(1)}s @${l.pos} ${l.m}`);
    }
    log('==== end clue trace ====');
    console.error('[rs2b0t] clue solve failed', JSON.stringify(dump));
    if (typeof localStorage !== 'undefined') {
        pushTraceRing(localStorage, TRACE_STORAGE_KEY, dump);
    }
}
