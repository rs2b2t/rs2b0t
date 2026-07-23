// Tick-driven walk executor: turns a NavWorker path into game
// clicks. Called from scripts via Traversal.walkTo, so every wait goes
// through Execution.* — stop/pause/abort semantics hold exactly like any
// other script action.
//
// Loop: walk toward the furthest path tile within ~18 tiles that's inside
// the loaded scene; when the next path segment is an annotated door/
// transport crossing, approach it, interact with the annotated action and
// wait for the crossing to open (loc gone / level changed); on stall
// re-click, on repeated stall re-path from the current position.

import type { WorldTile } from '../adapter/ClientAdapter.js';
import { reader } from '../adapter/ClientAdapter.js';
import { EventSignal } from '../api/EventSignal.js';
import { CANT_REACH, GameMessages } from '../events/gameMessages.js';
import { Execution } from '../api/Execution.js';
import { Sustain } from '../api/Sustain.js';
import { Locs, type Loc } from '../api/queries/Locs.js';
import { Npcs } from '../api/queries/Npcs.js';
import { Inventory } from '../api/hud/Inventory.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { SPECIAL_CROSSINGS, specialCrossingAt, pickChoice, meetsRequirement, type SpecialCrossing } from './data/specialCrossings.js';
import { Reachability } from '../api/Reachability.js';
import { ActionRouter } from '../input/ActionRouter.js';
import { Navigator, type PathResult } from './Navigator.js';
import { DirectNavigator } from './DirectNavigator.js';
import type { TransportInfo, Waypoint } from './PathFinder.js';
import { chebyshev, chooseCrossClick, crossingEligible, isOnFarSide, locateOnPath, selectClickTarget, starvedTerminalIndex } from './followMath.js';
import { classifyReason } from './walkLadder.js';
import { isArrived } from './arrival.js';

const TARGET_STEPS = 20; // click target this many steps ALONG the path
const TARGET_JITTER = 4; // ± human-ish variance on TARGET_STEPS
const ARRIVE_RADIUS = 4; // reaching within this of the click target ⇒ pick the next one
const PROGRESS_WINDOW = 26; // how far ahead we look for our own position on the path
const CORRIDOR = 3; // on-path tolerance (client micro-routes differ from ours)
const OFF_CORRIDOR_STRIKES = 2; // consecutive off-corridor checks before repathing
const STALL_TICKS = 6; // no tile change for this many ticks while short of the target ⇒ stalled
// canReach BFS budget for re-checking the committed click target during stall
// bookkeeping: an RS door can swing shut AFTER we select a target, so re-probe
// reachability before crediting a no-move tick as progress.
const STALL_REACH_STEPS = 256;
// canReach BFS budget for the crossing-trigger gate: is the crossing's
// approach tile actually attainable from here, or merely Chebyshev-close
// through a wall? Runs at most once per proximate crossing per loop iteration.
const TRIGGER_REACH_STEPS = 256;
// Backstop: consecutive no-move loop iterations before the stall
// counter is allowed to grow regardless of target distance — catches the
// probe-proven click-starvation where canReach reads TRUE yet the bot never
// steps. Resets on any movement. Loose enough (each loop ≈ 2 ticks) not to trip
// on legitimate slow server-walks.
const STUCK_ITERS = 12;
// Handle a crossing once we're within reach of its approach tile. MUST be >=
// ARRIVE_RADIUS: the walker stops advancing its click target once within
// ARRIVE_RADIUS of it (the approach tile, when a crossing caps the click
// limit), so a smaller trigger leaves the bot stranded 2-4 tiles short of a
// staircase/gate — it never re-clicks and never fires the crossing (found live:
// NavDemo legs 1/3 timed out at stairs/pen-gate). The client walks the final
// tiles to the loc itself on interact.
const TRANSPORT_TRIGGER = ARRIVE_RADIUS;
const MAX_REPATHS = 5;
const PATH_REQUEST_TIMEOUT_MS = 30_000; // includes first-use worker boot + pack fetch
const TRANSPORT_WAIT_MS = 8000;
// Budget to open AND walk THROUGH a door (1-tile or multi-tile). Raised from
// 20s: each open-revert cycle costs open-wait + through-step, and the RS door
// auto-reverts — 36s fits ≥3 full cycles so a flaky-timing door still crosses
// within ONE attempt instead of burning the attempt and poisoning avoidDoors.
const MULTI_DOOR_CROSS_MS = 36_000;
// Per-open wait: the leaf state/edge usually flips within ~1s of the op landing;
// capping the wait short keeps revert cycles cheap inside MULTI_DOOR_CROSS_MS.
const OPEN_WAIT_MS = 4000;
// One scene-walk hop budget when the swung-open leaf blocks canReach to the
// landing (a 1-tile door in a solid wall — no bypass to route a click around).
// Small vs MULTI_DOOR_CROSS_MS so a genuinely stuck door still falls through to
// repath after a hop or two.
const SCENE_STEP_MS = 8000;
// Budget to walk ONTO a door's approach tile before opening + stepping through.
// One tile hop, so small; kept well under MULTI_DOOR_CROSS_MS so a door whose
// approach is momentarily unreachable still times the whole crossing out to
// repath rather than spinning here (see crossMultiTileDoor).
const APPROACH_WALK_MS = 3000;
const DIALOGUE_STEPS = 24; // max continue/choose iterations to drive a crossing dialogue
// Ships need a higher cap than the toll gate: the Musa Customs-officer voyage is
// a 3-choice flow (journey? -> search away -> Ok.) with several NPC lines between
// menus, then the pay + telejump — 24 can run out before the deck arrival.
const SHIP_DIALOGUE_STEPS = 40;
// A reopenAfterDialogue gate (Gnome Stronghold / Femi boxes) needs at most two
// Opens: the first runs the one-time boxes dialogue (no crossing), the second
// force-moves you through. An already-primed account crosses on the first Open
// (the crossed() guard exits the loop before a wasted second).
const GATE_REOPENS = 2;
const REACH_CHECK_STEPS = 1200; // BFS budget for validating a click target

export interface WalkOptions {
    /** Arrive when within this Chebyshev distance of dest (default 2). */
    radius?: number;
    /** Overall walk budget (default 300s — Lumbridge->Varrock walks ~2.5min). */
    timeoutMs?: number;
    /** Progress lines (path stats, transports, repaths) for the script log. */
    log?: (msg: string) => void;
    /** Override the pathfinder's node-expansion budget for this walk (default 300k). */
    maxExpansions?: number;
}

