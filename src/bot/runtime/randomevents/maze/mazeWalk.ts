import { chebyshev } from '../../../event/webwalk/geometry/followMath.js';

/** The client and clock `walkTowards` drives, so the walk budget is testable without a browser. */
export interface MazeWalkWorld {
    tile(): { x: number; z: number } | null;
    walkTo(d: { x: number; z: number }): void;
    inMaze(): boolean;
    until(cond: () => boolean, ms: number): Promise<boolean>;
    ticks(n: number): Promise<void>;
}

// Why: a leg ends once the player is 2 tiles along, so capping legs caps walking distance; standing still, not distance, is what proves a door walled off.
const MAX_LEGS = 40;
const MAX_STILL_LEGS = 3;

/** Walk to `d`, or next to it when `onto` is false. True when the player got there. */
export async function walkTowards(w: MazeWalkWorld, d: { x: number; z: number }, onto: boolean): Promise<boolean> {
    const reached = (t: { x: number; z: number }): boolean => (onto ? t.x === d.x && t.z === d.z : chebyshev(t, d) <= 1);
    const at = (): boolean => {
        const t = w.tile();
        return t !== null && reached(t);
    };

    let still = 0;
    for (let leg = 0; leg < MAX_LEGS && w.inMaze(); leg++) {
        if (at()) {
            return true;
        }
        const before = w.tile();
        if (!before) {
            await w.ticks(1);
            continue;
        }
        const movedBy = (n: number): boolean => {
            const t = w.tile();
            return t !== null && chebyshev(t, before) >= n;
        };

        w.walkTo(d);
        if (!(await w.until(() => movedBy(1), 1_500))) {
            if (!w.inMaze()) {
                break;
            }
            w.walkTo(d);
            if (!(await w.until(() => movedBy(1), 1_500))) {
                still++;
                if (still >= MAX_STILL_LEGS) {
                    return at();
                }
                continue;
            }
        }
        still = 0;
        await w.until(() => at() || movedBy(2), 4_000);
    }
    return at();
}
