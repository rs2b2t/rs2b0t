import type { WorldTile } from '../adapter/ClientAdapter.js';
import { reader } from '../adapter/ClientAdapter.js';
import { EventSignal } from '../api/EventSignal.js';
import { CANT_REACH, GameMessages } from '../events/gameMessages.js';
import { Execution } from '../api/Execution.js';
import { Sustain } from '../api/Sustain.js';
import { Locs } from '../api/queries/Locs.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Bank } from '../api/hud/Bank.js';
import { Banking } from '../api/Banking.js';
import { nearestBank } from '../api/BankLocations.js';
import { SPECIAL_CROSSINGS, specialCrossingForTransport, meetsRequirement, meetsSkill } from './data/specialCrossings.js';
import { Skills } from '../api/hud/Skills.js';
import { Reachability } from '../api/Reachability.js';
import { ActionRouter } from '../input/ActionRouter.js';
import { Navigator, type PathResult } from './Navigator.js';
import { DirectNavigator } from './DirectNavigator.js';
import type { TransportInfo, Waypoint } from './PathFinder.js';
import {
    chebyshev,
    crossingEligible,
    locateOnPath,
    selectClickTarget,
    starvedTerminalIndex
} from './followMath.js';
import { classifyReason } from './walkLadder.js';
import { isArrived } from './arrival.js';
import { snapshotWorldStateData } from './v2/worldStateLive.js';
import type { PathPolicy } from './v2/types.js';
import type { WorldStateData } from './v2/worldStateData.js';
import { formatHops } from './v2/hops.js';
import { isNavV2, type NavEngineId } from './navEngine.js';
import { executeTeleportHop } from './v2/teleportExecute.js';
import { missingItemsForPath, pathHasTeleport, planBankLeg } from './v2/bankPlan.js';
import { virtualizeWithItems } from './v2/virtualState.js';
import { findForwardRecoveryIndex } from './v2/routeRecovery.js';
import { RouteState } from './v2/routeState.js';
import { PathPublish, formatHopLabel } from './pathPublish.js';
import {
    crossMultiTileDoor,
    isOpenableBarrier,
    isOpenBarrierLeaf,
    noteFailedDoor,
    questLockDoorTileNearPlayer,
    tryNearbyDoor
} from './exec/doorCrossing.js';
import { handleSpecialCrossing } from './exec/specialCrossing.js';
import {
    findTransportLoc,
    matchesTransportLanding,
    matchesTransportLoc,
    openShutTrapdoor
} from './exec/transportLoc.js';
import { chatShowsQuestLock, dismissQuestLockDialogue } from './exec/questLock.js';

// Re-export for existing tests
export { isOpenableBarrier, isOpenBarrierLeaf, matchesTransportLoc, matchesTransportLanding };

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
const SCENE_STEP_MS = 8000;
const REACH_CHECK_STEPS = 1200;

export interface WalkOptions {
    radius?: number;
    timeoutMs?: number;
    log?: (msg: string) => void;
    maxExpansions?: number;
    /**
     * Force walker engine for this walk. Default: Global setting `navEngine`
     * (`classic` | `v2`). Classic preserves pre–nav-v2 routing.
     */
    navEngine?: NavEngineId;
    /** nav-v2 only: path policy (tele toggles, distanceBeforeTeleport, …). */
    policy?: PathPolicy;
    /**
     * nav-v2 only: include spell/jewellery tele edges in A*.
     * When navEngine is v2, defaults to true unless set false or policy.useTeleports is false.
     */
    useTeleportCatalog?: boolean;
    /**
     * nav-v2 only: optional known bank item counts for the bank planner
     * (tests / when bank is not open). When omitted, planner uses open-bank
     * counts only and never opens a bank just to probe.
     */
    bankItemCounts?: Record<string, number>;
}

interface PathStep extends WorldTile {
    transport?: TransportInfo;
}

