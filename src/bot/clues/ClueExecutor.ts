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
import { Sustain } from '#/bot/api/Sustain.js';
import { Traversal } from '#/bot/api/Traversal.js';
import { Game } from '#/bot/api/Game.js';
import { ChatDialog } from '#/bot/api/hud/ChatDialog.js';
import { Inventory } from '#/bot/api/hud/Inventory.js';
import { GroundItems } from '#/bot/api/queries/GroundItems.js';
import { Locs } from '#/bot/api/queries/Locs.js';
import { Npcs } from '#/bot/api/queries/Npcs.js';
import type { Loc } from '#/bot/api/entities/index.js';
import { identifyStep } from '#/bot/clues/ClueLogic.js';
import { ClueTrace, pushTraceRing } from '#/bot/clues/ClueTrace.js';
import { CASKET_IDS, CLUE_DB } from '#/bot/clues/data/cluedb.js';
import { challengeAnswer } from '#/bot/clues/data/challengeAnswers.js';
import { KILL_ANCHORS } from '#/bot/clues/data/killAnchors.js';
import { ensureSpade, ensureCoordTools } from '#/bot/clues/AcquireTools.js';
import type { ClueRow, ClueStep } from '#/bot/clues/types.js';
import type { NavPoint } from '#/bot/nav/PathFinder.js';
import { gotoNpc, talkThrough, type NpcStop } from '#/bot/quests/exec/primitives.js';

const SPADE = 'Spade';

/** Coordinate (sextant) clues assume the Observatory Quest is done and these
 *  three items exist; without all three held the dig can never yield the casket,
 *  so blockReason abandons the clue cleanly rather than digging fruitlessly. */
const COORD_ITEMS = ['Sextant', 'Watch', 'Chart'];

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
// The challenge reply chatnpc opens ~2 ticks after answerCountDialog (the
// script p_delay(0)s before it) — generous bound on that round trip.
const CHALLENGE_REPLY_MS = 3000;

// Kill-for-key riddles: a locked container needs a key that drops when a named
// NPC is killed with the clue held. Bounded so a not-co-located NPC (e.g. a
// wilderness spawn far from the container) abandons the riddle gracefully.
const KEY_WALK_RADIUS = 5; // get within this of the container, then find the NPC there
const KILL_WAIT_MS = 20_000; // per fight: Attack → NPC dead / key on the ground
const LOOT_WAIT_MS = 3000; // key ground-item Taken into the pack

export { TALK_ANCHORS } from '#/bot/clues/data/talkAnchors.js';
import { TALK_ANCHORS } from '#/bot/clues/data/talkAnchors.js';

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
let acquireTries = 0; // bounded tool-acquisition attempts this solve

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

/**
 * The six medium "challenge" anagram clues pose a maths question mid-talk: after
 * the question chat closes, an integer-input count dialog opens (the same
 * `p_countdialog` "Enter amount" shape as Bank.withdrawX). When one is open while
 * solving one of those talk steps, enter its fixed answer via the same count
 * path Bank.withdrawX uses (`reader.countDialogOpen()` + `actions.answerCountDialog`).
 * The question text is gone by then (if_close precedes p_countdialog), so we key
 * the answer on the held anagram clue's obj id (`step.id`), not the prompt.
 * Returns true iff it answered. If the id has no known answer we leave the dialog
 * untouched (the step then abandons cleanly) rather than enter a wrong number.
 *
 * The answer alone does NOT advance the trail: the script then chatnpc's the
 * "Well done!" reply (a PAUSEBUTTON page) and only runs inv_del + the progress
 * label AFTER that page's continue is clicked. So after answering we wait for
 * the reply (it opens a couple ticks later — p_delay(0) precedes the chatnpc)
 * and drive its continue pages right here. The caller must not re-dispatch on
 * this attempt: gotoNpc would pathfind back to the anchor under the open page,
 * leaving the dialogue unfinished (the live 2026-07-20 stuck-pathfinding bug).
 */
