import type { WorldTile } from '../../adapter/ClientAdapter.js';
import { reader } from '../../adapter/ClientAdapter.js';
import { Navigator } from '../../event/webwalk/Navigator.js';
import { DirectNavigator } from '../../event/webwalk/DirectNavigator.js';
import { WalkExecutor, type WalkOptions } from '../../event/webwalk/WalkExecutor.js';
import { advance, initialLadderState, judgeProbe, pickUnstickStep, type LadderState, type LastOutcome } from '../../event/webwalk/walkLadder.js';
import { isArrived } from '../../event/webwalk/geometry/arrival.js';
import { chebyshev } from '../../event/webwalk/geometry/followMath.js';
import { Reachability } from '../../event/webwalk/geometry/Reachability.js';
import { EventSignal } from '../execution/EventSignal.js';
import { Execution } from '../execution/Execution.js';
import { Sustain } from '../sustain/Sustain.js';
import { SettingsStore } from '../../runtime/Settings.js';

/**
 * Options for a walk behind the escalation ladder.
 * @see docs/reference/nav-walker.md#when-it-gets-stuck
 */
export interface WalkResilientOptions {
    radius: number;
    attempts?: number;
    timeoutMs?: number;
    sceneRadius?: number;
    maxBudget?: number;
    log?: (msg: string) => void;
    /** Forwarded to WalkExecutor on every baked repath. */
    useTeleportCatalog?: WalkOptions['useTeleportCatalog'];
    policy?: WalkOptions['policy'];
    bankItemCounts?: WalkOptions['bankItemCounts'];
    /**
     * Danger / no-go zones for every baked repath (same as WalkOptions.avoidZones), as known ids or ad-hoc rects.
     * Why: automatic catalog zones are resolved by WalkExecutor from live player state.
     */
    avoidZones?: WalkOptions['avoidZones'];
}

const SCENE_TIMEOUT_MS = 6000;
const DEFAULT_MAX_BUDGET = 1_200_000;
const PROGRESS_LOG_MS = 15_000;

/**
 * Force nav spell/jewellery tele inject **off** for one walk (overrides Global
 * `navTeleports`). Prefer the Global toggle (default off) for normal use.
 * @see docs/reference/nav-walker.md
 */
export const NAV_PURE_WALK = {
    useTeleportCatalog: false as const,
    policy: { useTeleports: false as const }
};

/**
 * Force nav tele inject **on** for one walk (overrides Global `navTeleports`).
 * Useful for ClueSolver / harnesses when the Global toggle stays off.
 */
export const NAV_WITH_TELES = {
    useTeleportCatalog: true as const,
    policy: { useTeleports: true as const }
};

/**
 * World-scale movement over the baked collision pack and the door/transport
 * graph.
 * @see docs/reference/api-movement.md
 * @see docs/NAV.md
 */