interface PathStep extends WorldTile {
    transport?: TransportInfo;
}

type FollowResult = 'arrived' | 'closest' | 'blocked' | 'repath' | 'failed' | 'interrupted';

/**
 * A shut door/gate we can walk through: its NAME reads as a door/gate AND it
 * offers an Open-style op. Pure — the filter behind the stall opener. Both gates
 * are load-bearing: the NAME filter stops the opener clicking a same-'Open'-op
 * Wardrobe/Chest next to a stalled bot (the live wardrobe-opening incident), and
 * matching the Open PREFIX (not the literal 'Open') catches 'Open-quietly'
 * variants. An OPEN door offers 'Close', so this only ever matches shut ones.
 */
export function isOpenableBarrier(name: string | null, ops: readonly (string | null)[]): boolean {
    return /(door|gate)/i.test(name ?? '') && ops.some(op => op !== null && /^open/i.test(op));
}

/**
 * An OPEN door/gate leaf: NAME reads as a door/gate AND it offers a Close-style
 * op. The dual of `isOpenableBarrier` — a shut leaf offers Open, an open one
 * offers Close — so this only ever matches leaves that are currently swung open.
 * Used to spot a transiently-swung-open leaf sitting on the tile under the
 * player (see the swung-leaf race in followPath's blocked-honesty branch).
 */
export function isOpenBarrierLeaf(name: string | null, ops: readonly (string | null)[]): boolean {
    return /(door|gate)/i.test(name ?? '') && ops.some(op => op !== null && /^close/i.test(op));
}

/** Expand direction-change waypoints back into the full tile path. */
function expandWaypoints(waypoints: Waypoint[]): PathStep[] {
    const tiles: PathStep[] = [];
    for (let i = 0; i < waypoints.length; i++) {
        const wp = waypoints[i];
        if (i === 0) {
            tiles.push({ x: wp.x, z: wp.z, level: wp.level, transport: wp.transport });
            continue;
        }
        const prev = waypoints[i - 1];
        if (wp.transport || wp.level !== prev.level) {
            // a crossing is a single annotated hop, never a straight run
            tiles.push({ x: wp.x, z: wp.z, level: wp.level, transport: wp.transport });
            continue;
        }
        const dx = Math.sign(wp.x - prev.x);
        const dz = Math.sign(wp.z - prev.z);
        const steps = Math.max(Math.abs(wp.x - prev.x), Math.abs(wp.z - prev.z));
        for (let step = 1; step <= steps; step++) {
            tiles.push({ x: prev.x + dx * step, z: prev.z + dz * step, level: wp.level });
        }
    }
    return tiles;
}

class WalkExecutorImpl {
    /** Live progress for overlays: remaining path tiles of the current walk. */
    remaining = 0;

    /** How the last walkTo/walkResilient ended — 'interrupted' means a random
     *  event took over; 'unreachable' means walkResilient PROVED the target
     *  can't be reached from here (verification probe dead) and gave up. */
    lastOutcome: 'arrived' | 'closest' | 'blocked' | 'budget' | 'interrupted' | 'failed' | 'unreachable' | null = null;

    /** Crossings (doors AND level-change staircases/ladders) that failed during
     *  THIS walkTo — excluded on repath. */
    private avoidDoors: { x: number; z: number }[] = [];

    /** Per-walkTo crossing failure counts (key `locX|locZ`) — a crossing is only
     *  poisoned into avoidDoors on its SECOND failed full attempt, so one
     *  timing flake no longer diverts the route around the world (the
     *  witch-house exterior detour). */
    private doorStrikes = new Map<string, number>();

    /**
     * Web-walk to `dest`. Resolves true on arrival, false on failure/timeout.
     * Only call from script context (sleeps via Execution.*).
     */
    async walkTo(dest: WorldTile, opts?: WalkOptions): Promise<boolean> {
        const radius = opts?.radius ?? 2;
        const timeoutMs = opts?.timeoutMs ?? 300_000;
        const log = opts?.log ?? ((): void => {});
        const maxExpansions = opts?.maxExpansions;
        const deadline = performance.now() + timeoutMs;
        this.lastOutcome = null;
        // Pre-avoid any special crossing we currently CAN'T satisfy (e.g. the Al
        // Kharid 10gp toll gate while broke) so A* routes AROUND it on the FIRST
        // path — instead of walking up to the gate, failing the toll, adding it to
        // avoidDoors, and repathing (the gate back-and-forth). When the
        // requirement IS met the gate stays in the graph and we cross it normally
        // (far cheaper than the detour). If avoiding it leaves no route, walkTo
        // fails cleanly rather than oscillating.
        this.resetAvoids();

        try {
            for (let repaths = 0; repaths <= MAX_REPATHS; repaths++) {
                const me = reader.worldTile();
                if (!me) {
                    this.lastOutcome = 'failed';
                    return false;
                }
                if (isArrived(me, dest, radius, Reachability.arrivalProbe())) {
                    this.lastOutcome = 'arrived';
                    return true;
                }

                const path = await this.requestPath(me, dest, maxExpansions);
                if (!path.ok) {
                    log(`no path to (${dest.x},${dest.z},${dest.level}): ${path.reason}`);
                    this.lastOutcome = classifyReason(path.reason);
                    return false;
                }
                log(`path: cost ${path.cost}, ${path.waypoints.length} waypoints, expanded ${path.expanded}, worker ${path.elapsedMs?.toFixed(1)}ms${repaths > 0 ? ` (repath ${repaths})` : ''}`);

                const tiles = expandWaypoints(path.waypoints);

                // the terminal tile is the pathfinder's goal — when dest itself
                // is unwalkable it snaps to the nearest reachable tile, and
                // standing there already is as arrived as we can get
                const terminal = tiles[tiles.length - 1];
                if (terminal && me.level === terminal.level && me.x === terminal.x && me.z === terminal.z) {
                    // arrived/closest must agree with the shared isArrived predicate:
                    // raw chebyshev here could claim 'arrived' within radius of a
                    // walkable-but-live-unreachable dest — the wall-blind case the
                    // loop-top gate just refused. isArrived's !walkable fallback still
                    // grants arrival on snapped-terminal booth/island dests.
                    if (!isArrived(me, dest, radius, Reachability.arrivalProbe())) {
                        // standing on the nearest reachable tile but not honestly arrived —
                        // 'closest', so walkResilient keeps escalating (client-scene walk).
                        // walkTo still returns true so direct callers get the "as close as
                        // the baked graph reaches" contract.
                        log(`dest (${dest.x},${dest.z}) unreachable beyond (${me.x},${me.z}) — nearest reachable tile`);
                        this.lastOutcome = 'closest';
                        return true;
                    }
                    this.lastOutcome = 'arrived';
                    return true;
                }

                const result = await this.followPath(tiles, dest, radius, deadline, log);
                if (result === 'arrived') {
                    this.lastOutcome = 'arrived';
                    return true;
                }
                if (result === 'closest') {
                    // on the nearest reachable tile but short of dest — true boolean
                    // (as close as the baked graph reaches), honest 'closest' outcome.
                    this.lastOutcome = 'closest';
                    return true;
                }
                if (result === 'blocked') {
                    // adjacent to a destination blocked LIVE (occupied stall/booth) —
                    // as close as physically reachable; true, like 'closest', but the
                    // distinct outcome tells walkResilient the scene walk won't help.
                    this.lastOutcome = 'blocked';
                    return true;
                }
                if (result === 'failed') {
                    this.lastOutcome = 'failed';
                    return false;
                }
                if (result === 'interrupted') {
                    log('walk interrupted — a random event is being handled');
                    this.lastOutcome = 'interrupted';
                    return false;
                }
                // 'repath': loop with a fresh path from wherever we are now
            }
            log(`giving up after ${MAX_REPATHS} repaths`);
            this.lastOutcome = 'failed';
            return false;
        } finally {
            this.remaining = 0;
        }
    }

