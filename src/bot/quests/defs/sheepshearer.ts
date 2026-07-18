import { Execution } from '../../api/Execution.js';
import { ChatDialog } from '../../api/hud/ChatDialog.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { Locs } from '../../api/queries/Locs.js';
import { Npcs } from '../../api/queries/Npcs.js';
import { Reachability } from '../../api/Reachability.js';
import { Traversal } from '../../api/Traversal.js';
import Tile from '../../api/Tile.js';
import type { NpcStop } from '../exec/primitives.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { QUESTS } from '../data/quests.js';

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
// Both variants display as 'Sheep'; only the UNSHEARED one (npc id 43,
// all.npc:1097-1123 — id 42 is the shorn swap, regrows via timer) yields wool.
// A name-only pick wastes a 6s no-wool attempt per shorn sheep (live report
// 2026-07-16), so filter by id.
const UNSHEARED_SHEEP_ID = 43;
// FALADOR's ground-floor wheel (2981,3314,0), NOT Lumbridge castle's: the
// castle wheel at (3209,3212,1) is dead SERVER-side — probe-verified 2026-07-16
// that both OPLOCU (use-wool-on) and OPLOC2 (Spin op) at exact+neighbor coords
// are silently dropped while a Candles loc two tiles away responds, so the
// server cannot resolve that loc instance. Falador's is level 0 and pathable
// from Lumbridge (cost ~315, pack-verified with full edge packs).
const WHEEL_STAND = new Tile(2982, 3315, 0);
const BALLS_NEEDED = 20;

/**
 * Spin the WHOLE wool batch at the wheel — the live-proven FlaxSpinner idiom
 * (Spin op -> make-X menu -> ride the weak-queue drain; touching anything
 * mid-batch cancels it). One successful call converts every held Wool.
 */
async function spinAllWool(log: (m: string) => void): Promise<boolean> {
    const ballsBefore = Inventory.count('Ball of wool');
    if (!ChatDialog.isMakeMenu()) {
        const wheel = Locs.query().name('Spinning wheel').action('Spin').within(8).nearest();
        if (!wheel) {
            await Traversal.walkResilient(WHEEL_STAND, { radius: 2, attempts: 3, timeoutMs: 300_000, log });
            return false;
        }
        if (!(await wheel.interact('Spin'))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => ChatDialog.isMakeMenu(), 8000))) {
            log('Spin menu never opened');
            return false;
        }
    }
    // The spin menu lists INGREDIENTS ("Wool"/"Flax"), not products — probe-
    // verified live at Falador, and FlaxSpinner's `product` help says the same.
    if (!(await ChatDialog.makeX('Wool', Inventory.count('Wool')))) {
        log(`Spin menu open but couldn't Make-X — products: [${ChatDialog.makeProducts().join(', ')}]`);
        return false;
    }
    // Ride the batch (~2 ticks/ball): done when wool stops draining.
    let last = Inventory.count('Wool');
    let idle = 0;
    while (Inventory.count('Wool') > 0 && idle < 10) {
        await Execution.delayTicks(2);
        const now = Inventory.count('Wool');
        if (now < last) { last = now; idle = 0; } else { idle++; }
    }
    return Inventory.count('Ball of wool') > ballsBefore;
}

/** One shearing attempt: use Shears on the nearest Sheep; the ~20% escape roll
 *  and "already shorn" both surface as no-wool-gained -> false -> retry. */
async function shearOne(log: (m: string) => void): Promise<boolean> {
    const before = Inventory.count('Wool');
    // Reachability-aware pick (the ArdyThiever precedent): a sheep seen THROUGH
    // the pen fence eats a silent 6s per attempt — the server drops the op.
    const sheep = Npcs.query().name('Sheep').within(8).where(n => n.id === UNSHEARED_SHEEP_ID && Reachability.canReach(n.tile(), { adjacentOk: true })).nearest();
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
        return { kind: 'custom', name: 'spin wool at Falador', run: spinAllWool };
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
    record: QUESTS.find(r => r.id === 'sheep')!,
    // shears = the gather tool; 'wool' also matches 'ball of wool' (record item)
    // so a mid-quest restart never banks half-gathered fleece
    tools: ['shears', 'wool'],
    gather: { 'ball of wool': gatherBalls },
    decide
};
