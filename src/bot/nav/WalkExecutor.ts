// Tick-driven walk executor (Slice 5b): turns a NavWorker path into game
// clicks. Called from scripts via Traversal.walkTo, so every wait goes
// through Execution.* — stop/pause/abort semantics hold exactly like any
// other script action (PLAN.md §2).
//
// Loop: walk toward the furthest path tile within ~18 tiles that's inside
// the loaded scene; when the next path segment is an annotated door/
// transport crossing, approach it, interact with the annotated action and
// wait for the crossing to open (loc gone / level changed); on stall
// re-click, on repeated stall re-path from the current position.

import type { WorldTile } from '../adapter/ClientAdapter.js';
import { reader } from '../adapter/ClientAdapter.js';
import { EventSignal } from '../api/EventSignal.js';
import { Execution } from '../api/Execution.js';
import { Locs, type Loc } from '../api/queries/Locs.js';
import { Inventory } from '../api/hud/Inventory.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { specialCrossingAt, pickChoice, meetsRequirement, type SpecialCrossing } from './data/specialCrossings.js';
import { Reachability } from '../api/Reachability.js';
import { ActionRouter } from '../input/ActionRouter.js';
import { Navigator, type PathResult } from './Navigator.js';
import type { TransportInfo, Waypoint } from './PathFinder.js';
import { locateOnPath, selectClickTarget } from './followMath.js';
import { classifyReason } from './walkLadder.js';

const TARGET_STEPS = 20; // click target this many steps ALONG the path
const TARGET_JITTER = 4; // ± human-ish variance on TARGET_STEPS
const ARRIVE_RADIUS = 4; // reaching within this of the click target ⇒ pick the next one
const PROGRESS_WINDOW = 26; // how far ahead we look for our own position on the path
const CORRIDOR = 3; // on-path tolerance (client micro-routes differ from ours)
const OFF_CORRIDOR_STRIKES = 2; // consecutive off-corridor checks before repathing
const STALL_TICKS = 6; // no tile change for this many ticks while short of the target ⇒ stalled
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
// Budget to open AND walk THROUGH a multi-tile door (the wizard-tower shape-9
// diagonal Door: from/to are 2 tiles apart across the sealed 3107 tile). Must
// cover several open→walk tries because the RS door auto-reverts after a few
// ticks — enough headroom that a genuine cross always lands, small vs the 90s
// walkTo attempt so a truly stuck one still repaths.
const MULTI_DOOR_CROSS_MS = 20_000;
const DIALOGUE_STEPS = 24; // max continue/choose iterations to drive a crossing dialogue
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

type FollowResult = 'arrived' | 'closest' | 'repath' | 'failed' | 'interrupted';

