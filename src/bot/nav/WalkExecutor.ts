import type { WorldTile } from '../adapter/ClientAdapter.js';
import { reader } from '../adapter/ClientAdapter.js';
import { EventSignal } from '../api/EventSignal.js';
import { CANT_REACH, GameMessages } from '../events/gameMessages.js';
import { Execution } from '../api/Execution.js';
import { Sustain } from '../api/Sustain.js';
import { Locs, type Loc } from '../api/queries/Locs.js';
import { Npcs } from '../api/queries/Npcs.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Bank } from '../api/hud/Bank.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Quests } from '../api/hud/Quests.js';
import { Banking, isDisposableGatherJunk } from '../api/Banking.js';
import { SPECIAL_CROSSINGS, specialCrossingAt, pickChoice, meetsRequirement, meetsSkill, matchesUseItem, type SpecialCrossing } from './data/specialCrossings.js';
import { Skills } from '../api/hud/Skills.js';
import { Reachability } from '../api/Reachability.js';
import { ActionRouter } from '../input/ActionRouter.js';
import { Navigator, type PathResult } from './Navigator.js';
import { DirectNavigator } from './DirectNavigator.js';
import type { TransportInfo, Waypoint } from './PathFinder.js';
import { chebyshev, chooseCrossClick, crossingEligible, isOnFarSide, locateOnPath, selectClickTarget, shouldApproachClosedBarrier, starvedTerminalIndex } from './followMath.js';
import { classifyReason } from './walkLadder.js';
import { isArrived } from './arrival.js';

const TARGET_STEPS = 20;
const TARGET_JITTER = 4;
const ARRIVE_RADIUS = 4;
const PROGRESS_WINDOW = 26;
// docs/NAV.md#corridor-snap
const CORRIDOR = 3;
const OFF_CORRIDOR_STRIKES = 2;
const STALL_TICKS = 6;
const STALL_REACH_STEPS = 256;
const TRIGGER_REACH_STEPS = 256;
const STUCK_ITERS = 12;
const TRANSPORT_TRIGGER = ARRIVE_RADIUS;
const MAX_REPATHS = 5;
const PATH_REQUEST_TIMEOUT_MS = 30_000;
const TRANSPORT_WAIT_MS = 8000;
const MULTI_DOOR_CROSS_MS = 36_000;
const OPEN_WAIT_MS = 4000;
const SCENE_STEP_MS = 8000;
const APPROACH_WALK_MS = 3000;
const DIALOGUE_STEPS = 24;
const SHIP_DIALOGUE_STEPS = 40;
const GATE_REOPENS = 2;
const REACH_CHECK_STEPS = 1200;

export interface WalkOptions {
    radius?: number;
    timeoutMs?: number;
    log?: (msg: string) => void;
    maxExpansions?: number;
}

interface PathStep extends WorldTile {
    transport?: TransportInfo;
}

type FollowResult = 'arrived' | 'closest' | 'blocked' | 'repath' | 'failed' | 'interrupted';

export function isOpenableBarrier(name: string | null, ops: readonly (string | null)[]): boolean {
    return /(door|gate)/i.test(name ?? '') && ops.some(op => op !== null && /^open/i.test(op));
}

export function isOpenBarrierLeaf(name: string | null, ops: readonly (string | null)[]): boolean {
    return /(door|gate)/i.test(name ?? '') && ops.some(op => op !== null && /^close/i.test(op));
}

export function matchesTransportLoc(transport: TransportInfo, loc: { readonly id: number; tile(): { x: number; z: number } }): boolean {
    const tile = loc.tile();
    if (transport.locId !== undefined) {
        return loc.id === transport.locId && tile.x === transport.locX && tile.z === transport.locZ;
    }
    return Math.max(Math.abs(tile.x - transport.locX), Math.abs(tile.z - transport.locZ)) <= 3;
}