async function answerChallengeIfOpen(step: ClueStep, log: (m: string) => void): Promise<boolean> {
    if (step.type !== 'talk' || !reader.countDialogOpen()) {
        return false;
    }
    const n = challengeAnswer(step.id);
    if (n === null) {
        log(`challenge count dialog open but no answer for clue ${step.id} — leaving it (step will abandon)`);
        return false;
    }
    actions.answerCountDialog(n);
    log(`challenge answered: ${n}`);
    if (!(await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), CHALLENGE_REPLY_MS))) {
        log('challenge reply page never opened — leaving it to the next attempt');
        return true; // answered regardless — the caller must still not re-dispatch
    }
    await drainChat(); // "Well done!" continue (consumes the clue) + the next-clue objbox
    return true;
}

/**
 * Kill-for-key: get the riddle key into the pack so the caller can search the
 * container. Idempotent — returns true immediately when the key is already held
 * (a re-entry after a partial attempt skips straight to the search).
 *
 * The key drops when the matching NPC dies ANYWHERE with the clue held
 * (trail_clue_medium.rs2 `trail_checkmediumdrop` → obj_add at the NPC's death
 * coord) — the killer is NOT co-located with the locked container it opens (e.g.
 * riddle004's drawers sit ~58 tiles from the nearest Chicken; riddle005's Man is
 * one floor below its upstairs container). So we walk to where the killer roams
 * (`huntTile`, the killAnchors spawn), fight the nearest matching NPC IN SCENE,
 * loot the key at its death coord, and only then does the caller walk on to the
 * container to search. Bounded throughout; returns false — abandoning the riddle
 * gracefully — when no matching NPC is found near the hunt tile or the fight/loot
 * doesn't yield the key in time.
 */
async function acquireRiddleKey(kf: NonNullable<ClueRow['keyFrom']>, huntTile: NavPoint, log: (m: string) => void): Promise<boolean> {
    const haveKey = (): boolean => Inventory.items().some(i => i.id === kf.keyId);
    if (haveKey()) {
        return true; // already looted on a prior attempt — go straight to the search
    }
    // Walk to the killer's spawn. We don't gate on the walk outcome: a partial
    // arrival often still leaves the roamer in the loaded scene; if it genuinely
    // isn't reachable the query below finds none → abandon.
    await Traversal.walkResilient(huntTile, { radius: KEY_WALK_RADIUS, attempts: WALK_ATTEMPTS, timeoutMs: WALK_TIMEOUT_MS, log });
    // EntityQuery.name() is CASE-INSENSITIVE (see queries/Query.ts), so the
    // lowercase content token 'pirate' still matches the 'Pirate' display name;
    // generic tokens ('Chicken', 'Man') match those display names the same way.
    // Scene-wide (no within-leash): the roamer can sit a few tiles off the anchor.
    let target = Npcs.query().name(kf.npc).action('Attack').nearest();
    if (!target) {
        log(`kill-for-key: no '${kf.npc}' near (${huntTile.x},${huntTile.z}) — abandoning riddle`);
        return false;
    }
    // Close the last tiles to the roamer before attacking (the interact server-walk
    // won't cross a baked door to it), then re-find — it may have wandered.
    if (target.distance() > 1) {
        await Traversal.walkResilient(target.tile(), { radius: 1, attempts: 2, timeoutMs: WALK_TIMEOUT_MS, log });
        target = Npcs.query().name(kf.npc).action('Attack').nearest() ?? target;
    }
    await target.interact('Attack');
    // Match the dropped key by its exact obj id (kf.keyObj is a CONTENT obj name,
    // not the display name a GroundItem carries, so a name match is unreliable and
    // could grab a stray key; the id is the same discriminator the pack uses).
    const keyOnGround = () => GroundItems.query().where(g => g.id === kf.keyId).nearest();
    // Dead = the key is in the pack, OR on the ground, OR the target is gone and
    // the fight is over (a faster exit than waiting out KILL_WAIT_MS on a miss).
    await Execution.delayUntil(() => haveKey() || keyOnGround() !== null || (!target.valid() && !Game.inCombat()), KILL_WAIT_MS);
    const key = keyOnGround();
    if (key) {
        // The key drops at the death coord, which can be a couple tiles off (the
        // NPC wandered mid-fight) — close in before Take so it isn't a no-op.
        if (key.distance() > 1) {
            await Traversal.walkResilient(key.tile(), { radius: 1, attempts: 2, timeoutMs: WALK_TIMEOUT_MS, log });
        }
        await key.interact('Take');
        await Execution.delayUntil(haveKey, LOOT_WAIT_MS);
    }
    return haveKey();
}

