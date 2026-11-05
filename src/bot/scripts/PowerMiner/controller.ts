import { tileKey } from './rocks.js';
import type { ControllerDebug, IronRock, Observation, PowerMineHost } from './types.js';

/** Max user events the server reads per player per tick. */
const EVENT_BUDGET = 5;
/** No fresh swing this many ticks after a click: re-click. */
const MISS_TICKS = 8;

/** Why: the client swing animation precedes the server roll by a tick, so clicking on that edge transfers the roll. */
export class PowerMineController {
    private current: IronRock | null = null;
    private currentKey = '';
    private lastTick = -1;
    private prevAnim = -1;

    private state: 'idle' | 'sent' | 'armed' = 'idle';
    private sentTick = -1;
    private rollDue = -1;
    /** Ticks after the fresh swing animation to send the next click. */
    rollOffset = 0;
    /** Only drop once this many ores are in the inventory (1 = every cycle). */
    dropEvery = 1;

    private sequenceIndex = -1;
    private campRocks: { x: number; z: number }[] = [];
    private userRoute: readonly { x: number; z: number }[] | null = null;

    private standTile: { x: number; z: number } | null = null;
    private liveKeys: Set<string> | null = null;
    private readonly depletedAt = new Map<string, number>();
    private readonly respawns: number[] = [];
    /** Rock that just yielded an ore: the server has depleted it even if the client scene lags. */
    private exhaustedKey = '';
    private exhaustedUntil = -1;
    private prevOreCount = 0;

    private triggers = 0;
    private clicks = 0;
    private drops = 0;
    private waits = 0;

    constructor(private readonly host: PowerMineHost) {}

    setRoute(route: readonly { x: number; z: number }[] | null): void {
        this.userRoute = route;
        this.campRocks = route ? [...route] : [];
        this.sequenceIndex = -1;
    }

    tick(obs: Observation): void {
        if (obs.tick === this.lastTick) {
            return;
        }
        this.lastTick = obs.tick;
        this.trackRespawn(obs);
        this.deriveCycle(obs);

        // Why: an ore means the server depleted the rock before the local scene updated.
        const gainedOre = obs.oreSlots.length > this.prevOreCount;
        this.prevOreCount = obs.oreSlots.length;
        if (gainedOre && this.currentKey) {
            this.exhaustedKey = this.currentKey;
            this.exhaustedUntil = obs.tick + 2;
        }

        const fresh = this.prevAnim === -1 && obs.anim !== -1;
        this.prevAnim = obs.anim;

        if (obs.gapMs < 200 || obs.gapMs > 1200 || this.host.nowMs() - obs.at > 250) {
            this.state = 'idle';
            return;
        }

        if (this.state === 'idle') {
            this.sendBatch(obs);
            return;
        }

        if (this.state === 'sent') {
            if (fresh) {
                this.state = 'armed';
                this.rollDue = obs.tick + this.rollOffset;
                return;
            }
            if (obs.tick - this.sentTick >= MISS_TICKS) {
                this.state = 'idle';
            }
            return;
        }

        // armed
        if (obs.tick >= this.rollDue) {
            this.sendBatch(obs);
        }
    }

    /** Why: the previous roll is spent on the edge, so drops are free and the click re-arms last. */
    private sendBatch(obs: Observation): void {
        const next = this.pickSequenced(obs);
        const drops = obs.oreSlots.length >= this.dropEvery
            ? obs.dropSlots.slice(0, EVENT_BUDGET - 1)
            : [];
        const sent = this.host.send(drops, next);
        this.drops += drops.length;
        if (next) {
            this.current = next;
            this.currentKey = tileKey(next.tile);
            this.state = 'sent';
            this.sentTick = sent;
            this.clicks++;
            this.triggers++;
            this.host.setStatus(`mine ${this.currentKey} @anim+${this.rollOffset}`);
        } else {
            this.current = null;
            this.waits++;
            this.state = 'idle';
            this.host.setStatus('waiting for iron');
        }
    }

    /** Build the fallback cycle from the live scene when the user has no route. */
    private deriveCycle(obs: Observation): void {
        if (this.userRoute !== null || this.campRocks.length > 0 || this.standTile === null || obs.live.length < 3) {
            return;
        }
        const stand = this.standTile;
        const distance = (p: { x: number; z: number }): number => Math.max(Math.abs(p.x - stand.x), Math.abs(p.z - stand.z));
        this.campRocks = obs.live
            .map(rock => ({ x: rock.tile.x, z: rock.tile.z }))
            .sort((a, b) => distance(a) - distance(b))
            .slice(0, 6);
    }

    private pickFrom(
        order: { x: number; z: number }[],
        index: number,
        live: Map<string, IronRock>
    ): { rock: IronRock; index: number } | null {
        for (let step = 1; step <= order.length; step++) {
            const next = (index + step) % order.length;
            const entry = order[next]!;
            const rock = live.get(`${entry.x},${entry.z}`);
            if (rock) {
                return { rock, index: next };
            }
        }
        return null;
    }

    /** Pick the next live rock from the user's route (or the distance-sorted fallback). */
    private pickSequenced(obs: Observation): IronRock | null {
        if (this.campRocks.length === 0) {
            return null;
        }
        const stand = this.standTile;
        const live = new Map(obs.live.map(rock => [tileKey(rock.tile), rock]));
        if (this.exhaustedKey && obs.tick <= this.exhaustedUntil) {
            live.delete(this.exhaustedKey);
        }
        const subset = this.userRoute === null && stand
            ? [...this.campRocks].sort((a, b) =>
                Math.atan2(a.z - stand.z, a.x - stand.x) - Math.atan2(b.z - stand.z, b.x - stand.x))
            : this.campRocks;
        const pick = this.pickFrom(subset, this.sequenceIndex, live);
        if (pick) {
            this.sequenceIndex = pick.index;
            return pick.rock;
        }
        const fallback = this.pickFrom(this.campRocks, -1, live);
        if (fallback) {
            return fallback.rock;
        }
        return null;
    }

    private trackRespawn(obs: Observation): void {
        const now = new Set(obs.live.map(rock => tileKey(rock.tile)));
        if (this.standTile === null && obs.tile !== null) {
            this.standTile = { x: obs.tile.x, z: obs.tile.z };
        }
        if (this.liveKeys === null) {
            this.liveKeys = now;
            return;
        }
        for (const key of now) {
            const at = this.depletedAt.get(key);
            if (at !== undefined) {
                const elapsed = obs.tick - at;
                if (elapsed > 0 && elapsed < 100) {
                    this.respawns.push(elapsed);
                    if (this.respawns.length > 40) {
                        this.respawns.shift();
                    }
                }
                this.depletedAt.delete(key);
            }
        }
        for (const key of this.liveKeys) {
            if (!now.has(key) && !this.depletedAt.has(key)) {
                this.depletedAt.set(key, obs.tick);
            }
        }
        this.liveKeys = now;
    }

    private medianRespawn(): number | null {
        if (this.respawns.length < 3) {
            return null;
        }
        const sorted = [...this.respawns].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)] ?? null;
    }

    debug(): ControllerDebug {
        return {
            current: this.currentKey || null,
            clicks: this.clicks,
            drops: this.drops,
            waits: this.waits,
            recoveries: 0,
            triggers: this.triggers,
            medianRespawn: this.medianRespawn(),
            ringCapacity: this.campRocks.length,
            misses: 0,
            cadence: this.rollOffset
        };
    }
}
