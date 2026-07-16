import { Execution } from '../../api/Execution.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { Locs } from '../../api/queries/Locs.js';
import { Traversal } from '../../api/Traversal.js';
import Tile from '../../api/Tile.js';
import type { NpcStop } from '../exec/primitives.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { F2P } from '../data/f2p.js';

// Facts: quest_cook.rs2 (start :2,29,32; all-three hand-in gate :45,:81-84),
// windmills.rs2 (fill :77-94, operate :96-118, bin :58-75). Tiles: egg/bucket/
// cow/wheat verbatim from the retired scripts/CooksAssistant.ts (live-proven);
// mill (3166,3307) — the (3165,3307) 0<->1<->2 ladders are already in
// stairEdges.json, so plain walkResilient handles the climb.
const COOK: NpcStop = { npc: 'Cook', anchor: new Tile(3209, 3215, 0), leash: 6, prefer: ["What's wrong?", "Yes, I'll help you."] };
const EGG_PEN = new Tile(3227, 3300, 0);
const FARMHOUSE_BUCKET = new Tile(3225, 3294, 0);
const COW_FIELD = new Tile(3255, 3288, 0);
const WHEAT_FIELD = new Tile(3158, 3300, 0);
const POT_SPAWN = new Tile(3208, 3213, 0);    // castle kitchen table — LIVE-VERIFY
const MILL_TOP = new Tile(3166, 3306, 2);     // hopper floor (level 2) — LIVE-VERIFY exact stand
const MILL_BASE = new Tile(3166, 3306, 0);    // flour bin floor — LIVE-VERIFY exact stand

/** Fill (use Grain on Hopper) -> Operate controls -> Empty bin with the Pot.
 *  Flour state is per-player varps (hopper.varp) so the full cycle always
 *  runs; each leg re-checks live state, so an interrupted pass resumes. */
async function millFlour(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(MILL_TOP, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    const grain = Inventory.first('Grain');
    const hopper = Locs.query().name('Hopper').within(4).nearest();
    if (grain && hopper) {
        await grain.useOn(hopper);           // "You put the grain in the hopper." (windmills.rs2:85)
        await Execution.delayTicks(2);
    }
    const controls = Locs.query().name('Hopper controls').action('Operate').within(4).nearest();
    if (!controls) {
        log('no Hopper controls on the top floor');
        return false;
    }
    await controls.interact('Operate');       // "The grain slides down the chute." (windmills.rs2:113)
    await Execution.delayTicks(2);
    if (!(await Traversal.walkResilient(MILL_BASE, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    const bin = Locs.query().name('Flour bin').within(4).nearest();
    if (!bin || !(await bin.interact('Empty'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.contains('Pot of flour'), 8000);
}

export function gatherFlour(snap: QuestSnapshot): QuestStep {
    if (!snap.inv.has('pot')) {
        return { kind: 'grabGround', item: 'Pot', anchor: POT_SPAWN };
    }
    if (!snap.inv.has('grain')) {
        return { kind: 'pickLoc', loc: 'Wheat', op: 'Pick', item: 'Grain', anchor: WHEAT_FIELD };
    }
    return { kind: 'custom', name: 'mill flour', run: millFlour };
}

export function gatherMilk(snap: QuestSnapshot): QuestStep {
    if (!snap.inv.has('bucket')) {
        return { kind: 'grabGround', item: 'Bucket', anchor: FARMHOUSE_BUCKET };
    }
    return { kind: 'useOn', item: 'Bucket', targetKind: 'npc', target: 'Cow', anchor: COW_FIELD, product: 'Bucket of milk' };
}

const gatherEgg = (): QuestStep => ({ kind: 'grabGround', item: 'Egg', anchor: EGG_PEN });

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: COOK }; }
    // Hand-in needs ALL THREE at once (quest_cook.rs2:45) — self-heal any gap
    // (item lost after provisioning) instead of nagging the Cook.
    if (!snap.inv.has('egg')) { return gatherEgg(); }
    if (!snap.inv.has('bucket of milk')) { return gatherMilk(snap); }
    if (!snap.inv.has('pot of flour')) { return gatherFlour(snap); }
    return { kind: 'talk', stop: COOK };
}

export const cooksassistant: QuestModule = {
    record: F2P.find(r => r.id === 'cook')!,
    gather: {
        'egg': gatherEgg,
        'bucket of milk': gatherMilk,
        'pot of flour': gatherFlour
    },
    decide
};
