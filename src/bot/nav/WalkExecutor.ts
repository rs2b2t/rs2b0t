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
import { SPECIAL_CROSSINGS, specialCrossingForTransport, meetsRequirement, meetsSkill, pickChoice } from './data/specialCrossings.js';
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
    minChebyshevToPath,
    selectClientWalkTarget,
    starvedTerminalIndex
} from './followMath.js';
import { PATH_CORRIDOR, resolvePathFollowConfig, type PathFollowOverrides } from './pathFollowPolicy.js';
import { BotHost } from '../BotHost.js';
import { classifyReason } from './walkLadder.js';
import { isArrived } from './arrival.js';
import { snapshotWorldStateData } from './worldStateLive.js';
import type { PathPolicy } from './types.js';
import type { WorldStateData } from './worldStateData.js';
import { formatHops } from './hops.js';
import { executeTeleportHop } from './teleportExecute.js';
import { missingItemsForPath, pathHasTeleport, planBankLeg } from './bankPlan.js';
import { virtualizeWithItems } from './virtualState.js';
import { findForwardRecoveryIndex, stallPhase } from './routeRecovery.js';
import { RouteState } from './routeState.js';
import { EssenceSession } from './essenceSession.js';
import { PathPublish, formatHopLabel } from './pathPublish.js';
import { PathCameraFollow, pathFacingYaw } from './cameraFollow.js';
import { resolveDangerZones, type DangerZoneRect } from './data/dangerZones.js';
import { expandWaypoints as expandWaypointsDense, localBfsPath } from './pathExpand.js';
import { DEFAULT_DISTANCE_BEFORE_TELEPORT } from './policy.js';
import { SettingsStore } from '../runtime/Settings.js';
import {
    barrierBannable,
    crossMultiTileDoor,
    DOOR_SESSION_STRIKES,
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
    multiLandingNeedsRepath,
    openShutTrapdoor
} from './exec/transportLoc.js';
import { chatShowsQuestLock, dismissQuestLockDialogue } from './exec/questLock.js';
import { postQuestTalkFor, type PostQuestTalk } from './data/postQuestTalks.js';
import { Quests } from '../api/hud/Quests.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Npcs } from '../api/queries/Npcs.js';

// Re-export for existing tests
export {
    isOpenableBarrier,
    isOpenBarrierLeaf,
    matchesTransportLoc,
    matchesTransportLanding,
    multiLandingNeedsRepath
};

const TARGET_STEPS = 20;
const TARGET_JITTER = 4;
const ARRIVE_RADIUS = 4;
const PROGRESS_WINDOW = 26;
// Path-index snap only. Deviation repath uses pathFollowPolicy (default 10).
const CORRIDOR = PATH_CORRIDOR;
const STALL_REACH_STEPS = 256;
const TRIGGER_REACH_STEPS = 256;
/**
 * Idle ticks before clearing an unreachable walk-click target (re-pick only —
 * does not run stall recovery). Keeps scene-load blips from thrashing clicks.
 */
const UNREACH_CLICK_IDLE_TICKS = 3;
const MAX_REPATHS = 5;
/** Skip another follow attempt if less than this remains on the overall budget. */
const MIN_FOLLOW_REMAINING_MS = 3_000;
const PATH_REQUEST_TIMEOUT_MS = 30_000;
const TRANSPORT_WAIT_MS = 8000;
const SCENE_STEP_MS = 8000;
/** Walking the last tiles onto a hop's planned approach after a server can't-reach. */
const APPROACH_STEP_MS = 4000;
/** Continues/choices to drive on a post-quest unlock conversation. */
const POST_QUEST_TALK_STEPS = 60;
/** How long a talked-to NPC has to put its dialogue on screen. */
const TALK_OPEN_MS = 4000;
const REACH_CHECK_STEPS = 1200;

export interface WalkOptions {
    radius?: number;
    timeoutMs?: number;
    log?: (msg: string) => void;
    maxExpansions?: number;
    /** Path policy (tele toggles, distanceBeforeTeleport, deny lists, …). */
    policy?: PathPolicy;
    /**
     * Include spell/jewellery tele edges in A*.
     * Default: Global `navTeleports` (off). Explicit true/false overrides Global;
     * `policy.useTeleports: false` always forces off.
     */
    useTeleportCatalog?: boolean;
    /**
     * Optional known bank item counts for the bank planner
     * (tests / when bank is not open). When omitted, planner uses open-bank
     * counts only and never opens a bank just to probe.
     */
    bankItemCounts?: Record<string, number>;
    /**
     * Danger / no-go zones the pathfinder must not enter.
     * Pass known ids (`'white-wolf-mountain'`) and/or ad-hoc rects.
     * Automatic catalog zones are also resolved from live player state.
     * Idea credit: @lolwut.
     * @see src/bot/nav/data/dangerZones.ts
     */
    avoidZones?: readonly (string | import('./data/dangerZones.js').DangerZoneRect)[];
    /**
     * Path stickiness (stall / deviation). Defaults: Global `navPathStallTicks` (9)
     * and `navPathDeviation` (10). Plan once at request; repath only on stall,
     * deviation past this Chebyshev, or {@link WalkExecutor.requestRepath}.
     */
    pathFollow?: PathFollowOverrides;
    /** Force a full repath for this walk (scripts that know the route is stale). */
    forceRepath?: boolean;
}