    /** Bridge the Navigator promise into the script scheduler. */
    private async requestPath(from: WorldTile, to: WorldTile, maxExpansions?: number): Promise<PathResult> {
        let result: PathResult | null = null;
        Navigator.findPath(from, to, { avoidDoors: this.avoidDoors, maxExpansions }).then(
            r => (result = r),
            err => (result = { ok: false, reason: err instanceof Error ? err.message : String(err), expanded: 0 })
        );
        const settled = await Execution.delayUntil(() => result !== null, PATH_REQUEST_TIMEOUT_MS);
        return settled && result ? result : { ok: false, reason: 'path request timed out', expanded: 0 };
    }

    /** Fresh avoid set: empty except special crossings whose precondition we
     *  can't currently meet (e.g. the Al Kharid toll while broke). Shared by
     *  walkTo and probeDest so a probe sees what a fresh walk would plan. */
    private resetAvoids(): void {
        this.doorStrikes.clear();
        this.avoidDoors = [];
        for (const sc of SPECIAL_CROSSINGS) {
            if (sc.requires && !meetsRequirement(Inventory.count(sc.requires.item), sc.requires)) {
                this.avoidDoors.push({ x: sc.x, z: sc.z });
            }
        }
    }

    /** One-shot verification probe for walkResilient's unreachable terminal: a
     *  big-budget path request from the current position with a FRESH avoid
     *  set. Returns the plan's terminal tile (the pathfinder's snapped goal),
     *  or ok:false when no path exists at all. */
    async probeDest(dest: WorldTile, maxExpansions: number): Promise<{ ok: boolean; terminal: WorldTile | null }> {
        const me = reader.worldTile();
        if (!me) {
            return { ok: false, terminal: null };
        }
        this.resetAvoids();
        const path = await this.requestPath(me, dest, maxExpansions);
        if (!path.ok || path.waypoints.length === 0) {
            return { ok: false, terminal: null };
        }
        const last = path.waypoints[path.waypoints.length - 1];
        return { ok: true, terminal: { x: last.x, z: last.z, level: last.level } };
    }

