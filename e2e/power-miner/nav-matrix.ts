/**
 * Nav-cost check for the baked PowerMiner rock cycles.
 *
 * Loads the baked collision pack directly and replaces the Chebyshev edge cost
 * with the pathfinder cost, then brute-forces the best cycle per camp.
 *
 *   bun e2e/power-miner/nav-matrix.ts
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { PathFinder } from '../../src/bot/event/webwalk/PathFinder.js';

type P = { x: number; z: number; level: number };

const CAMP_ROCKS: Record<string, P[]> = {
    'Legends Guild Iron (east)': [
        { x: 2710, z: 3328, level: 0 },
        { x: 2711, z: 3329, level: 0 },
        { x: 2712, z: 3329, level: 0 },
        { x: 2713, z: 3332, level: 0 },
        { x: 2714, z: 3330, level: 0 },
        { x: 2715, z: 3331, level: 0 }
    ],
    'Legends Guild Iron (west)': [
        { x: 2691, z: 3329, level: 0 },
        { x: 2692, z: 3328, level: 0 },
        { x: 2693, z: 3329, level: 0 },
        { x: 2696, z: 3333, level: 0 },
        { x: 2697, z: 3334, level: 0 }
    ],
    'Rellekka Mine': [
        { x: 2722, z: 3695, level: 0 },
        { x: 2723, z: 3692, level: 0 },
        { x: 2723, z: 3695, level: 0 },
        { x: 2723, z: 3696, level: 0 },
        { x: 2724, z: 3688, level: 0 },
        { x: 2725, z: 3691, level: 0 },
        { x: 2725, z: 3694, level: 0 },
        { x: 2727, z: 3692, level: 0 },
        { x: 2728, z: 3695, level: 0 }
    ],
    'Wilderness Hobgoblin Mine': [
        { x: 3099, z: 3765, level: 0 },
        { x: 3099, z: 3766, level: 0 },
        { x: 3099, z: 3767, level: 0 },
        { x: 3099, z: 3768, level: 0 },
        { x: 3100, z: 3765, level: 0 },
        { x: 3100, z: 3766, level: 0 },
        { x: 3101, z: 3765, level: 0 },
        { x: 3101, z: 3768, level: 0 }
    ],
    'Fight Arena Mine': [
        { x: 2625, z: 3150, level: 0 },
        { x: 2625, z: 3151, level: 0 },
        { x: 2626, z: 3149, level: 0 },
        { x: 2626, z: 3150, level: 0 },
        { x: 2627, z: 3142, level: 0 },
        { x: 2628, z: 3140, level: 0 },
        { x: 2628, z: 3141, level: 0 }
    ],
    'Southeast Varrock Mine': [
        { x: 3285, z: 3368, level: 0 },
        { x: 3285, z: 3369, level: 0 },
        { x: 3286, z: 3369, level: 0 },
        { x: 3288, z: 3370, level: 0 }
    ]
};

const pack = gunzipSync(readFileSync('out/collision.lcnav.gz'));
const finder = new PathFinder(pack);
const policy = { useTeleports: false as const };

const costCache = new Map<string, number>();
function cost(a: P, b: P): number {
    const key = `${a.x},${a.z}>${b.x},${b.z}`;
    const cached = costCache.get(key);
    if (cached !== undefined) return cached;
    const result = finder.findPath(a, b, { useTeleportCatalog: false, policy });
    const value = result.ok ? result.cost : 999;
    costCache.set(key, value);
    return value;
}

function permutations<T>(items: T[]): T[][] {
    if (items.length <= 1) return [items];
    const out: T[][] = [];
    for (let i = 0; i < items.length; i++) {
        const rest = [...items.slice(0, i), ...items.slice(i + 1)];
        for (const tail of permutations(rest)) out.push([items[i]!, ...tail]);
    }
    return out;
}

for (const [name, rocks] of Object.entries(CAMP_ROCKS)) {
    console.log(`=== ${name} (${rocks.length} rocks)`);
    for (let n = Math.min(4, rocks.length); n <= Math.min(6, rocks.length); n++) {
        let best: { total: number; route: P[] } | null = null;
        // Fix the first rock to cut the permutation count in half.
        for (let first = 0; first < rocks.length; first++) {
            const rest = rocks.filter((_, i) => i !== first);
            for (const subset of combinations(rest, n - 1)) {
                for (const perm of permutations(subset)) {
                    const route = [rocks[first]!, ...perm];
                    let total = 0;
                    for (let i = 0; i < route.length; i++) total += cost(route[i]!, route[(i + 1) % route.length]!);
                    if (best === null || total < best.total) best = { total, route };
                }
            }
        }
        if (!best) continue;
        console.log(`  n=${n} navCost=${best.total} per=${(best.total / n).toFixed(2)}`);
        console.log(`    ${best.route.map(p => `${p.x},${p.z}`).join(' -> ')}`);
    }
}

function combinations<T>(items: T[], k: number): T[][] {
    if (k === 0) return [[]];
    if (items.length < k) return [];
    const [head, ...tail] = items;
    return [
        ...combinations(tail, k - 1).map(rest => [head!, ...rest]),
        ...combinations(tail, k)
    ];
}