interface PathStep extends WorldTile {
    transport?: TransportInfo;
}

type FollowResult = 'arrived' | 'closest' | 'blocked' | 'repath' | 'failed' | 'interrupted';

function expandWaypoints(waypoints: Waypoint[]): PathStep[] {
    // Experimental: scene-aware BFS when Global.navPathSceneExpand (opt-in debug).
    let scene: import('./pathExpand.js').ExpandWorldFns | null = null;
    try {
        const on = SettingsStore.globalBag().bool('navPathSceneExpand', false);
        if (on && reader.attached()) {
            scene = {
                toLocal: (x, z) => reader.toLocal(x, z),
                flags: (lx, lz) => reader.collisionFlags(lx, lz)
            };
        }
    } catch {
        scene = null;
    }
    return expandWaypointsDense(waypoints as PathStep[], scene) as PathStep[];
}

/**
 * Per-walk tele inject: explicit opts win; else Global `navTeleports` (default off).
 */
function resolveWalkUseTeleports(opts?: WalkOptions): boolean {
    if (opts?.useTeleportCatalog === false || opts?.policy?.useTeleports === false) {
        return false;
    }
    if (opts?.useTeleportCatalog === true || opts?.policy?.useTeleports === true) {
        return true;
    }
    try {
        return SettingsStore.globalBag().bool('navTeleports', false);
    } catch {
        return false;
    }
}

class WalkExecutorImpl {
    remaining = 0;

    lastOutcome: 'arrived' | 'closest' | 'blocked' | 'budget' | 'interrupted' | 'failed' | 'unreachable' | null = null;

    private avoidDoors: { x: number; z: number }[] = [];

    private doorStrikes = new Map<string, number>();

    /** Session blacklist for quest-locked doors. */
    private sessionBlacklistDoors = new Set<string>();

    /** Post-quest unlock talks already spent this run (see data/postQuestTalks.ts). */
    private sessionPostQuestTalks = new Set<string>();

    /** Teleport ids rejected this walk (server fail / no land) — not re-planned (#339). */
    private sessionSuppressedTeleports = new Set<string>();

    /** Nest depth for walkTo (special crossings re-enter); only outer clears suppress. */
    private walkDepth = 0;

    private walkPolicy: PathPolicy | undefined;

    private walkUseTeleports = false;

    /** At most one bank-for-route leg per walkTo. */
    private bankLegDone = false;

    private walkBankItemCounts: Record<string, number> | undefined;

    /** Danger zones for this walk (resolved rects). */
    private walkAvoidZones: DangerZoneRect[] = [];

    /** Stickiness for the active walk (stall ticks / deviation Chebyshev). */
    private pathFollow = resolvePathFollowConfig();

    /**
     * Scripts call this to force a repath on the next followPath loop (or next walkTo).
     * Always honored — does not wait for stall/deviation.
     */
    private forceRepathPending = false;

    requestRepath(_reason?: string): void {
        this.forceRepathPending = true;
    }

