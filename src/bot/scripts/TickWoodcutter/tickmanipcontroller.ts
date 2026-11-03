import type { Observation, Tree } from './types.js';

const FLETCH_ANIM = 1248;
const isAxeAnim = (seq: number): boolean => seq >= 867 && seq <= 879;

/** Services the controller needs; it knows nothing about bank, shop or paint. */
export interface TickManipHost {
    woodcuttingXp(): number;
    nowMs(): number;
    findTree(current: Tree | null): Tree | null;
    inReach(tree: Tree): boolean;
    clickTree(tree: Tree): void;
    walkToTree(tree: Tree): Promise<unknown>;
    dropExtra(): void;
    sendBatch(tree: Tree, tick: number): boolean;
    log(message: string): void;
    setStatus(message: string): void;
}

type Flight = { sent: number; at: number; xp: number; acked: boolean };

/**
 * Reference 3-tick woodcutting state machine: target retention, approach,
 * one batch in flight, animation/XP ack, miss policy, frame-gap resync.
 */
export class TickManipController {
    private tree: Tree | null = null;
    private treeKey = '';
    private initialized = false;
    private approachTick = -100;
    private flight: Flight | null = null;
    private nextBatch = -1;
    private misses = 0;
    private missStreak = 0;
    private recoveryUntil = 0;
    private quietUntil = 0;
    private seen = -1;
    private walking = false;
    private batches = 0;
    private fletches = 0;
    private batchGaps: number[] = [];
    private lastBatchTick = -1;

    constructor(private readonly host: TickManipHost) {}

    tick(obs: Observation | null): void {
        if (!obs) {
            return;
        }
        const tick = obs.tick;
        const now = obs.at;
        if (tick === this.seen) {
            return;
        }
        const skipped = this.seen >= 0 && tick - this.seen > 1;
        this.seen = tick;
        if (skipped || obs.gapMs < 200 || obs.gapMs > 1200 || this.host.nowMs() - obs.at > 250) {
            this.resetCycle(tick);
            return;
        }

        const target = this.host.findTree(this.tree);
        if (!target) {
            this.tree = null;
            this.treeKey = '';
            this.initialized = false;
            return;
        }
        const key = `${target.id}:${target.tile().x}:${target.tile().z}`;
        if (key !== this.treeKey) {
            this.treeKey = key;
            this.initialized = false;
            this.approachTick = -100;
            this.resetCycle(tick);
            this.host.log(`target changed -> ${key}`);
        }
        this.tree = target;
        const working = isAxeAnim(obs.anim);
        const inReach = this.host.inReach(target);

        if (!this.initialized || (!inReach && !working && !this.flight)) {
            if (inReach) {
                this.initialized = true;
                this.nextBatch = Math.max(this.nextBatch, tick + 1);
            } else {
                if (tick - this.approachTick >= 8 && !this.walking) {
                    this.approachTick = tick;
                    this.walking = true;
                    void this.host.walkToTree(target).finally(() => {
                        this.walking = false;
                        this.host.clickTree(target);
                    });
                }
                if (working || inReach) {
                    this.initialized = true;
                    this.nextBatch = Math.max(this.nextBatch, tick + 1);
                }
                return;
            }
        }

        if (tick < this.recoveryUntil) {
            if (!working && tick - this.approachTick >= 8) {
                this.approachTick = tick;
                this.host.clickTree(target);
            }
            return;
        }

        if (this.flight) {
            if (!this.flight.acked) {
                if (this.host.woodcuttingXp() > this.flight.xp) {
                    this.flight.acked = true;
                } else if (obs.anim === FLETCH_ANIM || isAxeAnim(obs.anim)) {
                    this.flight.acked = true;
                }
            }
            if (tick >= this.flight.sent + 3 && this.flight.acked) {
                this.flight = null;
                this.nextBatch = tick;
            } else if (tick - this.flight.sent >= 4 && now - this.flight.at > 1800) {
                this.misses++;
                this.missStreak++;
                this.flight = null;
                this.recoveryUntil = tick + (this.missStreak >= 3 ? 100 : 12);
                this.quietUntil = now + 1800;
                if (this.missStreak >= 3) {
                    this.missStreak = 0;
                    this.host.log('timing recovery: normal chopping for 60s');
                }
                if (!working && tick - this.approachTick >= 8) {
                    this.approachTick = tick;
                    this.host.clickTree(target);
                }
                return;
            } else {
                return;
            }
        }

        if (tick >= this.nextBatch && now >= this.quietUntil) {
            this.batch(target, tick);
        }
    }

    /** Reference reset: defer the next batch past the in-flight one and quiet the cycle. */
    private resetCycle(tick: number): void {
        if (this.flight) {
            this.quietUntil = Math.max(this.quietUntil, this.flight.at + 1800);
            this.nextBatch = Math.max(this.nextBatch, this.flight.sent + 4);
        }
        this.nextBatch = Math.max(this.nextBatch, tick + 1);
        this.flight = null;
    }

    /** Flight ack from the same PLAYER_INFO snapshot the controller consumes. */
    ackFromTick(obs: Observation): void {
        if (obs.anim === FLETCH_ANIM) {
            this.fletches++;
        }
        if (this.flight && !this.flight.acked && (obs.anim === FLETCH_ANIM || isAxeAnim(obs.anim))) {
            this.flight.acked = true;
        }
    }

    private batch(tree: Tree, tick: number): void {
        this.host.dropExtra();
        if (!this.host.sendBatch(tree, tick)) {
            this.nextBatch = tick + 1;
            return;
        }
        if (this.lastBatchTick >= 0) {
            this.batchGaps.push(tick - this.lastBatchTick);
        }
        this.lastBatchTick = tick;
        this.batches++;
        this.flight = { sent: tick, at: this.host.nowMs(), xp: this.host.woodcuttingXp(), acked: false };
        this.host.setStatus(`3-tick batch @${tick}`);
    }

    debug(): Record<string, unknown> {
        return {
            batches: this.batches,
            fletches: this.fletches,
            gaps: [...this.batchGaps].slice(-10),
            misses: this.misses,
            initialized: this.initialized,
            nextBatch: this.nextBatch,
            treeKey: this.treeKey,
            flight: this.flight ? this.flight.sent : null,
            recoveryUntil: this.recoveryUntil,
            working: false
        };
    }
}