export function matchesTransportLanding(
    transport: TransportInfo,
    expectedLevel: number,
    before: WorldTile | null,
    current: WorldTile | null
): boolean {
    if (!current) {
        return false;
    }
    if (transport.toTile && current.level === expectedLevel && chebyshev(current, transport.toTile) <= 3) {
        return true;
    }
    return transport.acceptAnyLanding === true && before !== null && (
        current.level !== before.level || chebyshev(current, before) > 64
    );
}

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
    remaining = 0;

    lastOutcome: 'arrived' | 'closest' | 'blocked' | 'budget' | 'interrupted' | 'failed' | 'unreachable' | null = null;

    private avoidDoors: { x: number; z: number }[] = [];

    private doorStrikes = new Map<string, number>();

    async walkTo(dest: WorldTile, opts?: WalkOptions): Promise<boolean> {
        const radius = opts?.radius ?? 2;
        const timeoutMs = opts?.timeoutMs ?? 300_000;
        const log = opts?.log ?? ((): void => {});
        const maxExpansions = opts?.maxExpansions;
        const deadline = performance.now() + timeoutMs;
        this.lastOutcome = null;
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

                const terminal = tiles[tiles.length - 1];
                if (terminal && me.level === terminal.level && me.x === terminal.x && me.z === terminal.z) {
                    if (!isArrived(me, dest, radius, Reachability.arrivalProbe())) {
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
                    this.lastOutcome = 'closest';
                    return true;
                }
                if (result === 'blocked') {
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
            }
            log(`giving up after ${MAX_REPATHS} repaths`);
            this.lastOutcome = 'failed';
            return false;
        } finally {
            this.remaining = 0;
        }
    }

    private async requestPath(from: WorldTile, to: WorldTile, maxExpansions?: number): Promise<PathResult> {
        let result: PathResult | null = null;
        Navigator.findPath(from, to, { avoidDoors: this.avoidDoors, maxExpansions }).then(
            r => (result = r),
            err => (result = { ok: false, reason: err instanceof Error ? err.message : String(err), expanded: 0 })
        );
        const settled = await Execution.delayUntil(() => result !== null, PATH_REQUEST_TIMEOUT_MS);
        return settled && result ? result : { ok: false, reason: 'path request timed out', expanded: 0 };
    }

    private resetAvoids(): void {
        this.doorStrikes.clear();
        this.avoidDoors = [];
        for (const sc of SPECIAL_CROSSINGS) {
            const shortItem = sc.requires && !meetsRequirement(Inventory.count(sc.requires.item), sc.requires);
            const shortSkill = sc.requiresSkill && !meetsSkill(Skills.level(sc.requiresSkill.name), sc.requiresSkill);
            if (shortItem || shortSkill) {
                this.avoidDoors.push({ x: sc.x, z: sc.z });
            }
        }
    }

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
        let clickIdx = -1;
        let clicks = 0;
        let warnedCombat = false;
        let lastTile: WorldTile | null = null;
        let stillIters = 0;

        const clickable = (t: WorldTile): boolean => reader.toLocal(t.x, t.z) !== null && Reachability.canReach(t, { maxSteps: REACH_CHECK_STEPS });

        while (performance.now() < deadline) {
            if (EventSignal.pending()) {
                return 'interrupted';
            }
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
                log(`reached path terminal short of dest (${clicks} clicks)`);
                return 'closest';
            }

            // A path can fold back within the spatial corridor while a wall or
            // door still separates its sections. Never localize beyond the
            // next unhandled transport, or a dungeon landing can skip the door
            // that actually leads out of its room (Lumbridge cellar, #12).
            const progressLimit = tiles.findIndex((tile, index) => index >= pathIdx && tile.transport !== undefined);
            const found = locateOnPath(tiles, me, pathIdx, PROGRESS_WINDOW, CORRIDOR, progressLimit === -1 ? tiles.length - 1 : progressLimit);
            if (found !== -1) {
                pathIdx = found;
                offCorridor = 0;
            } else if (++offCorridor >= OFF_CORRIDOR_STRIKES) {
                log(`deviated from path at (${me.x},${me.z},${me.level}) — repathing (${clicks} clicks)`);
                return 'repath';
            }
            this.remaining = tiles.length - 1 - pathIdx;

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

            let nextCrossingIdx = -1;
            for (let i = pathIdx + 1; i < tiles.length; i++) {
                if (tiles[i].transport) {
                    nextCrossingIdx = i;
                    break;
                }
            }
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
                    clickIdx = -1;
                } else if (reader.inCombat()) {
                    if (!warnedCombat) {
                        warnedCombat = true;
                        log('under attack — holding course');
                    }
                    stallRetries = 0;
                    clickIdx = -1;
                } else {
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

            const needClick = clickIdx === -1 || clickIdx <= pathIdx || chebyshev(me, tiles[clickIdx]) <= ARRIVE_RADIUS;
            if (needClick) {
                const limit = nextCrossingIdx !== -1 ? nextCrossingIdx - 1 : tiles.length - 1;
                const steps = TARGET_STEPS + Math.floor(Math.random() * (2 * TARGET_JITTER + 1)) - TARGET_JITTER;
                const target = selectClickTarget(tiles, pathIdx, steps, limit, me.level, clickable);
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
                    stallTicks += 2;
                }
            }

            await Execution.delayTicks(2);
        }

        log('walk timed out');
        return 'failed';
    }

    async tryNearbyDoor(log: (msg: string) => void): Promise<boolean> {
        const door = Locs.query()
            .where(l => isOpenableBarrier(l.name, l.actions()))
            .within(3)
            .nearest();
        if (!door) {
            return false;
        }

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
            this.avoidDoors.push({ x: t.locX, z: t.locZ });
        }
    }

    private async handleTransport(approach: PathStep, step: PathStep, log: (msg: string) => void): Promise<boolean> {
        const transport = step.transport!;

        const special = specialCrossingAt(transport.locX, transport.locZ, step.level);
        if (special) {
            return this.handleSpecialCrossing(approach, step, special, log);
        }

        if (transport.toLevel === undefined && transport.toTile === undefined && chebyshev(approach, step) >= 1) {
            return this.crossMultiTileDoor(approach, step, transport, log);
        }

        for (let attempt = 0; attempt < 2; attempt++) {
            const loc = this.findTransportLoc(transport);
            if (!loc) {
                if (transport.toLevel === undefined && transport.toTile === undefined) {
                    if (Reachability.canStep(approach, step) || Reachability.canReach(step, { maxSteps: 64, adjacentOk: true })) {
                        log(`${transport.locName} at (${transport.locX},${transport.locZ}) already open`);
                        return true;
                    }
                    log(`transport loc '${transport.locName}' not found but the way is blocked`);
                    return false;
                }
                if (transport.toTile !== undefined && await this.openShutTrapdoor(transport, log)) {
                    continue;
                }
                log(`transport loc '${transport.locName}' not found near (${transport.locX},${transport.locZ})`);
                return false;
            }

            const before = reader.worldTile();
            const mark = GameMessages.mark();
            if (!loc.interact(transport.action)) {
                log(`'${transport.action}' not offered by ${transport.locName} (ops: ${loc.actions().join(', ')})`);
                return false;
            }

            const cantReach = (): boolean => GameMessages.sawSince(mark, CANT_REACH);
            let crossed: boolean;
            if (transport.toLevel !== undefined) {
                const toLevel = transport.toLevel;
                const climbed = (): boolean => reader.worldTile()?.level === toLevel;
                crossed = (await Execution.delayUntil(() => climbed() || cantReach(), TRANSPORT_WAIT_MS)) && climbed();
            } else if (transport.toTile !== undefined) {
                const landed = (): boolean => matchesTransportLanding(transport, step.level, before, reader.worldTile());
                crossed = (await Execution.delayUntil(() => landed() || cantReach(), TRANSPORT_WAIT_MS)) && landed();
            } else {
                const open = (): boolean => this.findTransportLoc(transport) === null || Reachability.canStep(approach, step);
                crossed = (await Execution.delayUntil(() => open() || cantReach(), TRANSPORT_WAIT_MS)) && open();
            }
            if (crossed) {
                if (transport.toLevel !== undefined) {
                    // docs/NAV.md#level-change-loc-lag
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
            const shut = this.findTransportLoc(transport);
            // A diagonal wall leaf rotates onto the approach tile as it opens.
            // Only insist on that tile while the *closed* leaf still exists;
            // afterwards it is blocked and we must click through the opening.
            if (shouldApproachClosedBarrier(here, approach, shut !== null)) {
                DirectNavigator.walk(approach);
                await Execution.delayUntil(() => {
                    const p = reader.worldTile();
                    return p !== null && p.x === approach.x && p.z === approach.z && p.level === approach.level;
                }, APPROACH_WALK_MS);
                continue;
            }
            if (shut) {
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
                    log(`server says can't reach ${transport.locName} — repathing`);
                    return false;
                }
                continue;
            }
            const canStepEdge = Reachability.canStep(approach, step);
            const landingLocal = reader.toLocal(landing.x, landing.z);
            const canReachLanding = landingLocal !== null && Reachability.canReach(landing, { maxSteps: 128 });
            const choice = chooseCrossClick(canStepEdge, canReachLanding);
            if (choice === 'step') {
                DirectNavigator.walk(step);
                await Execution.delayUntil(() => isOnFarSide(reader.worldTile(), approach, step), 3000);
            } else if (choice === 'landing-click') {
                ActionRouter.driver.walk(landingLocal!.lx, landingLocal!.lz);
                await Execution.delayTicks(2);
            } else {
                log(`leaf blocks landing — scene-stepping through '${transport.locName}'`);
                DirectNavigator.walk(landing);
                await Execution.delayUntil(() => isOnFarSide(reader.worldTile(), approach, step), SCENE_STEP_MS);
            }
        }
        log(`${transport.locName} at (${transport.locX},${transport.locZ}) did not cross in time, repathing`);
        return false;
    }

    private async handleSpecialCrossing(approach: PathStep, step: PathStep, sc: SpecialCrossing, log: (msg: string) => void): Promise<boolean> {
        if (sc.requires && !meetsRequirement(Inventory.count(sc.requires.item), sc.requires)) {
            log(`${sc.label}: need ${sc.requires.count} ${sc.requires.item} — skipping`);
            return false;
        }

        if (sc.requiresSkill && !meetsSkill(Skills.level(sc.requiresSkill.name), sc.requiresSkill)) {
            log(`${sc.label}: need ${sc.requiresSkill.name} ${sc.requiresSkill.level} — skipping`);
            return false;
        }

        if (sc.unlockQuest) {
            const st = Quests.status(sc.unlockQuest.quest);
            if (st === 'notStarted' || st === 'unknown') {
                if (!(await this.unlockQuestForCrossing(sc, approach, log))) {
                    return false;
                }
            }
        }

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
        const maxOpens = sc.reopenAfterDialogue ? GATE_REOPENS : 1;
        for (let open = 0; open < maxOpens && !crossed(); open++) {
            const loc = this.findTransportLoc({ locName: sc.locName, action: sc.action, locX: sc.x, locZ: sc.z });
            if (!loc) {
                log(`${sc.label}: '${sc.locName}' not found at (${sc.x},${sc.z})`);
                return false;
            }
            if (sc.useItem) {
                const item = Inventory.items().find(candidate => matchesUseItem(candidate, sc.useItem!));
                if (!item) {
                    log(`${sc.label}: need ${sc.useItem.name} (id ${sc.useItem.id}) — skipping`);
                    return false;
                }
                if (!(await item.useOn(loc))) {
                    log(`${sc.label}: could not use ${sc.useItem.name} on ${sc.locName}`);
                    return false;
                }
            } else if (!loc.interact(sc.action)) {
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

    /**
     * Permanent unlock via starting a quest at a nearby NPC (e.g. Drezel → Nature Spirit
     * so Mort Myre gate opens forever). Nested walkTo is intentional: outer path resumes
     * after we return to the approach tile and open the barrier.
     *
     * Pack space: NPCs may grant items on accept (Drezel: 6 unstackable pies). Free
     * disposable junk at a bank first; if still short of freeSlots, give up rather than
     * half-start the quest or drop gear.
     */
    private async unlockQuestForCrossing(
        sc: SpecialCrossing,
        approach: PathStep,
        log: (msg: string) => void
    ): Promise<boolean> {
        const u = sc.unlockQuest!;
        if (u.requireComplete) {
            const req = Quests.status(u.requireComplete);
            if (req !== 'complete') {
                log(`${sc.label}: need ${u.requireComplete} complete before ${u.quest} — skipping`);
                return false;
            }
        }

        const needSlots = u.freeSlots ?? 0;
        if (needSlots > 0 && !(await this.ensureUnlockPackSpace(sc, needSlots, log))) {
            return false;
        }

        log(`${sc.label}: ${u.quest} not started — walking to ${u.npc} to unlock`);
        const toNpc = await this.walkTo(u.stand, {
            radius: 4,
            timeoutMs: 180_000,
            log: m => log(`  ${m}`)
        });
        if (!toNpc) {
            log(`${sc.label}: could not reach ${u.npc} at (${u.stand.x},${u.stand.z})`);
            return false;
        }

        // Re-check after the walk (random-event loot / full pack from elsewhere).
        if (needSlots > 0 && Inventory.free() < needSlots) {
            log(
                `${sc.label}: pack only ${Inventory.free()} free after walk (need ${needSlots} for ${u.npc} rewards) — giving up`
            );
            return false;
        }

        const npc = Npcs.query().name(u.npc).nearest();
        if (!npc || !(await npc.interact('Talk-to'))) {
            log(`${sc.label}: '${u.npc}' not talkable near unlock stand`);
            return false;
        }

        const unlocked = (): boolean => {
            const st = Quests.status(u.quest);
            return st === 'inProgress' || st === 'complete';
        };
        for (let i = 0; i < 80 && !unlocked(); i++) {
            const pick = pickChoice(ChatDialog.options(), u.dialogue.choose);
            if (pick) {
                await ChatDialog.chooseOption(pick);
            } else if (ChatDialog.canContinue()) {
                await ChatDialog.continue();
            } else {
                await Execution.delayTicks(1);
            }
        }
        // Close leftover pie/continue boxes
        for (let i = 0; i < 20 && (ChatDialog.isOpen() || ChatDialog.canContinue()); i++) {
            if (ChatDialog.canContinue()) {
                await ChatDialog.continue();
            } else {
                await Execution.delayTicks(1);
            }
        }

        if (!unlocked()) {
            log(`${sc.label}: talked to ${u.npc} but ${u.quest} still ${Quests.status(u.quest)}`);
            return false;
        }
        log(`${sc.label}: ${u.quest} started — returning to gate`);

        const back = await this.walkTo(approach, {
            radius: 2,
            timeoutMs: 180_000,
            log: m => log(`  ${m}`)
        });
        if (!back) {
            log(`${sc.label}: could not return to gate after unlock`);
            return false;
        }
        return true;
    }

    /**
     * Ensure `need` free pack slots before an unlock NPC grants items.
     * Banks disposable junk only (common loot / event leftovers); never drops gear.
     * Returns false when still short after that attempt.
     */
    private async ensureUnlockPackSpace(
        sc: SpecialCrossing,
        need: number,
        log: (msg: string) => void
    ): Promise<boolean> {
        if (Inventory.free() >= need) {
            return true;
        }

        const junk = Inventory.items().filter(i => isDisposableGatherJunk(i.name, i.id));
        if (junk.length === 0) {
            log(
                `${sc.label}: need ${need} free slots for quest items ` +
                    `(have ${Inventory.free()}, no bankable junk) — giving up`
            );
            return false;
        }

        log(
            `${sc.label}: pack tight (${Inventory.free()}/${need} free) — banking ${junk.length} junk stack(s)`
        );
        if (
            !(await Banking.open({
                preferNearby: true,
                log: m => log(`  ${m}`)
            }))
        ) {
            log(`${sc.label}: could not open bank to free space — giving up`);
            return false;
        }
        await Bank.depositAllMatching((name, id) => isDisposableGatherJunk(name, id));
        await Execution.delayTicks(1);
        if (Bank.isOpen()) {
            await Bank.close().catch(() => undefined);
        }

        if (Inventory.free() < need) {
            log(
                `${sc.label}: still ${Inventory.free()} free after banking junk (need ${need}) — giving up`
            );
            return false;
        }
        log(`${sc.label}: pack ok (${Inventory.free()} free) after banking junk`);
        return true;
    }

    private findTransportLoc(transport: TransportInfo): Loc | null {
        return Locs.query()
            .name(transport.locName)
            .action(transport.action)
            .where(loc => matchesTransportLoc(transport, loc))
            .nearest();
    }

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
