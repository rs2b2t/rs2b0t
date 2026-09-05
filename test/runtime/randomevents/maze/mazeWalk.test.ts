import { describe, expect, test } from 'bun:test';
import { walkTowards, type MazeWalkWorld } from '#/bot/runtime/randomevents/maze/mazeWalk.js';

const Z = 4560;
const TICK_MS = 600;

/** An east-west corridor walked a tile a tick. Nothing past `limit` is reachable, and `stuckAt` is a tile the walk never leaves. */
class Corridor implements MazeWalkWorld {
    goal: number | null = null;
    ticksRun = 0;
    clicks = 0;
    left = false;
    stuckAt: number | null = null;

    constructor(public x: number, private readonly limit = 2943) {}

    tile(): { x: number; z: number } {
        return { x: this.x, z: Z };
    }

    walkTo(d: { x: number; z: number }): void {
        this.clicks++;
        // The client's nearest fallback lands one tile short rather than refusing outright.
        this.goal = d.x <= this.limit ? d.x : d.x - 1 <= this.limit ? this.limit : null;
    }

    inMaze(): boolean {
        return !this.left;
    }

    async until(cond: () => boolean, ms: number): Promise<boolean> {
        for (let i = 0; i < Math.ceil(ms / TICK_MS); i++) {
            if (cond()) {
                return true;
            }
            this.step();
        }
        return cond();
    }

    async ticks(n: number): Promise<void> {
        for (let i = 0; i < n; i++) {
            this.step();
        }
    }

    private step(): void {
        this.ticksRun++;
        if (this.goal !== null && this.x !== this.goal && this.x !== this.stuckAt) {
            this.x += Math.sign(this.goal - this.x);
        }
    }
}

describe('walkTowards', () => {
    test('completes the 28-tile leg to the door the SE route sticks on', async () => {
        const w = new Corridor(2908);
        expect(await walkTowards(w, { x: 2936, z: Z }, false)).toBe(true);
        expect(w.x).toBe(2935);
    });

    test('a leg longer than the old 24-tile budget still arrives', async () => {
        const w = new Corridor(2900);
        expect(await walkTowards(w, { x: 2936, z: Z }, true)).toBe(true);
        expect(w.x).toBe(2936);
    });

    test('a door across the wall is reached from the near side', async () => {
        const w = new Corridor(2920, 2935);
        expect(await walkTowards(w, { x: 2936, z: Z }, false)).toBe(true);
        expect(w.x).toBe(2935);
    });

    test('a walled-off door is given up in seconds, not a minute', async () => {
        const w = new Corridor(2900, 2905);
        w.stuckAt = 2900;
        expect(await walkTowards(w, { x: 2936, z: Z }, false)).toBe(false);
        expect(w.x).toBe(2900);
        expect(w.clicks).toBeLessThanOrEqual(6);
        expect(w.ticksRun).toBeLessThan(20);
    });

    test('a walk that stalls partway gives up where it stopped', async () => {
        const w = new Corridor(2900);
        w.stuckAt = 2920;
        expect(await walkTowards(w, { x: 2936, z: Z }, false)).toBe(false);
        expect(w.x).toBe(2920);
    });

    test('already adjacent costs no click', async () => {
        const w = new Corridor(2935);
        expect(await walkTowards(w, { x: 2936, z: Z }, false)).toBe(true);
        expect(w.clicks).toBe(0);
    });

    test('stops once the player has left the maze', async () => {
        const w = new Corridor(2900);
        w.left = true;
        expect(await walkTowards(w, { x: 2936, z: Z }, false)).toBe(false);
        expect(w.clicks).toBe(0);
    });
});