    private async followPath(tiles: PathStep[], dest: WorldTile, radius: number, deadline: number, log: (msg: string) => void): Promise<FollowResult> {
        let pathIdx = 0;
        let offCorridor = 0;
        let stallTicks = 0;
        let stallRetries = 0;
        let clickIdx = -1; // path index of the tile we last clicked, -1 = none
        let clicks = 0;
        let warnedCombat = false;
        let lastTile: WorldTile | null = null;
        let stillIters = 0; // consecutive no-move loop iterations (stall backstop c)

        const clickable = (t: WorldTile): boolean => reader.toLocal(t.x, t.z) !== null && Reachability.canReach(t, { maxSteps: REACH_CHECK_STEPS });

        while (performance.now() < deadline) {
            if (EventSignal.pending()) {
                return 'interrupted';
            }
            // bot-registered sustain (eat mid-walk) — hostiles chip HP on long
            // walks and the bot's own task loop can't run while we hold it
            await Sustain.run();

            const me = reader.worldTile();
            if (!me) {
                return 'failed';
            }

            if (isArrived(me, dest, radius, Reachability.arrivalProbe())) {
                log(`arrived (${clicks} clicks)`);
                return 'arrived';
            }
            const terminal = tiles[tiles.length - 1];
            if (terminal && me.level === terminal.level && me.x === terminal.x && me.z === terminal.z) {
                // reached the path's end but the within-radius check above didn't
                // fire — the pathfinder snapped an unwalkable dest here, so we're
                // honestly 'closest', not arrived (lets walkResilient keep escalating).
                log(`reached path terminal short of dest (${clicks} clicks)`);
                return 'closest';
            }

            // where are we along the path? (corridor-tolerant)
            const found = locateOnPath(tiles, me, pathIdx, PROGRESS_WINDOW, CORRIDOR);
            if (found !== -1) {
                pathIdx = found;
                offCorridor = 0;
            } else if (++offCorridor >= OFF_CORRIDOR_STRIKES) {
                log(`deviated from path at (${me.x},${me.z},${me.level}) — repathing (${clicks} clicks)`);
                return 'repath';
            }
            this.remaining = tiles.length - 1 - pathIdx;

            // Stall bookkeeping. A no-move loop iteration grows the stall counter
            // when ANY of three conditions holds; ANY movement resets it (and the
            // no-move backstop counter). This only widens WHEN the existing counter
            // is allowed to grow — STALL_TICKS, retry ordering, and the recovery
            // flow below are unchanged.
            //   (a) short of the committed click target (or none): asked to move
            //       and haven't reached it — the original condition, unchanged.
            //   (b) door-reverted-after-selection: the target was reachable at
            //       click time but an RS door swung shut and canReach now refuses
            //       it — a real starve (a) misses when we're near the target.
            //   (c) probe-proven unpinned starvation: canReach can read TRUE mid
            //       click-starve (mechanism lives in click-selection/corridor
            //       bookkeeping), so back it with a plain no-movement timer.
            // (b)'s BFS is placed last so it only runs when (a)/(c) didn't fire.
            const moved = !lastTile || me.x !== lastTile.x || me.z !== lastTile.z || me.level !== lastTile.level;
            stillIters = moved ? 0 : stillIters + 1;
            const shortOfTarget = clickIdx === -1 || chebyshev(me, tiles[clickIdx]) > ARRIVE_RADIUS;
            const noMoveStall = !moved && (
                shortOfTarget ||
                stillIters >= STUCK_ITERS ||
                (clickIdx !== -1 && !Reachability.canReach(tiles[clickIdx], { maxSteps: STALL_REACH_STEPS }))
            );
            stallTicks = noMoveStall ? stallTicks + 2 : 0;
            lastTile = me;

            // The next crossing AHEAD caps how far we click (we stop before it).
            let nextCrossingIdx = -1;
            for (let i = pathIdx + 1; i < tiles.length; i++) {
                if (tiles[i].transport) {
                    nextCrossingIdx = i;
                    break;
                }
            }
            // The crossing we're actually standing next to — searched in a window
            // that also looks a few tiles BEHIND pathIdx, because locateOnPath can
            // snap our index PAST a gate we haven't crossed (the winding approach
            // to a wide gate). Trigger on proximity to the crossing's approach OR
            // far tile, not on pathIdx, so handleTransport still fires. A handled
            // crossing clears its transport, so this never re-triggers one we've
            // already crossed. (Root fix for "constantly stuck on gates".)
            //
            // MUST be on the crossing's approach-tile LEVEL: chebyshev() is
            // horizontal-only, so a crossing whose approach sits on a DIFFERENT
            // level but nearly the same (x,z) — e.g. the Lumbridge-castle ground-
            // floor doorways directly under a player standing upstairs — would
            // otherwise match, get "handled" as already-open, and advance pathIdx
            // PAST the real next crossing (the staircase down) without the player
            // moving. locateOnPath then can't place the upstairs player among the
            // downstairs tiles → deviate → repath → give up: the ~270s post-Duke
            // descent stall (seen in a live smoke). Gating on tiles[i-1].level keeps
            // staircases working (approached from their own level) while ignoring
            // the vertically-stacked doorway below.
            //
            // AND reach-gated: Chebyshev proximity alone is wall-blind, so a
            // stair operate tile just inside a house wall used to fire from
            // OUTSIDE the wall — see crossingEligible. An ineligible crossing is
            // simply skipped this iteration; the walker keeps clicking along the
            // path (through the door) until the approach becomes reachable.
            let crossingIdx = -1;
            const approachable = (t: WorldTile): boolean => Reachability.canReach(t, { maxSteps: TRIGGER_REACH_STEPS, adjacentOk: true });
            const scanHi = Math.min(tiles.length, pathIdx + PROGRESS_WINDOW);
            for (let i = Math.max(1, pathIdx - 5); i < scanHi; i++) {
                if (tiles[i].transport && crossingEligible(me, tiles[i - 1], tiles[i], TRANSPORT_TRIGGER, approachable)) {
                    crossingIdx = i;
                    break;
                }
            }
            if (crossingIdx !== -1) {
                const handled = await this.handleTransport(tiles[crossingIdx - 1], tiles[crossingIdx], log);
                if (handled) {
                    tiles[crossingIdx].transport = undefined;
                    pathIdx = Math.max(pathIdx, crossingIdx - 1);
                    stallTicks = 0;
                    stallRetries = 0;
                    clickIdx = -1;
                    lastTile = null;
                    continue;
                }
                this.failedDoor(tiles[crossingIdx]);
                return 'repath';
            }

            if (stallTicks >= STALL_TICKS) {
                stallTicks = 0;
                if (stallRetries === 0) {
                    stallRetries = 1;
                    clickIdx = -1; // re-select and re-click below
                } else if (reader.inCombat()) {
                    // being attacked never roots the player in this era (no
                    // auto-retaliate mechanic) — hold course, keep clicking,
                    // never escalate to a repath because of combat
                    if (!warnedCombat) {
                        warnedCombat = true;
                        log('under attack — holding course');
                    }
                    stallRetries = 0;
                    clickIdx = -1;
                } else {
                    // Stalled without ever advancing (clicks===0). Tell apart what is
                    // stranding us one tile short of the path terminal:
                    //
                    //  (1) our OWN just-crossed door's OPEN leaf. A straight door opened
                    //      to cross swings its leaf onto the LANDING tile (one past the
                    //      door) and flags it WALK_SCENERY. The tile IS walkable, but
                    //      canReach is conservative about the scenery flag, so the normal
                    //      (canReach-gated) click path click-starves there — looking
                    //      exactly like a live-blocked booth (clicks===0, chebyshev 1).
                    //      SCENE-STEP onto it with a RAW client walk (DirectNavigator,
                    //      not canReach-gated), exactly as crossMultiTileDoor does
                    //      mid-cross (live-confirmed: from (3248,3411) the bot walks onto
                    //      the leaf-flagged (3248,3412) in ~2s). We must NOT close the
                    //      leaf: the door has to stay OPEN for the step, and closing it
                    //      swings the panel back over the doorway, which tryNearbyDoor
                    //      immediately re-opens — an endless open/close oscillation (the
                    //      130s door-cross-test leg1 hang, live-confirmed). While the
                    //      open leaf stands we keep retrying the step (never latch
                    //      'blocked' on our own transient crossing leaf). Gated to a leaf
                    //      within 2 tiles of the terminal so it only fires for a door
                    //      genuinely on top of us, never one near an occupied booth.
                    //  (2) a SHUT door/gate on the path — tryNearbyDoor opens it (the
                    //      long-standing stall opener; also RE-opens a door that reverted
                    //      shut, so the next iteration can scene-step through it).
                    //
                    // If NEITHER is present and the terminal is still unreachable, it's
                    // an honest live block (an occupied stall-stand/booth — ArdyThiever
                    // etc., not a door/gate): report 'blocked' NOW (walkResilient treats
                    // it as arrival — the scene walk can't beat a live block) instead of
                    // repathing the same short path 5× and timing out (the "0 clicks
                    // stuck" loop). Bound: a leaf that never yields is still capped by
                    // the walkTo deadline.
                    const end = tiles[tiles.length - 1];
                    const adjacentToEnd = clicks === 0 && me.level === end.level && chebyshev(me, end) <= 1;
                    if (adjacentToEnd) {
                        const openLeaf = Locs.query()
                            .where(l => isOpenBarrierLeaf(l.name, l.actions()) && chebyshev(l.tile(), end) <= 2)
                            .within(3)
                            .nearest();
                        if (openLeaf) {
                            log(`(${end.x},${end.z}) leaf-flagged by open '${openLeaf.name}' — scene-stepping onto it`);
                            DirectNavigator.walk(end);
                            await Execution.delayUntil(() => {
                                const cur = reader.worldTile();
                                return cur !== null && cur.level === end.level && cur.x === end.x && cur.z === end.z;
                            }, SCENE_STEP_MS);
                            stallRetries = 0;
                            clickIdx = -1;
                            lastTile = null;
                            continue;
                        }
                    }
                    if (await this.tryNearbyDoor(log)) {
                        stallRetries = 0;
                        clickIdx = -1;
                        lastTile = null;
                        continue;
                    }
                    if (adjacentToEnd) {
                        log(`(${end.x},${end.z}) blocked live — as close as reachable`);
                        return 'blocked';
                    }
                    log(`stuck at (${me.x},${me.z}) — repathing (${clicks} clicks)`);
                    return 'repath';
                }
            }

            // commit to the current click until we arrive near it
            const needClick = clickIdx === -1 || clickIdx <= pathIdx || chebyshev(me, tiles[clickIdx]) <= ARRIVE_RADIUS;
            if (needClick) {
                const limit = nextCrossingIdx !== -1 ? nextCrossingIdx - 1 : tiles.length - 1;
                const steps = TARGET_STEPS + Math.floor(Math.random() * (2 * TARGET_JITTER + 1)) - TARGET_JITTER;
                const target = selectClickTarget(tiles, pathIdx, steps, limit, me.level, clickable);
                // Corridor-snap starvation rescue: locateOnPath snaps pathIdx to
                // the TERMINAL from CORRIDOR tiles out, and the strict i > pathIdx
                // selection then starves on EVERY hop that short — 0 clicks, then
                // a bogus 'blocked live' at cheb 1 or a repath-to-timeout loop at
                // cheb 2-3 (live: the cake-stand claim/swap). The terminal itself
                // is the click. GATED to pathIdx === last — the snap's signature —
                // because a MID-PATH starve is the door case: a swung leaf or a
                // closed door the corridor snap stepped PAST (nextCrossingIdx only
                // scans forward, so it reads -1 there) starves selection too, and
                // rescuing then blind-clicks across the door — the client paths
                // around/away and the bot dances in and out of the doorway (live
                // regression, 2026-07-21). Mid-path starves fall through to the
                // crossing-fire/stall/repath machinery that owns doors. One commit
                // per stall cycle (retries re-arm via clickIdx = -1); an
                // unclickable terminal stays -1 so a genuinely blocked booth still
                // earns the honest 'blocked' verdict below.
                const chosen = target !== -1 || nextCrossingIdx !== -1 || pathIdx !== tiles.length - 1 || clickIdx === tiles.length - 1
                    ? target
                    : starvedTerminalIndex(tiles, me, clickable);
                if (chosen !== -1 && !(tiles[chosen].x === me.x && tiles[chosen].z === me.z)) {
                    const local = reader.toLocal(tiles[chosen].x, tiles[chosen].z)!;
                    ActionRouter.driver.walk(local.lx, local.lz);
                    clickIdx = chosen;
                    clicks++;
                    stallTicks = 0;
                } else if (target === -1) {
                    // Nothing clickable ahead. If the reason is a crossing we're
                    // already beside (its approach canReach-refused through the
                    // closed leaf), fire the crossing NOW — click-starvation next
                    // to a crossing IS the door case, and waiting only burns the
                    // stall counter into a repath (live: Camelot throne doors,
                    // witch-house inner door — the "0 clicks" loops).
                    if (nextCrossingIdx !== -1) {
                        const appr = tiles[nextCrossingIdx - 1];
                        if (me.level === appr.level && chebyshev(me, appr) <= TRANSPORT_TRIGGER + 2) {
                            const handled = await this.handleTransport(appr, tiles[nextCrossingIdx], log);
                            if (handled) {
                                tiles[nextCrossingIdx].transport = undefined;
                                pathIdx = Math.max(pathIdx, nextCrossingIdx - 1);
                                stallTicks = 0;
                                stallRetries = 0;
                                clickIdx = -1;
                                lastTile = null;
                                continue;
                            }
                            this.failedDoor(tiles[nextCrossingIdx]);
                            return 'repath';
                        }
                    }
                    // scene edge / genuinely blocked — a stall
                    stallTicks += 2;
                }
            }

            await Execution.delayTicks(2);
        }

        log('walk timed out');
        return 'failed';
    }

