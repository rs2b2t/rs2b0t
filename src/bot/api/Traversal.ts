import type { WorldTile } from '../adapter/ClientAdapter.js';
import { reader } from '../adapter/ClientAdapter.js';
import { Navigator } from '../nav/Navigator.js';
import { DirectNavigator } from '../nav/DirectNavigator.js';
import { WalkExecutor, type WalkOptions } from '../nav/WalkExecutor.js';
import { advance, initialLadderState, judgeProbe, pickUnstickStep, type LadderState, type LastOutcome } from '../nav/walkLadder.js';
import { isArrived } from '../nav/arrival.js';
import { chebyshev } from '../nav/followMath.js';
import { Reachability } from './Reachability.js';
import { EventSignal } from './EventSignal.js';
import { Execution } from './Execution.js';
import { Sustain } from './Sustain.js';

export interface WalkResilientOptions {
    radius: number;
    attempts?: number;
    timeoutMs?: number;
    sceneRadius?: number;
    maxBudget?: number;
    log?: (msg: string) => void;
}

const SCENE_TIMEOUT_MS = 6000;
const DEFAULT_MAX_BUDGET = 1_200_000;
const PROGRESS_LOG_MS = 15_000;

export const Traversal = {
    walkTo(dest: WorldTile, opts?: WalkOptions): Promise<boolean> {
        return WalkExecutor.walkTo(dest, opts);
    },

    async walkResilient(dest: WorldTile, opts: WalkResilientOptions): Promise<boolean> {
        const log = opts.log ?? ((): void => {});
        const radius = opts.radius;
        const sceneRadius = opts.sceneRadius ?? radius + 1;
        const maxBudget = opts.maxBudget ?? DEFAULT_MAX_BUDGET;
        const bakedTimeout = opts.timeoutMs ?? 90000;
        const maxPasses = opts.attempts;

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
                log('walk interrupted by a random event — yielding to the runtime');
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
                log('walk interrupted by a random event — yielding to the runtime');
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
                await WalkExecutor.walkTo(dest, { radius, timeoutMs: bakedTimeout, log, ...(action.bigBudget ? { maxExpansions: maxBudget } : {}) });
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