    async walkTo(dest: WorldTile, opts?: WalkOptions): Promise<boolean> {
        const radius = opts?.radius ?? 2;
        const timeoutMs = opts?.timeoutMs ?? 300_000;
        const log = opts?.log ?? ((): void => {});
        const maxExpansions = opts?.maxExpansions;
        this.walkUseTeleports = resolveWalkUseTeleports(opts);
        this.pathFollow = resolvePathFollowConfig(opts?.pathFollow);
        if (opts?.forceRepath) {
            this.forceRepathPending = true;
        }
        // Defaults first; caller policy can set distanceBeforeTeleport: 0 to allow short teles.
        this.walkPolicy = {
            useTeleports: this.walkUseTeleports,
            distanceBeforeTeleport: DEFAULT_DISTANCE_BEFORE_TELEPORT,
            ...(opts?.policy ?? {})
        };
        this.walkBankItemCounts = opts?.bankItemCounts;
        const walkStart = reader.worldTile();
        this.walkAvoidZones = resolveDangerZones(opts?.avoidZones, {
            includeAutomatic: true,
            combatLevel: reader.combatLevel(),
            ...(walkStart ? { start: walkStart } : {}),
            destination: dest
        });
        this.bankLegDone = false;
        const outer = this.walkDepth === 0;
        this.walkDepth++;
        if (outer) {
            // Nested walkTo (special crossings) must keep suppress so outer repath
            // does not re-pick a failed tele (#339).
            this.sessionSuppressedTeleports.clear();
        }
        const walkStartedAt = performance.now();
        const deadline = walkStartedAt + timeoutMs;
        this.lastOutcome = null;
        this.resetAvoids();
        RouteState.reset();
        if (outer) {
            log(
                `nav tele=${this.walkUseTeleports} policy=${JSON.stringify(this.walkPolicy ?? { useTeleports: this.walkUseTeleports })}`
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

                // Path-scoped bank planner (at most once per walk).
                if (!this.bankLegDone) {
                    const banked = await this.maybeBankForRoute(me, dest, path, maxExpansions, log);
                    if (banked) {
                        this.bankLegDone = true;
                        continue;
                    }
                }

                const hops = path.hops ?? [];
                log(
                    `path: cost ${path.cost}, ${path.waypoints.length} waypoints, expanded ${path.expanded}, worker ${path.elapsedMs?.toFixed(1)}ms, hops=${hops.length}${repaths > 0 ? ` (repath ${repaths})` : ''}`
                );
                if (hops.length > 0) {
                    log(`hops:\n${formatHops(hops)}`);
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

                // Shared overall deadline across repaths (caller timeoutMs). Each
                // follow uses remaining time only — never extends past deadline.
                const remaining = deadline - performance.now();
                if (remaining < MIN_FOLLOW_REMAINING_MS) {
                    log(
                        `walk timed out (budget ${Math.round(timeoutMs / 1000)}s, ` +
                            `elapsed ${Math.round((performance.now() - walkStartedAt) / 1000)}s, ` +
                            `repath ${repaths}, remaining ${Math.max(0, Math.round(remaining / 1000))}s)`
                    );
                    this.lastOutcome = 'failed';
                    return false;
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
                    // followPath failed = its deadline (overall) hit.
                    log(
                        `walk timed out (budget ${Math.round(timeoutMs / 1000)}s, ` +
                            `elapsed ${Math.round((performance.now() - walkStartedAt) / 1000)}s, repath ${repaths})`
                    );
                    this.lastOutcome = 'failed';
                    return false;
                }
                if (result === 'interrupted') {
                    log('walk interrupted — a random event is being handled');
                    this.lastOutcome = 'interrupted';
                    return false;
                }
                // result === 'repath' — continue loop with remaining overall budget
            }
            log(`giving up after ${MAX_REPATHS} repaths`);
            this.lastOutcome = 'failed';
            return false;
        } finally {
            this.walkDepth = Math.max(0, this.walkDepth - 1);
            this.remaining = 0;
            PathPublish.clear();
            RouteState.reset();
            PathCameraFollow.release();
        }
    }

    /**
     * Experimental debug: paint the route the client took on the last walk click.
     * Prefer tryMove's recorded path; fall back to scene BFS. Never throws into followPath.
     */
    private publishClientWalkSegment(
        from: WorldTile,
        to: { x: number; z: number; level: number }
    ): void {
        try {
            if (!SettingsStore.globalBag().bool('navPathClientSegment', false)) {
                PathPublish.setClientSegment(null);
                return;
            }

            // Exact client path (includes tryNearest landing) — primary.
            const clientPath =
                typeof reader.lastWalkPathWorld === 'function' ? reader.lastWalkPathWorld() : [];
            if (clientPath.length >= 2) {
                PathPublish.setClientSegment(clientPath);
                return;
            }

            // Fallback: scene BFS (may fail on closed gates the pack path still lists).
            if (from.level !== to.level) {
                return;
            }
            const a = reader.toLocal(from.x, from.z);
            const b = reader.toLocal(to.x, to.z);
            if (!a || !b) {
                return;
            }
            const path = localBfsPath((lx, lz) => reader.collisionFlags(lx, lz), a, b, 2000);
            if (!path || path.length < 2) {
                return;
            }
            PathPublish.setClientSegment(
                path.map(p => ({
                    x: from.x + (p.lx - a.lx),
                    z: from.z + (p.lz - a.lz),
                    level: from.level
                }))
            );
        } catch {
            // Paint must never abort a walk.
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
                    label: formatHopLabel(tr),
                    // Loc placement + identity for object-hull highlighter
                    locX: tr.locX,
                    locZ: tr.locZ,
                    locId: tr.locId,
                    locName: tr.locName,
                    action: tr.action,
                    kind: tr.kind,
                    teleportId: tr.teleportId
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
     * Publish desired path-facing yaw; PathCameraFollow eases on the frame loop
     * while Global.navCameraFollow is on (smooth, not walk-tick snap).
     */
    private maybeFacePathCamera(me: WorldTile, tiles: PathStep[], pathIdx: number): void {
        const yaw = pathFacingYaw(me, tiles, pathIdx, 12);
        if (yaw === null) {
            return;
        }
        PathCameraFollow.samplePathYaw(yaw);
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

        // MissingItem.count is the shortage (required − held at plan time), not the
        // total required amount. Withdraw that count directly — do not subtract
        // inventory again (see #336).
        for (const item of plan.missing) {
            const take = item.count;
            if (take <= 0) {
                continue;
            }
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
        // Live avoid list was built pre-bank from empty inventory. Recompute
        // special-crossing item/skill gates so the post-bank repath can use
        // newly affordable tolls (#338).
        this.refreshSpecialCrossingAvoids();
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
        // Virtual bank planning must recompute item-gated crossing avoids against
        // the virtual inventory; live-item blacklists would hide the exact tolls
        // banking is meant to unlock (#338). Session-failed doors and skill gates stay.
        const avoid = stateOverride
            ? this.avoidListForState(stateOverride)
            : [
                ...this.avoidDoors,
                ...[...this.sessionBlacklistDoors].map(k => {
                    const [x, z] = k.split('|').map(Number);
                    return { x: x!, z: z! };
                })
            ];

        // Snapshot WorldState so requirements-gated transports
        // (agility shortcuts, quest doors, tolls) are evaluated for the live player.
        let state: WorldStateData | undefined;
        if (stateOverride) {
            state = stateOverride;
        } else {
            try {
                state = snapshotWorldStateData();
            } catch (e) {
                state = undefined;
                console.warn('[nav] worldState snapshot failed', e);
            }
        }
        const policy: PathPolicy = {
            useTeleports: this.walkUseTeleports,
            distanceBeforeTeleport: DEFAULT_DISTANCE_BEFORE_TELEPORT,
            ...(this.walkPolicy ?? {})
        };
        const useTeleportCatalog = this.walkUseTeleports;
        if (this.sessionSuppressedTeleports.size > 0) {
            const denied = new Set([
                ...(policy.denyTeleportIds ?? []),
                ...this.sessionSuppressedTeleports
            ]);
            policy.denyTeleportIds = [...denied];
        }

        Navigator.findPath(from, to, {
            avoidDoors: avoid,
            maxExpansions,
            state,
            policy,
            useTeleportCatalog,
            avoidZones: this.walkAvoidZones.length > 0 ? this.walkAvoidZones : undefined
        }).then(
            r => (result = r),
            err => (result = { ok: false, reason: err instanceof Error ? err.message : String(err), expanded: 0 })
        );
        const settled = await Execution.delayUntil(() => result !== null, PATH_REQUEST_TIMEOUT_MS);
        return settled && result ? result : { ok: false, reason: 'path request timed out', expanded: 0 };
    }

    /**
     * Avoid list for a virtual (or other) WorldState: keep session blacklists and
     * skill-gated specials, but re-evaluate item requirements against `state.items`
     * so bank-planned routes can use tolls the live inventory cannot.
     */
    private avoidListForState(state: WorldStateData): { x: number; z: number }[] {
        const avoid: { x: number; z: number }[] = [];
        for (const sc of SPECIAL_CROSSINGS) {
            const itemCount = sc.requires
                ? (state.items[sc.requires.item] ?? 0)
                : 0;
            const shortItem = sc.requires && !meetsRequirement(itemCount, sc.requires);
            const skillLevel = sc.requiresSkill
                ? (state.skills[sc.requiresSkill.name] ?? state.skills[sc.requiresSkill.name.toLowerCase()] ?? 0)
                : 0;
            const shortSkill = sc.requiresSkill && !meetsSkill(skillLevel, sc.requiresSkill);
            if (shortItem || shortSkill) {
                avoid.push({ x: sc.x, z: sc.z });
            }
        }
        for (const key of this.sessionBlacklistDoors) {
            const [x, z] = key.split('|').map(Number);
            avoid.push({ x: x!, z: z! });
        }
        // Runtime door-failure strikes from this.avoidDoors that are not pure
        // special-crossing prefilters — keep any extra entries already struck.
        const specialKeys = new Set(SPECIAL_CROSSINGS.map(sc => `${sc.x}|${sc.z}`));
        for (const d of this.avoidDoors) {
            const k = `${d.x}|${d.z}`;
            if (!specialKeys.has(k) && !this.sessionBlacklistDoors.has(k)) {
                avoid.push(d);
            }
        }
        return avoid;
    }

    /**
     * Drop special-crossing prefilters and re-add only those still unmet from
     * live inventory/skills. Preserves session blacklists and runtime door
     * strikes (non-special avoid entries).
     */
    private refreshSpecialCrossingAvoids(): void {
        const specialKeys = new Set(SPECIAL_CROSSINGS.map(sc => `${sc.x}|${sc.z}`));
        this.avoidDoors = this.avoidDoors.filter(d => !specialKeys.has(`${d.x}|${d.z}`));
        for (const sc of SPECIAL_CROSSINGS) {
            const shortItem = sc.requires && !meetsRequirement(Inventory.count(sc.requires.item), sc.requires);
            const shortSkill = sc.requiresSkill && !meetsSkill(Skills.level(sc.requiresSkill.name), sc.requiresSkill);
            if (shortItem || shortSkill) {
                this.avoidDoors.push({ x: sc.x, z: sc.z });
            }
        }
        for (const key of this.sessionBlacklistDoors) {
            const [x, z] = key.split('|').map(Number);
            const already = this.avoidDoors.some(d => d.x === x && d.z === z);
            if (!already) {
                this.avoidDoors.push({ x: x!, z: z! });
            }
        }
    }

    private resetAvoids(): void {
        // Strikes deliberately survive the walk — see DOOR_SESSION_STRIKES.
        this.avoidDoors = [];
        this.refreshSpecialCrossingAvoids();
    }

    /** Blacklist a door for this walk session after quest-lock dialogue. */
    blacklistDoor(x: number, z: number): void {
        this.sessionBlacklistDoors.add(`${x}|${z}`);
        this.avoidDoors.push({ x, z });
    }

    /**
     * A crossing was attempted and the player is still on the near side. Past
     * {@link DOOR_SESSION_STRIKES} the placement is shut for good as far as this
     * run is concerned — otherwise the next ladder pass plans straight back
     * through it and the walk never terminates.
     */
    private noteDoorRefusal(hop: PathStep, log: (msg: string) => void): void {
        const strikes = noteFailedDoor(hop, this.doorStrikes, this.avoidDoors);
        const t = hop.transport;
        if (
            t
            && strikes >= DOOR_SESSION_STRIKES
            && barrierBannable(t.kind, t.locName)
            && !this.sessionBlacklistDoors.has(`${t.locX}|${t.locZ}`)
        ) {
            log(
                `'${t.locName}' at (${t.locX},${t.locZ}) refused ${strikes} crossings — routing around it for the rest of the run`
            );
            this.blacklistDoor(t.locX, t.locZ);
        }
    }

    async probeDest(dest: WorldTile, maxExpansions: number): Promise<{ ok: boolean; terminal: WorldTile | null }> {
        const me = reader.worldTile();
        if (!me) {
            return { ok: false, terminal: null };
        }
        this.walkUseTeleports = resolveWalkUseTeleports(undefined);
        this.walkPolicy = {
            useTeleports: this.walkUseTeleports,
            distanceBeforeTeleport: DEFAULT_DISTANCE_BEFORE_TELEPORT
        };
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
        let stallRetries = 0;
        let clickIdx = -1;
        let clicks = 0;
        let warnedCombat = false;
        let lastTile: WorldTile | null = null;
        /** GameMessages watermark after the last *successful* walk click. */
        let walkClickMark: number | null = null;
        /** Player tile when that walk was issued — CANT_REACH only counts if still here. */
        let walkClickAt: WorldTile | null = null;
        /** Server tick of last tile change (stall = no move for pathFollow.stallTicks). */
        let lastMoveTick = BotHost.tickCount;
        const follow = this.pathFollow;
        const approachR = follow.transportApproachChebyshev;

        const clickable = (t: WorldTile): boolean =>
            reader.toLocal(t.x, t.z) !== null && Reachability.canReach(t, { maxSteps: REACH_CHECK_STEPS });

        while (performance.now() < deadline) {
            if (EventSignal.pending()) {
                return 'interrupted';
            }
            if (this.forceRepathPending) {
                this.forceRepathPending = false;
                log('repath requested by script/API');
                return 'repath';
            }
            await Sustain.run();

            const me = reader.worldTile();
            if (!me) {
                return 'failed';
            }

            if (
                walkClickAt
                && (me.x !== walkClickAt.x || me.z !== walkClickAt.z || me.level !== walkClickAt.level)
            ) {
                walkClickMark = null;
                walkClickAt = null;
            }

            if (
                walkClickMark !== null
                && walkClickAt !== null
                && me.x === walkClickAt.x
                && me.z === walkClickAt.z
                && me.level === walkClickAt.level
                && GameMessages.sawSince(walkClickMark, CANT_REACH)
            ) {
                log(
                    `server "I can't reach that!" after walk click toward path idx ${clickIdx} — repathing immediately (${clicks} clicks)`
                );
                walkClickMark = null;
                walkClickAt = null;
                return 'repath';
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
            }

            // Deviation repath: farther than stickiness Chebyshev from published path.
            const pathDist = minChebyshevToPath(
                tiles,
                me,
                pathIdx,
                PROGRESS_WINDOW,
                progressLimit === -1 ? tiles.length - 1 : progressLimit
            );
            if (pathDist > follow.deviationChebyshev) {
                log(
                    `deviated from path at (${me.x},${me.z},${me.level}) dist=${pathDist} > ${follow.deviationChebyshev} — repathing (${clicks} clicks)`
                );
                return 'repath';
            }

            this.remaining = tiles.length - 1 - pathIdx;
            RouteState.setPathIdx(pathIdx);
            this.publishPath(tiles, pathIdx, clickIdx);
            this.maybeFacePathCamera(me, tiles, pathIdx);

            const moved = !lastTile || me.x !== lastTile.x || me.z !== lastTile.z || me.level !== lastTile.level;
            if (moved) {
                lastMoveTick = BotHost.tickCount;
            }
            lastTile = me;

            const idleTicks = BotHost.tickCount - lastMoveTick;

            // Next hop = first transport at or after pathIdx (pathIdx can sit ON the hop
            // tile after locateOnPath; scanning from pathIdx+1 would skip it forever).
            let nextCrossingIdx = -1;
            for (let i = Math.max(1, pathIdx); i < tiles.length; i++) {
                if (tiles[i]!.transport) {
                    nextCrossingIdx = i;
                    break;
                }
            }

            // Only the **next** planned hop — never scan nearby transports or pathIdx-5.
            // Engage at the approach tile when path progress has reached that hop.
            const approachable = (t: WorldTile): boolean =>
                Reachability.canReach(t, { maxSteps: TRIGGER_REACH_STEPS, adjacentOk: true });
            if (nextCrossingIdx !== -1 && pathIdx >= nextCrossingIdx - 1) {
                const appr = tiles[nextCrossingIdx - 1]!;
                const hop = tiles[nextCrossingIdx]!;
                if (hop.transport && crossingEligible(me, appr, hop, approachR, approachable)) {
                    const hopTransport = hop.transport;
                    const handled = await this.handleTransport(appr, hop, log);
                    if (handled) {
                        hop.transport = undefined;
                        if (multiLandingNeedsRepath(hopTransport, hop.level, reader.worldTile())) {
                            const live = reader.worldTile();
                            log(
                                `multi-landing hop arrived at (${live?.x},${live?.z}) not planned (${hopTransport.toTile!.x},${hopTransport.toTile!.z}) — repathing`
                            );
                            return 'repath';
                        }
                        // Landed on hop tile — snap index to the hop, not approach.
                        pathIdx = Math.max(pathIdx, nextCrossingIdx);
                        lastMoveTick = BotHost.tickCount;
                        stallRetries = 0;
                        clickIdx = -1;
                        lastTile = null;
                        continue;
                    }
                    this.noteDoorRefusal(hop, log);
                    return 'repath';
                }
            }

            // Unreachable walk-click: re-pick only. Do NOT run stall recovery early —
            // live smokes spammed "stall recovery (2 ticks idle)" when canReach failed
            // on the mid-path click long before the 9-tick stickiness stall.
            if (
                clickIdx !== -1
                && !moved
                && idleTicks >= UNREACH_CLICK_IDLE_TICKS
                && !Reachability.canReach(tiles[clickIdx]!, { maxSteps: STALL_REACH_STEPS })
            ) {
                log(
                    `walk click idx ${clickIdx} unreachable after ${idleTicks} idle ticks — re-picking`
                );
                clickIdx = -1;
                walkClickMark = null;
                walkClickAt = null;
                PathPublish.setClientSegment(null);
            }

            // Stall recovery / repath only after the stickiness idle budget (default 9).
            if (idleTicks >= follow.stallTicks) {
                const recoverLimit = nextCrossingIdx !== -1 ? nextCrossingIdx - 1 : tiles.length - 1;
                const recover =
                    stallRetries === 0
                        ? findForwardRecoveryIndex(tiles, me, pathIdx, clickable, {
                            corridor: CORRIDOR,
                            window: PROGRESS_WINDOW + 20,
                            limitIdx: recoverLimit
                        })
                        : -1;
                // No forward tile to click means we are already standing at the next
                // hop's approach — the door/stair case. Escalate in this same pass
                // rather than replanning the identical route until the walk fails.
                const phase = stallPhase({ stallRetries, recoverIdx: recover, inCombat: reader.inCombat() });
                if (phase === 'recover') {
                    const local = reader.toLocal(tiles[recover]!.x, tiles[recover]!.z);
                    if (local) {
                        log(
                            `stall recovery (${idleTicks} ticks idle, stall=${follow.stallTicks}) → path idx ${recover} (${tiles[recover]!.x},${tiles[recover]!.z})`
                        );
                        const mark = GameMessages.mark();
                        if (ActionRouter.driver.walk(local.lx, local.lz)) {
                            walkClickMark = mark;
                            walkClickAt = { x: me.x, z: me.z, level: me.level };
                            this.publishClientWalkSegment(me, tiles[recover]!);
                            clickIdx = recover;
                            clicks++;
                            stallRetries = 1;
                            // Give the recovery click a full stall window to produce movement.
                            lastMoveTick = BotHost.tickCount;
                            this.publishPath(tiles, pathIdx, clickIdx);
                            await Execution.delayTicks(2);
                            continue;
                        }
                        log('stall recovery walk rejected by client — repathing');
                        return 'repath';
                    }
                    // Recovery tile is off-scene — spend the retry and escalate next pass.
                    stallRetries = 1;
                } else if (phase === 'combat') {
                    if (!warnedCombat) {
                        warnedCombat = true;
                        log('under attack — holding course');
                    }
                    // Hold stall clock so combat idle does not immediately repath.
                    stallRetries = 0;
                    clickIdx = -1;
                    lastMoveTick = BotHost.tickCount;
                } else {
                    const end = tiles[tiles.length - 1]!;
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
                            lastMoveTick = BotHost.tickCount;
                            continue;
                        }
                    }
                    const hopDoors: { x: number; z: number }[] = [];
                    const hopHi = Math.min(tiles.length, pathIdx + PROGRESS_WINDOW);
                    for (let i = Math.max(0, pathIdx); i < hopHi; i++) {
                        const tr = tiles[i]!.transport;
                        if (tr && (tr.kind === 'door' || /(door|gate)/i.test(tr.locName ?? ''))) {
                            hopDoors.push({ x: tr.locX, z: tr.locZ });
                        }
                    }
                    if (
                        await tryNearbyDoor(log, {
                            tiles,
                            pathIdx,
                            window: PROGRESS_WINDOW,
                            hopDoors
                        })
                    ) {
                        stallRetries = 0;
                        clickIdx = -1;
                        lastTile = null;
                        lastMoveTick = BotHost.tickCount;
                        continue;
                    }
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
                    log(
                        `stuck at (${me.x},${me.z}) after ${idleTicks} idle ticks (stall=${follow.stallTicks}) — repathing (${clicks} clicks)`
                    );
                    return 'repath';
                }
            }

            const needClick = clickIdx === -1 || clickIdx <= pathIdx || chebyshev(me, tiles[clickIdx]!) <= ARRIVE_RADIUS;
            if (needClick) {
                const limit = nextCrossingIdx !== -1 ? nextCrossingIdx - 1 : tiles.length - 1;
                const steps = TARGET_STEPS + Math.floor(Math.random() * (2 * TARGET_JITTER + 1)) - TARGET_JITTER;
                const tryWalkAt = (i: number): boolean => {
                    const t = tiles[i]!;
                    if (t.x === me.x && t.z === me.z) {
                        return false;
                    }
                    const local = reader.toLocal(t.x, t.z);
                    if (!local) {
                        return false;
                    }
                    const mark = GameMessages.mark();
                    const ok = ActionRouter.driver.walk(local.lx, local.lz);
                    if (ok) {
                        walkClickMark = mark;
                        walkClickAt = { x: me.x, z: me.z, level: me.level };
                        this.publishClientWalkSegment(me, t);
                    }
                    return ok;
                };
                let chosen = selectClientWalkTarget(tiles, pathIdx, steps, limit, me.level, clickable, tryWalkAt);
                if (chosen === -1) {
                    const starve = starvedTerminalIndex(tiles, me, clickable);
                    if (
                        starve !== -1
                        && (nextCrossingIdx === -1 || pathIdx === tiles.length - 1 || clickIdx === tiles.length - 1)
                        && tryWalkAt(starve)
                    ) {
                        chosen = starve;
                    }
                }
                if (chosen !== -1) {
                    clickIdx = chosen;
                    clicks++;
                    // Do NOT reset lastMoveTick on click — only real tile movement
                    // (and hop landings / stall-recovery clicks) clear the stall clock.
                    // Resetting here + unreach re-picks starved the 9-tick stall and
                    // left walks thrashing until wall-clock "walk timed out".
                    this.publishPath(tiles, pathIdx, clickIdx);
                } else {
                    walkClickMark = null;
                    walkClickAt = null;
                    PathPublish.setClientSegment(null);
                    // Client pathfind failed: if the next planned hop's approach is nearby,
                    // execute that hop (doors/stairs/trees). Do not scan other transports.
                    // Slightly looser than normal approachR — walk tiles before a door often
                    // fail client tryMove while the approach stand is still a few tiles away.
                    if (nextCrossingIdx !== -1) {
                        const appr = tiles[nextCrossingIdx - 1]!;
                        const hop = tiles[nextCrossingIdx]!;
                        const nearApproach =
                            hop.transport
                            && me.level === appr.level
                            && chebyshev(me, appr) <= Math.max(approachR, ARRIVE_RADIUS);
                        if (nearApproach) {
                            const hopTransport = hop.transport!;
                            const handled = await this.handleTransport(appr, hop, log);
                            if (handled) {
                                hop.transport = undefined;
                                if (multiLandingNeedsRepath(hopTransport, hop.level, reader.worldTile())) {
                                    const live = reader.worldTile();
                                    log(
                                        `multi-landing hop arrived at (${live?.x},${live?.z}) not planned (${hopTransport.toTile!.x},${hopTransport.toTile!.z}) — repathing`
                                    );
                                    return 'repath';
                                }
                                pathIdx = Math.max(pathIdx, nextCrossingIdx);
                                lastMoveTick = BotHost.tickCount;
                                stallRetries = 0;
                                clickIdx = -1;
                                lastTile = null;
                                continue;
                            }
                            this.noteDoorRefusal(hop, log);
                            return 'repath';
                        }
                    }
                    log(
                        `client walk pathfind failed for all click candidates near path idx ${pathIdx} — repathing immediately (${clicks} clicks)`
                    );
                    return 'repath';
                }
            }

            await Execution.delayTicks(2);
        }

        log(
            `walk timed out (follow deadline, pathIdx=${pathIdx}, clicks=${clicks}, ` +
                `idle=${BotHost.tickCount - lastMoveTick}t, stall=${follow.stallTicks})`
        );
        return 'failed';
    }

    private async handleTransport(approach: PathStep, step: PathStep, log: (msg: string) => void): Promise<boolean> {
        const transport = step.transport!;

        if (transport.teleportId || transport.kind === 'teleport') {
            const ok = await executeTeleportHop(transport, log);
            if (ok) {
                RouteState.noteTransport(approach, step);
            } else if (transport.teleportId) {
                // Do not re-pick the same rejected tele on repath (#339).
                this.sessionSuppressedTeleports.add(transport.teleportId);
                log(`suppress teleport ${transport.teleportId} for this walk`);
            }
            return ok;
        }

        const special = specialCrossingForTransport(transport, approach, step);
        if (special) {
            const ok = await handleSpecialCrossing(approach, step, special, log, (d, o) => this.walkTo(d, o));
            if (ok) {
                RouteState.noteTransport(approach, step);
                // Server does not transmit exit_essence_mine_coord — remember return for plan filters.
                const ess = EssenceSession.noteEntryFromCrossingLabel(special.label)
                    ?? EssenceSession.noteEntryFromNpc(special.npc ?? special.locName);
                if (ess) {
                    log(`essence session return → ${ess} (entry via ${special.label ?? special.locName})`);
                }
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
                    // Already open / no shut Open-target: do not burn TRANSPORT_WAIT.
                    if (Reachability.canStep(approach, step) || Reachability.canReach(step, { maxSteps: 64, adjacentOk: true })) {
                        log(`${transport.locName} at (${transport.locX},${transport.locZ}) already open`);
                        RouteState.noteTransport(approach, step);
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
                // Catalog entry edges (Teleport wizard) when not routed through specialCrossing.
                if (/^teleport$/i.test(transport.action ?? '')) {
                    const ess = EssenceSession.noteEntryFromTransport(transport);
                    if (ess) {
                        log(`essence session return → ${ess} (entry transport ${transport.locName})`);
                    }
                }
                return true;
            }
            if (chatShowsQuestLock()) {
                log(`quest-locked '${transport.locName}' at (${transport.locX},${transport.locZ}) — blacklisting`);
                this.blacklistDoor(transport.locX, transport.locZ);
                await dismissQuestLockDialogue();
                return false;
            }
            if (cantReach()) {
                const here = reader.worldTile();
                const atApproach =
                    here !== null
                    && here.level === approach.level
                    && here.x === approach.x
                    && here.z === approach.z;
                if (!atApproach && attempt === 0) {
                    // The server ran its own path search and gave up from where we
                    // stand. The planned approach is the tile the pack says this hop
                    // works from, so stand on it and try once more — a stair fires
                    // from up to the trigger radius away and clicks from wherever it
                    // happens to be, which is how a staircase two tiles behind a wall
                    // reads as an unreachable destination.
                    log(
                        `server can't reach ${transport.locName} from (${here?.x},${here?.z}) — stepping onto the planned approach (${approach.x},${approach.z})`
                    );
                    DirectNavigator.walk(approach);
                    await Execution.delayUntil(() => {
                        const p = reader.worldTile();
                        return (
                            p !== null && p.x === approach.x && p.z === approach.z && p.level === approach.level
                        );
                    }, APPROACH_STEP_MS);
                    continue;
                }
                log(`server says can't reach ${transport.locName} at (${transport.locX},${transport.locZ}) — repathing`);
                return false;
            }
            log(`${transport.action} ${transport.locName} did not resolve, retrying`);
        }

        if (await this.runPostQuestTalk(transport, approach, log)) {
            // The conversation is the whole unlock; one more attempt settles it.
            const loc = findTransportLoc(transport);
            if (loc && (await loc.interact(transport.action))) {
                const toLevel = transport.toLevel;
                const before = reader.worldTile();
                const done = (): boolean =>
                    toLevel !== undefined
                        ? reader.worldTile()?.level === toLevel
                        : matchesTransportLanding(transport, step.level, before, reader.worldTile());
                if (await Execution.delayUntil(done, TRANSPORT_WAIT_MS)) {
                    log(`${transport.action} ${transport.locName} ok after the unlock talk`);
                    RouteState.noteTransport(approach, step);
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Some crossings open only after a conversation the journal cannot show —
     * the Salve barrier wants `%priestperil` one stage past complete. There is
     * nothing to test beforehand, so this runs only once the crossing has already
     * refused, and only once per placement per run.
     */
    private async runPostQuestTalk(
        transport: TransportInfo,
        approach: PathStep,
        log: (msg: string) => void
    ): Promise<boolean> {
        const talk: PostQuestTalk | null = postQuestTalkFor(transport.locX, transport.locZ, approach.level);
        if (!talk) {
            return false;
        }
        const key = `${talk.locX}|${talk.locZ}|${talk.level}`;
        if (this.sessionPostQuestTalks.has(key)) {
            return false;
        }
        if (Quests.status(talk.requireComplete) !== 'complete') {
            log(`${talk.label}: ${talk.requireComplete} is not complete — nothing to unlock`);
            return false;
        }
        this.sessionPostQuestTalks.add(key);

        log(`${talk.label}: crossing refused — talking to ${talk.npc} to unlock it`);
        if (!(await this.walkTo(talk.stand, { radius: 4, timeoutMs: 180_000, log: m => log(`  ${m}`) }))) {
            log(`${talk.label}: could not reach ${talk.npc} at (${talk.stand.x},${talk.stand.z})`);
            return false;
        }
        for (let round = 0; round < (talk.talks ?? 1); round++) {
            const npc = Npcs.query().name(talk.npc).nearest();
            if (!npc || !(await npc.interact('Talk-to'))) {
                log(`${talk.label}: '${talk.npc}' not talkable at the stand`);
                return false;
            }
            // The dialogue takes a tick to arrive. Breaking on the first closed
            // frame reads as "he said nothing" and the unlock silently no-ops.
            const dialogueUp = (): Promise<boolean> =>
                Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), TALK_OPEN_MS);
            if (!(await dialogueUp())) {
                log(`${talk.label}: ${talk.npc} said nothing`);
                return false;
            }
            for (let i = 0; i < POST_QUEST_TALK_STEPS; i++) {
                const pick = talk.choose ? pickChoice(ChatDialog.options(), talk.choose) : null;
                if (pick) {
                    await ChatDialog.chooseOption(pick);
                } else if (ChatDialog.canContinue()) {
                    await ChatDialog.continue();
                } else if (!ChatDialog.isOpen() && !(await dialogueUp())) {
                    break;
                } else {
                    await Execution.delayTicks(1);
                }
            }
        }
        log(`${talk.label}: talked — returning to the crossing`);
        return this.walkTo(approach, { radius: 2, timeoutMs: 180_000, log: m => log(`  ${m}`) });
    }

    /**
     * Open a closed door/gate next to the player (walkResilient unstick ladder).
     * Delegates to exec/doorCrossing — kept on the facade so Traversal callers
     * do not import the split module.
     */
    tryNearbyDoor(log: (msg: string) => void): Promise<boolean> {
        return tryNearbyDoor(log, null, this.sessionBlacklistDoors);
    }
}

export const WalkExecutor = new WalkExecutorImpl();