    /**
     * Stalled (not in combat): a closed door/gate is blocking us. Open the
     * nearest openable door/gate next to the PLAYER — searched player-relative,
     * NOT relative to pathIdx. `locateOnPath` can snap our path index PAST a
     * crossing on a winding approach (a 2-wide gate at the edge of a field), and
     * a path-relative search then looks north of the very gate we're stuck
     * against to the south and never opens it — the "constantly stuck on gates"
     * failure. `.within(3).nearest()` is player-relative, so it always finds the
     * blocker. The filter is `isOpenableBarrier` (name-gated door/gate + Open-op),
     * NOT a bare `.action('Open')`: the loose op filter clicked a same-'Open'-op
     * Wardrobe next to a stalled bot (live incident).
     */
    async tryNearbyDoor(log: (msg: string) => void): Promise<boolean> {
        const door = Locs.query()
            .where(l => isOpenableBarrier(l.name, l.actions()))
            .within(3)
            .nearest();
        if (!door) {
            return false;
        }

        // Click the loc's OWN Open-style op (mirrors walkOpening's openOp), never
        // a hardcoded 'Open' literal — the loc passed isOpenableBarrier so it has
        // one; this covers 'Open-quietly' and any other Open-prefixed variant.
        const op = door.actions().find(a => /^open/i.test(a));
        const t = door.tile();
        log(`stalled next to closed '${door.name}' at (${t.x},${t.z}) — opening it`);
        if (!op || !door.interact(op)) {
            return false;
        }
        return Execution.delayUntil(() => {
            const cur = Locs.query()
                .where(l => l.tile().x === t.x && l.tile().z === t.z && (l.name ?? '') === (door.name ?? '') && isOpenableBarrier(l.name, l.actions()))
                .nearest();
            return cur === null || Reachability.canReach(t, { maxSteps: 200, adjacentOk: true });
        }, 5000);
    }