export const Traversal = {
    /** @see NAV_PURE_WALK */
    pureWalk: NAV_PURE_WALK,
    /** @see NAV_WITH_TELES */
    withTeles: NAV_WITH_TELES,

    /**
     * Whether ordinary walks may inject teleport edges — the Global `navTeleports` toggle every walk already consults.
     * Why: exposed because it is a provisioning question — A* only injects a hop the live inventory can pay for, so a script that wants the toggle to mean anything must put the runes in the pack before it walks.
     */
    teleportsEnabled(): boolean {
        try {
            return SettingsStore.globalBag().bool('navTeleports', false);
        } catch {
            return false;
        }
    },

    walkTo(dest: WorldTile, opts?: WalkOptions): Promise<boolean> {
        return WalkExecutor.walkTo(dest, opts);
    },

    /**
     * Force the active (or next) world walk to repath. Always honored —
     * does not wait for stall/deviation. See path stickiness on WalkExecutor.
     */
    requestRepath(reason?: string): void {
        WalkExecutor.requestRepath(reason);
    },

    async walkResilient(dest: WorldTile, opts: WalkResilientOptions): Promise<boolean> {
        const log = opts.log ?? ((): void => {});
        const radius = opts.radius;
        const sceneRadius = opts.sceneRadius ?? radius + 1;
        const maxBudget = opts.maxBudget ?? DEFAULT_MAX_BUDGET;
        const bakedTimeout = opts.timeoutMs ?? 90000;
        const maxPasses = opts.attempts;
        const avoidZones = opts.avoidZones;
        const useTeleportCatalog = opts.useTeleportCatalog;
        const policy = opts.policy;
        const bankItemCounts = opts.bankItemCounts;

        const dist = (): number => {
            const me = reader.worldTile();
            return me ? chebyshev(me, dest) : Number.POSITIVE_INFINITY;
        };
        const withinRadius = (): boolean => {
            const me = reader.worldTile();
            return me !== null && isArrived(me, dest, radius, Reachability.arrivalProbe());
        };

        let state: LadderState = initialLadderState(dist());
        let lastOutcome: LastOutcome = null;
        let unstickDir = 0;
        let lastProbeTerminal: WorldTile | null = null;
        let lastLoggedAt = performance.now();

        for (let iter = 0; iter < 100_000; iter++) {
            await Sustain.run();
            if (EventSignal.pending()) {
                log('walk interrupted by a runtime event — yielding to the runtime');
                WalkExecutor.lastOutcome = 'interrupted';
                return false;
            }

            const interrupted = lastOutcome === 'interrupted';
            const { action, state: next } = advance(state, { curDist: dist(), withinRadius: withinRadius(), interrupted, lastOutcome });
            state = next;

            if (action.kind === 'arrived') {
                return true;
            }
            if (action.kind === 'interrupted') {
                log('walk interrupted by a runtime event — yielding to the runtime');
                WalkExecutor.lastOutcome = 'interrupted';
                return false;
            }
            if (maxPasses !== undefined && state.noProgressPasses >= maxPasses) {
                log(`walkResilient: ${maxPasses} passes made no progress — stopping (bounded caller)`);
                WalkExecutor.lastOutcome = 'failed';
                return false;
            }

            if (performance.now() - lastLoggedAt > PROGRESS_LOG_MS) {
                lastLoggedAt = performance.now();
                log(`walkResilient: ${action.kind} toward (${dest.x},${dest.z}), best ${state.bestDist} tiles, pass ${state.noProgressPasses}`);
            }

            if (action.kind === 'baked') {
                await WalkExecutor.walkTo(dest, {
                    radius,
                    timeoutMs: bakedTimeout,
                    log,
                    ...(useTeleportCatalog !== undefined ? { useTeleportCatalog } : {}),
                    ...(policy ? { policy } : {}),
                    ...(bankItemCounts ? { bankItemCounts } : {}),
                    ...(avoidZones && avoidZones.length > 0 ? { avoidZones } : {}),
                    ...(action.bigBudget ? { maxExpansions: maxBudget } : {})
                });
                const outcome = WalkExecutor.lastOutcome;
                if (outcome === 'blocked') {
                    return true;
                }
                lastOutcome = outcome === 'unreachable' ? 'failed' : outcome;
            } else if (action.kind === 'scene') {
                await DirectNavigator.walkTo(dest, sceneRadius, SCENE_TIMEOUT_MS);
                lastOutcome = EventSignal.pending() ? 'interrupted' : 'failed';
            } else if (action.kind === 'unstick') {
                await WalkExecutor.tryNearbyDoor(log);
                const me = reader.worldTile();
                if (me) {
                    const step = pickUnstickStep((dx, dz) => Reachability.canStep(me, { x: me.x + dx, z: me.z + dz, level: me.level }), unstickDir);
                    unstickDir = (unstickDir + 3) % 8;
                    if (step) {
                        await DirectNavigator.walkTo({ x: me.x + step.dx, z: me.z + step.dz, level: me.level }, 0, 3000);
                    }
                }
                lastOutcome = 'failed';
            } else if (action.kind === 'backoff') {
                await Execution.delayTicks(action.ticks);
                lastOutcome = null;
            } else if (action.kind === 'verify') {
                const probe = await WalkExecutor.probeDest(dest, maxBudget);
                const outcome = judgeProbe(lastProbeTerminal, probe);
                if (probe.ok && probe.terminal) {
                    lastProbeTerminal = probe.terminal;
                }
                log(`walkResilient: verify probe ${outcome === 'probe-dead' ? 'dead' : `fresh (terminal ${probe.terminal!.x},${probe.terminal!.z})`}`);
                lastOutcome = outcome;
            } else if (action.kind === 'unreachable') {
                log(`walkResilient: (${dest.x},${dest.z},${dest.level}) unreachable from here — stopping (best ${state.bestDist} tiles)`);
                WalkExecutor.lastOutcome = 'unreachable';
                return false;
            }
        }
        log('walkResilient: iteration cap hit (no player tile?) — yielding');
        WalkExecutor.lastOutcome = 'failed';
        return false;
    },

    preload(): void {
        Navigator.start();
    },

    remaining(): number {
        return WalkExecutor.remaining;
    }
};

export type { WalkOptions };