function chebyshev(a: WorldTile, b: WorldTile): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
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

    /** How the last walkTo ended — 'interrupted' means a random event took
     *  over and the caller should retry once the runtime clears it. */
    lastOutcome: 'arrived' | 'closest' | 'budget' | 'interrupted' | 'failed' | null = null;

    /** Doors that failed to open during THIS walkTo — excluded on repath. */
    private avoidDoors: { x: number; z: number }[] = [];

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
        this.avoidDoors = [];

        try {
            for (let repaths = 0; repaths <= MAX_REPATHS; repaths++) {
                const me = reader.worldTile();
                if (!me) {
                    this.lastOutcome = 'failed';
                    return false;
                }
                if (chebyshev(me, dest) <= radius && me.level === dest.level) {
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
                    if (chebyshev(me, dest) > radius) {
                        // standing on the nearest reachable tile but still short of dest —
                        // honestly 'closest', so walkResilient keeps escalating (client-scene
                        // walk) instead of believing it arrived. walkTo still returns true so
                        // direct callers get the "as close as the baked graph reaches" contract.
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

    private async followPath(tiles: PathStep[], dest: WorldTile, radius: number, deadline: number, log: (msg: string) => void): Promise<FollowResult> {
        let pathIdx = 0;
        let offCorridor = 0;
        let stallTicks = 0;
        let stallRetries = 0;
        let clickIdx = -1; // path index of the tile we last clicked, -1 = none
        let clicks = 0;
        let warnedCombat = false;
        let lastTile: WorldTile | null = null;

        const clickable = (t: WorldTile): boolean => reader.toLocal(t.x, t.z) !== null && Reachability.canReach(t, { maxSteps: REACH_CHECK_STEPS });

        while (performance.now() < deadline) {
            if (EventSignal.pending()) {
                return 'interrupted';
            }

            const me = reader.worldTile();
            if (!me) {
                return 'failed';
            }

            if (chebyshev(me, dest) <= radius && me.level === dest.level) {
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

            // stall bookkeeping: counts while short of the target — and also
            // while we have NO target (nothing clickable at a scene edge)
            const moved = !lastTile || me.x !== lastTile.x || me.z !== lastTile.z || me.level !== lastTile.level;
            const shortOfTarget = clickIdx === -1 || chebyshev(me, tiles[clickIdx]) > ARRIVE_RADIUS;
            stallTicks = moved || !shortOfTarget ? 0 : stallTicks + 2;
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
            // descent stall (Task 6 live smoke). Gating on tiles[i-1].level keeps
            // staircases working (approached from their own level) while ignoring
            // the vertically-stacked doorway below.
            let crossingIdx = -1;
            const scanHi = Math.min(tiles.length, pathIdx + PROGRESS_WINDOW);
            for (let i = Math.max(1, pathIdx - 5); i < scanHi; i++) {
                if (tiles[i].transport && me.level === tiles[i - 1].level && (chebyshev(me, tiles[i - 1]) <= TRANSPORT_TRIGGER || chebyshev(me, tiles[i]) <= TRANSPORT_TRIGGER)) {
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
                    const opened = await this.tryNearbyDoor(log);
                    if (opened) {
                        stallRetries = 0;
                        clickIdx = -1;
                        lastTile = null;
                        continue;
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
                if (target !== -1 && !(tiles[target].x === me.x && tiles[target].z === me.z)) {
                    const local = reader.toLocal(tiles[target].x, tiles[target].z)!;
                    ActionRouter.driver.walk(local.lx, local.lz);
                    clickIdx = target;
                    clicks++;
                    stallTicks = 0;
                } else if (target === -1) {
                    // nothing clickable ahead (scene edge / blocked) — a stall
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
     * nearest 'Open'-able loc next to the PLAYER — searched player-relative, NOT
     * relative to pathIdx. `locateOnPath` can snap our path index PAST a crossing
     * on a winding approach (a 2-wide gate at the edge of a field), and a
     * path-relative search then looks north of the very gate we're stuck against
     * to the south and never opens it — the "constantly stuck on gates" failure.
     * `.within(3).nearest()` is player-relative, so it always finds the blocker.
     */
    async tryNearbyDoor(log: (msg: string) => void): Promise<boolean> {
        const door = Locs.query()
            .action('Open')
            .within(3)
            .nearest();
        if (!door) {
            return false;
        }

        const t = door.tile();
        log(`stalled next to closed '${door.name}' at (${t.x},${t.z}) — opening it`);
        if (!door.interact('Open')) {
            return false;
        }
        return Execution.delayUntil(() => {
            const cur = Locs.query()
                .action('Open')
                .where(l => l.tile().x === t.x && l.tile().z === t.z && (l.name ?? '') === (door.name ?? ''))
                .nearest();
            return cur === null || Reachability.canReach(t, { maxSteps: 200, adjacentOk: true });
        }, 5000);
    }

    private failedDoor(step: PathStep): void {
        const t = step.transport;
        if (t && t.toLevel === undefined) {
            this.avoidDoors.push({ x: t.locX, z: t.locZ });
        }
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

        // A hand-added edge that bridges tiles >1 apart is a MULTI-TILE door
        // (the wizard-tower shape-9 diagonal Door@3107,3162 seals the whole
        // tile, so the graph hops the walkable neighbours 3106<->3108). Opening
        // it does NOT put us on the far side, and the RS door auto-reverts after
        // a few ticks, so — unlike a 1-tile door — we must actively walk THROUGH
        // and only report success once we're across. Otherwise the old path
        // declared victory on "door opened", followPath cleared the crossing
        // annotation, the door re-closed before the canReach-gated click-through
        // could fire, and the crossing could never re-trigger: gotoNpc's
        // ladder-stand hop froze ~5 min at (3108,3162) while walkResilient burned
        // 3x90s (RuneMysteries smoke, t=170-460).
        if (transport.toLevel === undefined && chebyshev(approach, step) > 1) {
            return this.crossMultiTileDoor(approach, step, transport, log);
        }

        for (let attempt = 0; attempt < 2; attempt++) {
            const loc = this.findTransportLoc(transport);
            if (!loc) {
                if (transport.toLevel === undefined) {
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
                log(`transport loc '${transport.locName}' not found near (${transport.locX},${transport.locZ})`);
                return false;
            }

            if (!loc.interact(transport.action)) {
                log(`'${transport.action}' not offered by ${transport.locName} (ops: ${loc.actions().join(', ')})`);
                return false;
            }

            let crossed: boolean;
            if (transport.toLevel !== undefined) {
                const toLevel = transport.toLevel;
                crossed = await Execution.delayUntil(() => reader.worldTile()?.level === toLevel, TRANSPORT_WAIT_MS);
            } else {
                crossed = await Execution.delayUntil(() => this.findTransportLoc(transport) === null || Reachability.canStep(approach, step), TRANSPORT_WAIT_MS);
            }
            if (crossed) {
                log(`${transport.action} ${transport.locName} at (${transport.locX},${transport.locZ}) ok`);
                return true;
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
     * We aim one tile PAST `step`, not at `step` itself: a live probe of the
     * wizard-tower shape-9 Door showed that OPENING it swings the loc onto the
     * far `step` tile and flags it WALK_SCENERY — 3107,3162 clears but 3106,3162
     * becomes blocked. So `step` is unreachable while the door is open; clicking
     * it is gated out by canReach and the bot never moves (the exact failure of
     * the first fix attempt). The landing tile one step further along the
     * crossing axis (3105,3162 here) is walkable, and the client routes around
     * the swung door to reach it.
     */
    private async crossMultiTileDoor(approach: PathStep, step: PathStep, transport: TransportInfo, log: (msg: string) => void): Promise<boolean> {
        const dir = { x: Math.sign(step.x - approach.x), z: Math.sign(step.z - approach.z) };
        const landing = { x: step.x + dir.x, z: step.z + dir.z, level: step.level };
        // On the far side once we're strictly closer to `step` than to the
        // `approach` tile we started from — mirrors handleSpecialCrossing's test.
        const onFarSide = (): boolean => {
            const me = reader.worldTile();
            return me !== null && me.level === step.level && chebyshev(me, step) < chebyshev(me, approach);
        };
        const deadline = performance.now() + MULTI_DOOR_CROSS_MS;
        while (performance.now() < deadline) {
            if (onFarSide()) {
                log(`crossed ${transport.locName} at (${transport.locX},${transport.locZ})`);
                return true;
            }
            const shut = this.findTransportLoc(transport);
            if (shut) {
                // closed (first arrival) or reverted mid-cross — open it and let
                // the open register before trying to step through
                if (!shut.interact(transport.action)) {
                    log(`'${transport.action}' not offered by ${transport.locName} (ops: ${shut.actions().join(', ')})`);
                    return false;
                }
                await Execution.delayUntil(() => this.findTransportLoc(transport) === null, TRANSPORT_WAIT_MS);
                continue;
            }
            // door open — walk to the landing tile PAST the door; the client
            // routes around the swung-open loc (canReach mirrors that route, so a
            // click only issues when one exists), and we loop back to re-open if
            // it reverts before we cross
            const local = reader.toLocal(landing.x, landing.z);
            if (local && Reachability.canReach(landing, { maxSteps: 128 })) {
                ActionRouter.driver.walk(local.lx, local.lz);
            }
            await Execution.delayTicks(2);
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

        const loc = this.findTransportLoc({ locName: sc.locName, action: sc.action, locX: sc.x, locZ: sc.z });
        if (!loc) {
            log(`${sc.label}: '${sc.locName}' not found at (${sc.x},${sc.z})`);
            return false;
        }
        if (!loc.interact(sc.action)) {
            log(`${sc.label}: '${sc.action}' not offered (ops: ${loc.actions().join(', ')})`);
            return false;
        }

        const crossed = (): boolean => {
            const me = reader.worldTile();
            // "Crossed" = now strictly on the far side of the gate: closer to the
            // far tile (step) than to the near approach tile. approach and step
            // are coordinate-adjacent (a 1-tile door hop), so a plain proximity
            // check to step would be true while still standing on approach; this
            // relative check only trips once we have actually moved across.
            return me !== null && me.level === step.level && chebyshev(me, step) < chebyshev(me, approach);
        };
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
}

export const WalkExecutor = new WalkExecutorImpl();