    private failedDoor(step: PathStep): void {
        const t = step.transport;
        if (!t) {
            return;
        }
        const key = `${t.locX}|${t.locZ}`;
        const strikes = (this.doorStrikes.get(key) ?? 0) + 1;
        this.doorStrikes.set(key, strikes);
        if (strikes >= 2) {
            // Two full crossing budgets failed this walk — poison it so the
            // repath routes around (doors, stairs, ladders, teleports alike).
            this.avoidDoors.push({ x: t.locX, z: t.locZ });
        }
        // strike 1: repath WITHOUT avoiding — the fresh path retries the same
        // crossing with a full budget.
    }

    /**
     * Cross an annotated door/transport. The caller is within TRANSPORT_TRIGGER
     * (>= ARRIVE_RADIUS) of the approach tile, so we interact from range and let
     * the client walk the final tiles to the loc on interact — never clicking
     * "through" the doorway. Success = the closed loc vanished OR live collision
     * now permits the approach→crossing step (collision is ground truth; loc-name
     * matching alone was the fragile part) OR the level changed for stairs.
     */
    private async handleTransport(approach: PathStep, step: PathStep, log: (msg: string) => void): Promise<boolean> {
        const transport = step.transport!;

        const special = specialCrossingAt(transport.locX, transport.locZ, step.level);
        if (special) {
            return this.handleSpecialCrossing(approach, step, special, log);
        }

        // EVERY door (no level change) is driven to COMPLETION — opened AND
        // walked THROUGH — before we report success, because opening a door does
        // NOT put us on the far side and the RS door auto-reverts after a few
        // ticks. The old 1-tile path declared victory on "door opened" and
        // followPath cleared the crossing annotation, so when the swung-open leaf
        // then blocked the step tile (canReach false ⇒ zero click-throughs) the
        // crossing could never re-fire: the bot wedged ONE tile from the door
        // until walkResilient escalated to the scene-walker — live-confirmed 6/6,
        // 30-92s, at Door@(3248,3411). Same root as the wizard-tower shape-9
        // MULTI-tile Door@(3107,3162) (a hand-added edge bridging the walkable
        // neighbours 3106<->3108 across the sealed centre tile), which first
        // needed this and froze gotoNpc ~5 min there. crossMultiTileDoor degrades
        // to the 1-tile case cleanly: dir is the unit step approach→step, so
        // landing = step + dir is the tile one PAST the door either way.
        if (transport.toLevel === undefined && transport.toTile === undefined && chebyshev(approach, step) >= 1) {
            return this.crossMultiTileDoor(approach, step, transport, log);
        }

        for (let attempt = 0; attempt < 2; attempt++) {
            const loc = this.findTransportLoc(transport);
            if (!loc) {
                if (transport.toLevel === undefined && transport.toTile === undefined) {
                    // No CLOSED door loc here (an open door offers 'Close', not
                    // 'Open', so findTransportLoc misses it) — is the way already
                    // clear? For a 1-tile door canStep settles it; canReach is the
                    // fallback for any edge whose from/to aren't cardinally adjacent
                    // (multi-tile diagonal doors are handled earlier by
                    // crossMultiTileDoor, so this is a general safety net now).
                    if (Reachability.canStep(approach, step) || Reachability.canReach(step, { maxSteps: 64, adjacentOk: true })) {
                        log(`${transport.locName} at (${transport.locX},${transport.locZ}) already open`);
                        return true;
                    }
                    log(`transport loc '${transport.locName}' not found but the way is blocked`);
                    return false;
                }
                // A trapdoor/hatch descends in TWO steps: the SHUT leaf offers
                // 'Open' (not the crossing op), and opening it loc_changes it to
                // the open variant that offers the descend op + telejumps
                // (trapdoors.rs2). So an absent annotated loc on a dungeon
                // (toTile) crossing means the leaf is still shut — open the
                // same-named Open-style leaf here and retry; the next pass finds
                // the open variant and clicks the crossing op. (Paterdomus temple
                // + Morytania-side trapdoors on the route to Canifis.)
                if (transport.toTile !== undefined && await this.openShutTrapdoor(transport, log)) {
                    continue;
                }
                log(`transport loc '${transport.locName}' not found near (${transport.locX},${transport.locZ})`);
                return false;
            }

            const mark = GameMessages.mark();
            if (!loc.interact(transport.action)) {
                log(`'${transport.action}' not offered by ${transport.locName} (ops: ${loc.actions().join(', ')})`);
                return false;
            }

            // A fresh "I can't reach that!" after OUR click is the server saying
            // this stand can never satisfy the interaction — end the wait now
            // (not after TRANSPORT_WAIT_MS) and skip the second attempt, which
            // would only reproduce the same answer.
            const cantReach = (): boolean => GameMessages.sawSince(mark, CANT_REACH);
            let crossed: boolean;
            if (transport.toLevel !== undefined) {
                const toLevel = transport.toLevel;
                const climbed = (): boolean => reader.worldTile()?.level === toLevel;
                crossed = (await Execution.delayUntil(() => climbed() || cantReach(), TRANSPORT_WAIT_MS)) && climbed();
            } else if (transport.toTile !== undefined) {
                // teleport crossing (dungeon trapdoor/ladder z±6400): the script
                // telejumps the player's own tile, so we land NEAR the edge's to
                // tile, not on it — arrival is proximity on the same level
                const toTile = transport.toTile;
                const landed = (): boolean => {
                    const me = reader.worldTile();
                    return me !== null && me.level === step.level && chebyshev(me, toTile) <= 3;
                };
                crossed = (await Execution.delayUntil(() => landed() || cantReach(), TRANSPORT_WAIT_MS)) && landed();
            } else {
                const open = (): boolean => this.findTransportLoc(transport) === null || Reachability.canStep(approach, step);
                crossed = (await Execution.delayUntil(() => open() || cantReach(), TRANSPORT_WAIT_MS)) && open();
            }
            if (crossed) {
                if (transport.toLevel !== undefined) {
                    // The loc snapshot lags a level flip by a tick (probed live at
                    // the Camelot tower: every query is empty at tick+0, populated
                    // at tick+1). Settle before returning so the very next
                    // findTransportLoc / path step reads the NEW floor — the stale
                    // blank made back-to-back ladder flights "not found" and sent
                    // walks on whole-building detours.
                    await Execution.delayTicks(2);
                }
                log(`${transport.action} ${transport.locName} at (${transport.locX},${transport.locZ}) ok`);
                return true;
            }
            if (cantReach()) {
                log(`server says can't reach ${transport.locName} at (${transport.locX},${transport.locZ}) — repathing`);
                return false;
            }
            log(`${transport.action} ${transport.locName} did not resolve, retrying`);
        }
        return false;
    }