type FollowResult = 'arrived' | 'closest' | 'blocked' | 'repath' | 'failed' | 'interrupted';

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

    /** Session blacklist for quest-locked doors (Microbot pattern). */
    private sessionBlacklistDoors = new Set<string>();

    private walkPolicy: PathPolicy | undefined;

    private walkUseTeleports = false;

    /** Resolved engine for the current walkTo (classic | v2). */
    private walkEngine: NavEngineId = 'classic';

    /** At most one bank-for-route leg per walkTo. */
    private bankLegDone = false;

    private walkBankItemCounts: Record<string, number> | undefined;

    async walkTo(dest: WorldTile, opts?: WalkOptions): Promise<boolean> {
        const radius = opts?.radius ?? 2;
        const timeoutMs = opts?.timeoutMs ?? 300_000;
        const log = opts?.log ?? ((): void => {});
        const maxExpansions = opts?.maxExpansions;
        this.walkEngine = isNavV2(opts?.navEngine) ? 'v2' : 'classic';
        this.walkPolicy = this.walkEngine === 'v2' ? opts?.policy : undefined;
        this.walkUseTeleports =
            this.walkEngine === 'v2'
            && opts?.useTeleportCatalog !== false
            && opts?.policy?.useTeleports !== false;
        this.walkBankItemCounts = this.walkEngine === 'v2' ? opts?.bankItemCounts : undefined;
        this.bankLegDone = false;
        const deadline = performance.now() + timeoutMs;
        this.lastOutcome = null;
        this.resetAvoids();
        RouteState.reset();
        if (this.walkEngine === 'v2') {
            log(
                `nav engine=v2 tele=${this.walkUseTeleports} policy=${JSON.stringify(this.walkPolicy ?? { useTeleports: this.walkUseTeleports })}`
            );
        }

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

                // Path-scoped bank planner (v2 only, at most once).
                if (this.walkEngine === 'v2' && !this.bankLegDone) {
                    const banked = await this.maybeBankForRoute(me, dest, path, maxExpansions, log);
                    if (banked) {
                        this.bankLegDone = true;
                        continue;
                    }
                }

                const hops = path.hops ?? [];
                if (this.walkEngine === 'v2') {
                    log(
                        `path: cost ${path.cost}, ${path.waypoints.length} waypoints, expanded ${path.expanded}, worker ${path.elapsedMs?.toFixed(1)}ms, hops=${hops.length}${repaths > 0 ? ` (repath ${repaths})` : ''}`
                    );
                    if (hops.length > 0) {
                        log(`hops:\n${formatHops(hops)}`);
                    }
                } else {
                    log(
                        `path: cost ${path.cost}, ${path.waypoints.length} waypoints, expanded ${path.expanded}, worker ${path.elapsedMs?.toFixed(1)}ms${repaths > 0 ? ` (repath ${repaths})` : ''}`
                    );
                }

                const tiles = expandWaypoints(path.waypoints);
                this.publishPath(tiles, 0, -1);

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
            PathPublish.clear();
            RouteState.reset();
        }
    }

    private publishPath(tiles: PathStep[], pathIdx: number, clickIdx: number): void {
        PathPublish.set(
            tiles.map(t => {
                const tr = t.transport;
                if (!tr) {
                    return { x: t.x, z: t.z, level: t.level };
                }
                return {
                    x: t.x,
                    z: t.z,
                    level: t.level,
                    transport: true,
                    label: formatHopLabel(tr)
                };
            }),
            pathIdx,
            clickIdx
        );
        RouteState.setPathIdx(pathIdx);
        if (clickIdx >= 0 && tiles[clickIdx]) {
            RouteState.setInterimClick(tiles[clickIdx]!);
        } else {
            RouteState.setInterimClick(null);
        }
    }

    /**
     * If bank items (open bank or opts.bankItemCounts) enable a cheaper tele/toll
     * route, walk bank once, withdraw only path-scoped missing items, return true
     * so walkTo repaths.
     */
    private async maybeBankForRoute(
        from: WorldTile,
        dest: WorldTile,
        directPath: PathResult & { ok: true },
        maxExpansions: number | undefined,
        log: (msg: string) => void
    ): Promise<boolean> {
        if (pathHasTeleport(directPath.waypoints)) {
            return false;
        }

        const bankItems = this.readBankItemCounts();
        if (!bankItems || Object.keys(bankItems).length === 0) {
            return false;
        }

        let state: WorldStateData | undefined;
        try {
            state = snapshotWorldStateData();
        } catch {
            return false;
        }

        const virtual = virtualizeWithItems(state, bankItems);
        const pathVirtual = await this.requestPath(from, dest, maxExpansions, virtual);
        if (!pathVirtual.ok) {
            return false;
        }

        const missing = missingItemsForPath(pathVirtual.waypoints, state);
        if (missing.length === 0) {
            return false;
        }

        // Virtual path must actually use something that needed those items.
        if (!pathHasTeleport(pathVirtual.waypoints) && missing.every(m => !/rune|coins/i.test(m.name))) {
            // Still allow toll coins etc. if specials appear — already in missing via bankPlan.
        }

        const bank = nearestBank(from);
        if (!bank) {
            return false;
        }
        const stand: WorldTile = { x: bank.tile.x, z: bank.tile.z, level: bank.tile.level };

        const toBank = await this.requestPath(from, stand, maxExpansions);
        if (!toBank.ok) {
            return false;
        }
        const bankToDest = await this.requestPath(stand, dest, maxExpansions, virtual);
        if (!bankToDest.ok) {
            return false;
        }

        const plan = planBankLeg({
            directCost: directPath.cost,
            directHasTeleport: false,
            toBankCost: toBank.cost,
            bankToDestCost: bankToDest.cost,
            missing
        });
        if (plan.action !== 'bank') {
            return false;
        }

        log(
            `bank plan: withdraw ${plan.missing.map(m => `${m.count}×${m.name}`).join(', ')} `
                + `(est cost ${plan.estimatedCost} < direct ${directPath.cost})`
        );

        // Walk to bank (classic path, no nested bank plan).
        this.bankLegDone = true; // prevent recursion while walking to bank
        const reached = await this.walkToBankOnly(stand, log);
        if (!reached) {
            log('bank plan: could not reach bank — continuing direct');
            return false;
        }

        if (!(await Banking.open({ preferNearby: true, log: m => log(`  ${m}`) }))) {
            log('bank plan: could not open bank — continuing direct');
            return false;
        }

        for (const item of plan.missing) {
            const have = Inventory.count(item.name);
            const need = item.count;
            if (have >= need) {
                continue;
            }
            const take = need - have;
            const ok = await Bank.withdrawX(item.name, take);
            if (!ok) {
                log(`bank plan: failed to withdraw ${take}×${item.name}`);
            } else {
                log(`bank plan: withdrew ${take}×${item.name}`);
            }
        }
        if (Bank.isOpen()) {
            await Bank.close().catch(() => undefined);
        }
        await Execution.delayTicks(1);
        return true;
    }

    /** Walk to bank without re-entering bank planner. */
    private async walkToBankOnly(stand: WorldTile, log: (msg: string) => void): Promise<boolean> {
        const saved = this.bankLegDone;
        this.bankLegDone = true;
        try {
            // Use a nested walk with same engine but bank leg already "done".
            const radius = 4;
            const timeoutMs = 120_000;
            const deadline = performance.now() + timeoutMs;
            for (let repaths = 0; repaths <= MAX_REPATHS; repaths++) {
                const me = reader.worldTile();
                if (!me) {
                    return false;
                }
                if (isArrived(me, stand, radius, Reachability.arrivalProbe())) {
                    return true;
                }
                const path = await this.requestPath(me, stand);
                if (!path.ok) {
                    log(`bank plan: no path to bank: ${path.reason}`);
                    return false;
                }
                const tiles = expandWaypoints(path.waypoints);
                this.publishPath(tiles, 0, -1);
                const result = await this.followPath(tiles, stand, radius, deadline, m => log(`  ${m}`));
                if (result === 'arrived' || result === 'closest' || result === 'blocked') {
                    return true;
                }
                if (result === 'failed' || result === 'interrupted') {
                    return false;
                }
            }
            return false;
        } finally {
            this.bankLegDone = saved;
        }
    }

    private readBankItemCounts(): Record<string, number> | null {
        if (this.walkBankItemCounts && Object.keys(this.walkBankItemCounts).length > 0) {
            return this.walkBankItemCounts;
        }
        if (!Bank.isOpen()) {
            return null;
        }
        const out: Record<string, number> = {};
        for (const item of Bank.items()) {
            if (!item.name) {
                continue;
            }
            out[item.name] = (out[item.name] ?? 0) + item.count;
        }
        return out;
    }

    private async requestPath(
        from: WorldTile,
        to: WorldTile,
        maxExpansions?: number,
        stateOverride?: WorldStateData
    ): Promise<PathResult> {
        let result: PathResult | null = null;
        const avoid = [
            ...this.avoidDoors,
            ...[...this.sessionBlacklistDoors].map(k => {
                const [x, z] = k.split('|').map(Number);
                return { x: x!, z: z! };
            })
        ];

        let state: WorldStateData | undefined;
        let policy;
        let useTeleportCatalog = false;
        if (this.walkEngine === 'v2') {
            if (stateOverride) {
                state = stateOverride;
            } else {
                try {
                    state = snapshotWorldStateData();
                } catch (e) {
                    state = undefined;
                    console.warn('[nav-v2] worldState snapshot failed', e);
                }
            }
            policy = this.walkPolicy ?? { useTeleports: this.walkUseTeleports };
            useTeleportCatalog = this.walkUseTeleports;
        }

        Navigator.findPath(from, to, {
            avoidDoors: avoid,
            maxExpansions,
            state,
            policy,
            useTeleportCatalog
        }).then(
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
        for (const key of this.sessionBlacklistDoors) {
            const [x, z] = key.split('|').map(Number);
            this.avoidDoors.push({ x: x!, z: z! });
        }
    }

    /** Blacklist a door for this walk session after quest-lock dialogue. */
    blacklistDoor(x: number, z: number): void {
        this.sessionBlacklistDoors.add(`${x}|${z}`);
        this.avoidDoors.push({ x, z });
    }

    async probeDest(dest: WorldTile, maxExpansions: number): Promise<{ ok: boolean; terminal: WorldTile | null }> {
        const me = reader.worldTile();
        if (!me) {
            return { ok: false, terminal: null };
        }
        this.walkEngine = isNavV2() ? 'v2' : 'classic';
        this.walkUseTeleports = this.walkEngine === 'v2';
        this.walkPolicy = undefined;
        this.resetAvoids();
        const path = await this.requestPath(me, dest, maxExpansions);
        if (!path.ok || path.waypoints.length === 0) {
            return { ok: false, terminal: null };
        }
        const last = path.waypoints[path.waypoints.length - 1];
        return { ok: true, terminal: { x: last.x, z: last.z, level: last.level } };
    }

    private async followPath(
        tiles: PathStep[],
        dest: WorldTile,
        radius: number,
        deadline: number,
        log: (msg: string) => void
    ): Promise<FollowResult> {
        let pathIdx = 0;
        let offCorridor = 0;
        let stallTicks = 0;
        let stallRetries = 0;
        let clickIdx = -1;
        let clicks = 0;
        let warnedCombat = false;
        let lastTile: WorldTile | null = null;
        let stillIters = 0;

        const clickable = (t: WorldTile): boolean =>
            reader.toLocal(t.x, t.z) !== null && Reachability.canReach(t, { maxSteps: REACH_CHECK_STEPS });

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

            const progressLimit = tiles.findIndex((tile, index) => index >= pathIdx && tile.transport !== undefined);
            const found = locateOnPath(
                tiles,
                me,
                pathIdx,
                PROGRESS_WINDOW,
                CORRIDOR,
                progressLimit === -1 ? tiles.length - 1 : progressLimit
            );
            if (found !== -1) {
                pathIdx = found;
                offCorridor = 0;
            } else if (++offCorridor >= OFF_CORRIDOR_STRIKES) {
                log(`deviated from path at (${me.x},${me.z},${me.level}) — repathing (${clicks} clicks)`);
                return 'repath';
            }
            this.remaining = tiles.length - 1 - pathIdx;
            RouteState.setPathIdx(pathIdx);
            this.publishPath(tiles, pathIdx, clickIdx);

            const moved = !lastTile || me.x !== lastTile.x || me.z !== lastTile.z || me.level !== lastTile.level;
            stillIters = moved ? 0 : stillIters + 1;
            const shortOfTarget = clickIdx === -1 || chebyshev(me, tiles[clickIdx]) > ARRIVE_RADIUS;
            const noMoveStall =
                !moved
                && (shortOfTarget
                    || stillIters >= STUCK_ITERS
                    || (clickIdx !== -1 && !Reachability.canReach(tiles[clickIdx], { maxSteps: STALL_REACH_STEPS })));
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
            const approachable = (t: WorldTile): boolean =>
                Reachability.canReach(t, { maxSteps: TRIGGER_REACH_STEPS, adjacentOk: true });
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
                noteFailedDoor(tiles[crossingIdx], this.doorStrikes, this.avoidDoors);
                return 'repath';
            }

            if (stallTicks >= STALL_TICKS) {
                stallTicks = 0;
                if (stallRetries === 0) {
                    // First stall: pure forward recovery on published path.
                    const limit = nextCrossingIdx !== -1 ? nextCrossingIdx - 1 : tiles.length - 1;
                    const recover = findForwardRecoveryIndex(tiles, me, pathIdx, clickable, {
                        corridor: CORRIDOR,
                        window: PROGRESS_WINDOW + 20,
                        limitIdx: limit
                    });
                    if (recover !== -1) {
                        const local = reader.toLocal(tiles[recover].x, tiles[recover].z);
                        if (local) {
                            log(`stall recovery → path idx ${recover} (${tiles[recover].x},${tiles[recover].z})`);
                            ActionRouter.driver.walk(local.lx, local.lz);
                            clickIdx = recover;
                            clicks++;
                            stallRetries = 1;
                            this.publishPath(tiles, pathIdx, clickIdx);
                            await Execution.delayTicks(2);
                            continue;
                        }
                    }
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
                    if (await tryNearbyDoor(log)) {
                        stallRetries = 0;
                        clickIdx = -1;
                        lastTile = null;
                        continue;
                    }
                    // Quest-lock after nearby door open attempt.
                    const lockTile = questLockDoorTileNearPlayer();
                    if (lockTile) {
                        log(`quest-locked door at (${lockTile.x},${lockTile.z}) — blacklisting`);
                        this.blacklistDoor(lockTile.x, lockTile.z);
                        await dismissQuestLockDialogue();
                        return 'repath';
                    }
                    if (chatShowsQuestLock()) {
                        await dismissQuestLockDialogue();
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
                const chosen =
                    target !== -1 || nextCrossingIdx !== -1 || pathIdx !== tiles.length - 1 || clickIdx === tiles.length - 1
                        ? target
                        : starvedTerminalIndex(tiles, me, clickable);
                if (chosen !== -1 && !(tiles[chosen].x === me.x && tiles[chosen].z === me.z)) {
                    const local = reader.toLocal(tiles[chosen].x, tiles[chosen].z)!;
                    ActionRouter.driver.walk(local.lx, local.lz);
                    clickIdx = chosen;
                    clicks++;
                    stallTicks = 0;
                    this.publishPath(tiles, pathIdx, clickIdx);
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
                            noteFailedDoor(tiles[nextCrossingIdx], this.doorStrikes, this.avoidDoors);
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

    private async handleTransport(approach: PathStep, step: PathStep, log: (msg: string) => void): Promise<boolean> {
        const transport = step.transport!;

        if (this.walkEngine === 'v2' && (transport.teleportId || transport.kind === 'teleport')) {
            const ok = await executeTeleportHop(transport, log);
            if (ok) {
                RouteState.noteTransport(approach, step);
            }
            return ok;
        }

        const special = specialCrossingForTransport(transport, approach, step);
        if (special) {
            const ok = await handleSpecialCrossing(approach, step, special, log, (d, o) => this.walkTo(d, o));
            if (ok) {
                RouteState.noteTransport(approach, step);
            }
            return ok;
        }

        if (transport.toLevel === undefined && transport.toTile === undefined && chebyshev(approach, step) >= 1) {
            const ok = await crossMultiTileDoor(approach, step, transport, log, (x, z) => this.blacklistDoor(x, z));
            if (ok) {
                RouteState.noteTransport(approach, step);
            }
            return ok;
        }

        for (let attempt = 0; attempt < 2; attempt++) {
            const loc = findTransportLoc(transport);
            if (!loc) {
                if (transport.toLevel === undefined && transport.toTile === undefined) {
                    if (Reachability.canStep(approach, step) || Reachability.canReach(step, { maxSteps: 64, adjacentOk: true })) {
                        log(`${transport.locName} at (${transport.locX},${transport.locZ}) already open`);
                        return true;
                    }
                    log(`transport loc '${transport.locName}' not found but the way is blocked`);
                    return false;
                }
                if (transport.toTile !== undefined && (await openShutTrapdoor(transport, log, Execution.delayUntil.bind(Execution)))) {
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
                const open = (): boolean => findTransportLoc(transport) === null || Reachability.canStep(approach, step);
                crossed = (await Execution.delayUntil(() => open() || cantReach() || chatShowsQuestLock(), TRANSPORT_WAIT_MS)) && open();
            }
            if (crossed) {
                if (transport.toLevel !== undefined) {
                    // docs/NAV.md#level-change-loc-lag
                    await Execution.delayTicks(2);
                }
                log(`${transport.action} ${transport.locName} at (${transport.locX},${transport.locZ}) ok`);
                RouteState.noteTransport(approach, step);
                return true;
            }
            if (chatShowsQuestLock()) {
                log(`quest-locked '${transport.locName}' at (${transport.locX},${transport.locZ}) — blacklisting`);
                this.blacklistDoor(transport.locX, transport.locZ);
                await dismissQuestLockDialogue();
                return false;
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
     * Open a closed door/gate next to the player (walkResilient unstick ladder).
     * Delegates to exec/doorCrossing — kept on the facade so Traversal callers
     * do not import the split module.
     */
    tryNearbyDoor(log: (msg: string) => void): Promise<boolean> {
        return tryNearbyDoor(log);
    }
}

export const WalkExecutor = new WalkExecutorImpl();
