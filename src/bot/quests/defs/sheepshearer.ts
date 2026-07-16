import { Execution } from '../../api/Execution.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { Npcs } from '../../api/queries/Npcs.js';
import { Reachability } from '../../api/Reachability.js';
import { Traversal } from '../../api/Traversal.js';
import Tile from '../../api/Tile.js';
import type { NpcStop } from '../exec/primitives.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { F2P } from '../data/f2p.js';

// Facts: fred_the_farmer.rs2 (start :10-23,:51-55; hand-in loop :68-89),
// shear_sheep.rs2 (use-Shears-on-Sheep, 20% escape), spinning.rs2:1-34
// (use-Wool-on-wheel = one ball), quest_sheep.rs2:1-7 (completion).
// Spawns: Fred m49_51 (0 53 9)->(3189,3273); Shears obj m49_51 (0 16 42)->(3152,3306);
// wheel m50_50 (1 9 12)->(3209,3212,1) — castle stairs already in stairEdges.json.
const FRED: NpcStop = {
    npc: 'Fred the Farmer', anchor: new Tile(3189, 3273, 0), leash: 6,
    prefer: ["I'm looking for a quest.", 'Yes okay. I can do that.']
};
const SHEARS_SPAWN = new Tile(3152, 3306, 0);
// INSIDE the flock (probe-verified live 2026-07-16: sheared from here; the
// researched (3188,3268) is OUTSIDE the pen's west fence — the flock lives at
// x 3193-3202, and use-through-fence is silently dropped server-side; the
// walker routes in via the curated north Gate (3197,3282) in doors.json).
const SHEEP_PEN = new Tile(3197, 3266, 0);
const WHEEL = new Tile(3209, 3212, 1);
const BALLS_NEEDED = 20;

/** One shearing attempt: use Shears on the nearest Sheep; the ~20% escape roll
 *  and "already shorn" both surface as no-wool-gained -> false -> retry. */
async function shearOne(log: (m: string) => void): Promise<boolean> {
    const before = Inventory.count('Wool');
    // Reachability-aware pick (the ArdyThiever precedent): a sheep seen THROUGH
    // the pen fence eats a silent 6s per attempt — the server drops the op.
    const sheep = Npcs.query().name('Sheep').within(8).where(n => Reachability.canReach(n.tile(), { adjacentOk: true })).nearest();
    if (!sheep) {
        await Traversal.walkResilient(SHEEP_PEN, { radius: 2, attempts: 2, timeoutMs: 60_000, log });
        return false;
    }
    const shears = Inventory.first('Shears');
    if (!shears || !(await shears.useOn(sheep))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.count('Wool') > before, 6000);
}

export function gatherBalls(snap: QuestSnapshot, need: number): QuestStep {
    const wool = snap.inv.get('wool') ?? 0;
    if (wool >= need) {
        // one ball per use (spinning.rs2:1-34); the engine re-calls until need is met
        return { kind: 'useOn', item: 'Wool', targetKind: 'loc', target: 'Spinning wheel', anchor: WHEEL, product: 'Ball of wool' };
    }
    if (!snap.inv.has('shears')) {
        return { kind: 'grabGround', item: 'Shears', anchor: SHEARS_SPAWN };
    }
    return { kind: 'custom', name: 'shear a sheep', run: shearOne };
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: FRED }; }
    if ((snap.inv.get('ball of wool') ?? 0) > 0) {
        return { kind: 'talk', stop: FRED }; // hand-in loop takes every ball held; partials persist server-side
    }
    // Mid-quest, empty-handed (partial hand-in then interruption): re-gather.
    // Worst case we over-gather (%sheep already counts handed balls) — surplus
    // wool/balls are cheap; convergence beats tracking an invisible varp.
    return gatherBalls(snap, BALLS_NEEDED);
}

export const sheepshearer: QuestModule = {
    record: F2P.find(r => r.id === 'sheep')!,
    gather: { 'ball of wool': gatherBalls },
    decide
};