/** Dispatch the one client action for `step`. Positioning + interaction only —
 *  progress is verified by the caller. */
async function dispatch(step: ClueStep, log: (m: string) => void): Promise<void> {
    switch (step.type) {
        case 'search': {
            if (!step.coord) {
                return;
            }
            // Kill-for-key riddles fight the NPC + loot the key BEFORE searching
            // the locked container. Idempotent across attempts (the key persists
            // in the pack); if the key can't be had, bail so solveStep retries or
            // abandons after STEP_ATTEMPTS.
            const kf = (step as ClueRow).keyFrom;
            if (kf) {
                // Hunt the killer at ITS spawn (killAnchors), not the container —
                // the key drops wherever the NPC dies. Fall back to the container
                // coord when no anchor is known (then it abandons if nothing's there).
                const huntTile = KILL_ANCHORS[step.id] ?? step.coord;
                if (!(await acquireRiddleKey(kf, huntTile, log))) {
                    return;
                }
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
            // Coordinate (needsSextant) digs are item-gated in blockReason above,
            // so by the time we get here the required items are held.
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
            // A dialogue already up (e.g. a challenge reply that opened after
            // this attempt's drain) must be driven, never walked away from —
            // pathfinding with the page open leaves the paused script hanging.
            if (ChatDialog.isOpen() || ChatDialog.canContinue()) {
                await talkThrough(step.npc, [], log);
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
    if (step.type === 'dig' && (step as ClueRow).needsSextant) {
        const missing = COORD_ITEMS.filter(n => !Inventory.first(n));
        if (missing.length > 0) {
            return `coordinate clue needs ${missing.join('+')} (not held)`;
        }
    }
    return null;
}

/** Attempt to acquire the tool a dig step is blocked on. Spade for any dig;
 *  the sextant trio for a coordinate dig. Returns true only when the tool is
 *  now held (ensure* verify), so the caller's re-identify clears blockReason. */
async function tryAcquire(step: ClueStep, log: (m: string) => void): Promise<boolean> {
    if (step.type !== 'dig') {
        return false;
    }
    if (!Inventory.first(SPADE)) {
        return ensureSpade(log);
    }
    if ((step as ClueRow).needsSextant && COORD_ITEMS.some(n => !Inventory.first(n))) {
        return ensureCoordTools(log);
    }
    return false;
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
        await Sustain.run(); // eat between interact attempts — steps can sit in aggro zones
        onAttempt(attempt + 1);
        await drainChat();
        // A challenge talk step leaves a count dialog open once talkThrough has
        // driven the question chat closed; answerChallengeIfOpen answers it and
        // drives the reply's continue pages itself — the trail advances on that
        // continue, so when it answered we must NOT dispatch (gotoNpc would
        // pathfind under the reply page); just check for progress.
        if (!(await answerChallengeIfOpen(step, log))) {
            await dispatch(step, log);
        }
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
            acquireTries = 0;
            ClueExecutor.current = null;
            return outcome;
        };

        for (let guard = 0; guard < OUTER_GUARD; guard++) {
            if (EventSignal.pending()) {
                trace.note('yield — random event pending');
                return 'yield'; // hand back to loop(); loopInFlight blocks the Supervisor until we return
            }
            await Sustain.run(); // eat between trail legs (walks cover themselves via the walker's hook)
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
                acquireTries = 0;
            }
            ClueExecutor.current = { clueId, name, step: describeStep(step), leg: sessionLegs + 1, attempt: 0, startedAt: ClueExecutor.current?.startedAt ?? Date.now() };

            if (sessionLegs >= MAX_STEPS) {
                const reason = `exceeded ${MAX_STEPS} steps`;
                tlog(`abandoning ${describeStep(step)}: ${reason}`);
                return end('abandon', reason);
            }

            const blocked = blockReason(step);
            if (blocked) {
                // Try to acquire the missing tool instead of abandoning. Keyed
                // on the step (not the reason string). ensure* verify the item
                // is HELD before returning true, so a success clears blockReason
                // on the re-identify; a failure falls through to abandon. Bounded
                // by acquireTries so a spawn/NPC that never yields can't spin.
                if (acquireTries < 2 && (await tryAcquire(step, tlog))) {
                    acquireTries++;
                    continue; // re-identify; the block should be cleared now
                }
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