    /**
     * Drive a multi-tile door crossing to COMPLETION: ensure the door is open
     * and walk the player THROUGH it to the far side, re-opening if the RS door
     * reverts mid-cross, until we're across (or the budget runs out → repath).
     * Success is the player crossing — not the door merely opening — because for
     * these edges (from/to >1 apart across a sealed tile) opening leaves us on
     * the near side, and the old "door opened ⇒ done + clear annotation" let the
     * door re-close before the click-through, stranding the bot with no way to
     * re-fire the crossing (the ~5-min (3108,3162) freeze; see handleTransport).
     *
     * When the open edge won't admit a direct step onto `step` (the multi-tile /
     * `canStep`-false landing modes), we aim one tile PAST `step` rather than at it:
     * a live probe of the wizard-tower shape-9 Door showed that OPENING it swings
     * the loc onto the far `step` tile and flags it WALK_SCENERY — 3107,3162 clears
     * but 3106,3162 becomes blocked. So `step` is unreachable while the door is
     * open; clicking it is gated out by canReach and the bot never moves (the exact
     * failure of the first fix attempt). The landing tile one step further along the
     * crossing axis (3105,3162 here) is walkable, and the client routes around the
     * swung door to reach it. (When the edge IS directly steppable, chooseCrossClick
     * takes the step-first path below and walks onto `step` itself.)
     */
    private async crossMultiTileDoor(approach: PathStep, step: PathStep, transport: TransportInfo, log: (msg: string) => void): Promise<boolean> {
        const dir = { x: Math.sign(step.x - approach.x), z: Math.sign(step.z - approach.z) };
        const landing = { x: step.x + dir.x, z: step.z + dir.z, level: step.level };
        const deadline = performance.now() + MULTI_DOOR_CROSS_MS;
        while (performance.now() < deadline) {
            const here = reader.worldTile();
            if (isOnFarSide(here, approach, step)) {
                log(`crossed '${transport.locName}' at (${transport.locX},${transport.locZ})`);
                return true;
            }
            // Stand ON the approach tile before opening + stepping through. Firing
            // the open/through-step from an off-approach tile never satisfies
            // isOnFarSide; worse, in an ADJACENT double-door (Witch's House front
            // 2901,3473 + inner 2902,3474, one diagonal apart) the bot is parked on
            // the PRIOR door's tile after crossing it, and that door's auto-close
            // (door_close_move_player_out_of_way) SHOVES it back outside before the
            // inner cross can land — so the inner door "did not cross" every pass
            // (live 2026-07-19). Walking onto `approach` first both starts the cross
            // from the right tile AND vacates the prior door's tile before it
            // reverts. This walk-to-approach is a no-op ONLY when we're already ON
            // the approach tile. Bounded: the loop re-checks, all under MULTI_DOOR_CROSS_MS.
            if (here && !(here.x === approach.x && here.z === approach.z && here.level === approach.level)) {
                DirectNavigator.walk(approach);
                await Execution.delayUntil(() => {
                    const p = reader.worldTile();
                    return p !== null && p.x === approach.x && p.z === approach.z && p.level === approach.level;
                }, APPROACH_WALK_MS);
                continue;
            }
            const shut = this.findTransportLoc(transport);
            if (shut) {
                // Closed (first arrival) or reverted mid-cross — open it. The wait
                // is on the RAW crossing edge (canStep approach→step) OR the closed
                // leaf vanishing, whichever reads first; capped at OPEN_WAIT_MS so a
                // revert cycle costs seconds, not the whole budget.
                const mark = GameMessages.mark();
                if (!shut.interact(transport.action)) {
                    log(`'${transport.action}' not offered by ${transport.locName} (ops: ${shut.actions().join(', ')})`);
                    return false;
                }
                await Execution.delayUntil(
                    () => this.findTransportLoc(transport) === null || Reachability.canStep(approach, step) || GameMessages.sawSince(mark, CANT_REACH),
                    OPEN_WAIT_MS
                );
                if (GameMessages.sawSince(mark, CANT_REACH)) {
                    // the door leaf itself is unreachable from this side — spinning
                    // the rest of the budget can't fix that; bail to the repath
                    log(`server says can't reach ${transport.locName} — repathing`);
                    return false;
                }
                continue;
            }
            // Door reads open — pick the through-move by what the LIVE collision
            // permits (see chooseCrossClick).
            const canStepEdge = Reachability.canStep(approach, step);
            const landingLocal = reader.toLocal(landing.x, landing.z);
            const canReachLanding = landingLocal !== null && Reachability.canReach(landing, { maxSteps: 128 });
            const choice = chooseCrossClick(canStepEdge, canReachLanding);
            if (choice === 'step') {
                // 1-tile door with the edge genuinely open: walk ONTO the far tile
                // itself (landing may be furniture/wall in tight interiors). Being
                // on `step` satisfies isOnFarSide (cheb 0 < cheb 1).
                DirectNavigator.walk(step);
                await Execution.delayUntil(() => isOnFarSide(reader.worldTile(), approach, step), 3000);
            } else if (choice === 'landing-click') {
                // A walkable route around the swung-open leaf exists (multi-tile
                // doors) — click it; loop back to re-open if the door reverts.
                ActionRouter.driver.walk(landingLocal!.lx, landingLocal!.lz);
                await Execution.delayTicks(2);
            } else {
                // No canReach route: the swung leaf seals the sole gap. Raw scene
                // click (NOT canReach-gated) and return the instant we're past the
                // door plane.
                log(`leaf blocks landing — scene-stepping through '${transport.locName}'`);
                DirectNavigator.walk(landing);
                await Execution.delayUntil(() => isOnFarSide(reader.worldTile(), approach, step), SCENE_STEP_MS);
            }
        }
        log(`${transport.locName} at (${transport.locX},${transport.locZ}) did not cross in time, repathing`);
        return false;
    }

