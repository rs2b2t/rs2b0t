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

const FRED: NpcStop = {
    npc: 'Fred the Farmer', anchor: new Tile(3189, 3273, 0), leash: 6,
    prefer: ["I'm looking for a quest.", 'Yes okay. I can do that.']
};
const SHEARS_SPAWN = new Tile(3152, 3306, 0);
const SHEEP_PEN = new Tile(3197, 3266, 0);
const UNSHEARED_SHEEP_ID = 43;
const WHEEL_STAND = new Tile(2982, 3315, 0);
const BALLS_NEEDED = 20;

async function spinAllWool(log: (m: string) => void): Promise<boolean> {
    const ballsBefore = Inventory.count('Ball of wool');
    if (!ChatDialog.isMakeMenu()) {
        const wheel = Locs.query().name('Spinning wheel').action('Spin').within(8).nearest();
        if (!wheel) {
            await Traversal.walkResilient(WHEEL_STAND, { radius: 2, attempts: 3, timeoutMs: 300_000, log });
            return false;
        }
        log('spinning wool into a ball at the spinning wheel');
        if (!(await wheel.interact('Spin'))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => ChatDialog.isMakeMenu(), 8000))) {
            log('Spin menu never opened');
            return false;
        }
    }
    if (!(await ChatDialog.makeX('Wool', Inventory.count('Wool')))) {
        log(`Spin menu open but couldn't Make-X — products: [${ChatDialog.makeProducts().join(', ')}]`);
        return false;
    }
    let last = Inventory.count('Wool');
    let idle = 0;
    while (Inventory.count('Wool') > 0 && idle < 10) {
        await Execution.delayTicks(2);
        const now = Inventory.count('Wool');
        if (now < last) { last = now; idle = 0; } else { idle++; }
    }
    return Inventory.count('Ball of wool') > ballsBefore;
}

async function shearOne(log: (m: string) => void): Promise<boolean> {
    const before = Inventory.count('Wool');
    const sheep = Npcs.query().name('Sheep').within(8).where(n => n.id === UNSHEARED_SHEEP_ID && Reachability.canReach(n.tile(), { adjacentOk: true })).nearest();
    if (!sheep) {
        await Traversal.walkResilient(SHEEP_PEN, { radius: 2, attempts: 2, timeoutMs: 60_000, log });
        return false;
    }
    const shears = Inventory.first('Shears');
    log('shearing a sheep for its wool');
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
        return { kind: 'talk', stop: FRED };
    }
    return gatherBalls(snap, BALLS_NEEDED);
}

export const sheepshearer: QuestModule = {
    record: QUESTS.find(r => r.id === 'sheep')!,
    bank: new Tile(3093, 3243, 0),
    tools: ['shears', 'wool'],
    gather: { 'ball of wool': gatherBalls },
    decide
};