    /**
     * Cross a gate that needs a precondition and/or a dialogue (see
     * specialCrossings.ts). If the precondition is unmet we return false so the
     * caller adds the gate to avoidDoors and repaths (there may be no alternate
     * route — then walkTo ends cleanly instead of hanging on a blocking dialogue,
     * the "ignore if you can't pay" behaviour). If it's met we interact and drive
     * the dialogue (continue through lines, click the configured choice) until the
     * player has crossed to the far tile.
     */
    private async handleSpecialCrossing(approach: PathStep, step: PathStep, sc: SpecialCrossing, log: (msg: string) => void): Promise<boolean> {
        if (sc.requires && !meetsRequirement(Inventory.count(sc.requires.item), sc.requires)) {
            log(`${sc.label}: need ${sc.requires.count} ${sc.requires.item} — skipping`);
            return false; // caller: failedDoor() + repath (avoids this gate)
        }

        // NPC-driven crossing (a ship): OPNPC the sailor/officer, pay the fare via
        // the dialogue, and wait to land on the boat deck. Arrival is a telejump —
        // the player materialises on a fresh L1 deck tile (sc.toTile) nowhere near
        // the approach, so success is standing on that tile, NOT isOnFarSide. The
        // gangplank that then disembarks to the L0 dock is a separate ordinary
        // transport edge, driven by handleTransport after this returns.
        if (sc.npc) {
            const npc = Npcs.query().name(sc.npc).action('Talk-to').nearest();
            if (!npc || !(await npc.interact('Talk-to'))) {
                log(`${sc.label}: '${sc.npc}' not talkable`);
                return false;
            }
            const arrived = (): boolean => {
                const me = reader.worldTile();
                return me !== null && sc.toTile !== undefined && me.level === sc.toTile.level && chebyshev(me, sc.toTile) <= 2;
            };
            for (let i = 0; i < SHIP_DIALOGUE_STEPS && !arrived(); i++) {
                const pick = sc.dialogue ? pickChoice(ChatDialog.options(), sc.dialogue.choose) : null;
                if (pick) {
                    await ChatDialog.chooseOption(pick);
                } else if (ChatDialog.canContinue()) {
                    await ChatDialog.continue();
                } else {
                    await Execution.delayTicks(1);
                }
            }
            if (arrived()) {
                log(`${sc.label}: sailed`);
                return true;
            }
            log(`${sc.label}: voyage did not resolve — repathing`);
            return false;
        }

        const crossed = (): boolean => isOnFarSide(reader.worldTile(), approach, step);
        // Most special gates cross in a single Open — the toll gate teleports you
        // across once the fare dialogue is paid. A reopenAfterDialogue gate needs a
        // second: the first Open runs a one-time prerequisite dialogue that does NOT
        // move you (the Gnome Stronghold gate diverts to Femi's boxes —
        // @grandtree_femi_boxes is a goto, so the gate-open code never runs that
        // click), and only a fresh Open, now that the dialogue has set its flag,
        // force-moves you through. Each Open drives whatever dialogue it surfaced to
        // the end (the boxes sequence closes then re-opens for a final "Thanks again"
        // line, so we exhaust DIALOGUE_STEPS rather than break on the first close),
        // then the outer loop re-Opens while we still have not crossed. An already-
        // primed account never sees the dialogue and crosses on the first Open, so
        // the crossed() guard exits before a wasted second.
        const maxOpens = sc.reopenAfterDialogue ? GATE_REOPENS : 1;
        for (let open = 0; open < maxOpens && !crossed(); open++) {
            const loc = this.findTransportLoc({ locName: sc.locName, action: sc.action, locX: sc.x, locZ: sc.z });
            if (!loc) {
                log(`${sc.label}: '${sc.locName}' not found at (${sc.x},${sc.z})`);
                return false;
            }
            if (!loc.interact(sc.action)) {
                log(`${sc.label}: '${sc.action}' not offered (ops: ${loc.actions().join(', ')})`);
                return false;
            }
            for (let i = 0; i < DIALOGUE_STEPS && !crossed(); i++) {
                const pick = sc.dialogue ? pickChoice(ChatDialog.options(), sc.dialogue.choose) : null;
                if (pick) {
                    await ChatDialog.chooseOption(pick);
                } else if (ChatDialog.canContinue()) {
                    await ChatDialog.continue();
                } else {
                    await Execution.delayTicks(1);
                }
            }
        }
        if (crossed()) {
            log(`${sc.label}: crossed`);
            return true;
        }
        log(`${sc.label}: dialogue did not resolve — repathing`);
        return false;
    }

    private findTransportLoc(transport: TransportInfo): Loc | null {
        return Locs.query()
            .name(transport.locName)
            .action(transport.action)
            .where(loc => {
                const tile = loc.tile();
                return Math.max(Math.abs(tile.x - transport.locX), Math.abs(tile.z - transport.locZ)) <= 3;
            })
            .nearest();
    }

    /**
     * A shut trapdoor/hatch offers 'Open' (never the crossing op); opening it
     * loc_changes it to the open variant that carries the descend op. Interacts
     * with the same-named Open-style leaf at the transport coord; resolves true
     * once the open variant (offering `transport.action`) has appeared, so the
     * caller's next pass drives the actual descent. The `Open`-prefix filter (not
     * a literal 'Open') mirrors openStuckDoor and admits 'Open-quietly' etc.
     */
    private async openShutTrapdoor(transport: TransportInfo, log: (msg: string) => void): Promise<boolean> {
        const shut = Locs.query()
            .name(transport.locName)
            .where(loc => Math.max(Math.abs(loc.tile().x - transport.locX), Math.abs(loc.tile().z - transport.locZ)) <= 3
                && loc.actions().some(a => a !== null && /^open/i.test(a)))
            .nearest();
        if (!shut) {
            return false;
        }
        const op = shut.actions().find(a => a !== null && /^open/i.test(a));
        if (!op || !(await shut.interact(op))) {
            return false;
        }
        log(`opened the shut '${transport.locName}' at (${shut.tile().x},${shut.tile().z}) before descending`);
        return Execution.delayUntil(() => this.findTransportLoc(transport) !== null, 4000);
    }
}

export const WalkExecutor = new WalkExecutorImpl();
