import { Execution } from '../../../execution/Execution.js';
import { Reachability } from '../../../../event/webwalk/geometry/Reachability.js';
import type Tile from '../../../../geometry/Tile.js';
import { Traversal } from '../../../walking/Traversal.js';
import { ChatDialog } from '../../../ui/dialogue/ChatDialog.js';
import { Inventory } from '../../../inventory/Inventory.js';
import { Locs } from '../../../locs/Locs.js';
import { Npcs } from '../../../npcs/Npcs.js';
import type { QuestSnapshot, QuestStep } from '../engine/types.js';

export const UNSHEARED_SHEEP_ID = 43;

export interface WoolSites {
    pen: Tile;
    wheelStand: Tile;
    shearsSpawn: Tile;
    spinLabel: string;
}

async function shearOne(pen: Tile, log: (m: string) => void): Promise<boolean> {
    const before = Inventory.count('Wool');
    const sheep = Npcs.query()
        .name('Sheep')
        .within(8)
        .where(n => n.id === UNSHEARED_SHEEP_ID && Reachability.canReach(n.tile(), { adjacentOk: true }))
        .nearest();
    if (!sheep) {
        await Traversal.walkResilient(pen, { radius: 2, attempts: 2, timeoutMs: 60_000, log });
        return false;
    }
    const shears = Inventory.first('Shears');
    log('shearing a sheep for its wool');
    if (!shears || !(await shears.useOn(sheep))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.count('Wool') > before, 6000);
}

/** @see docs/decisions/level-change-lag.md — a wheel on an upper floor reads empty for a tick. */
async function spinAllWool(wheelStand: Tile, log: (m: string) => void): Promise<boolean> {
    const ballsBefore = Inventory.count('Ball of wool');
    if (!ChatDialog.isMakeMenu()) {
        const wheel = Locs.query().name('Spinning wheel').action('Spin').within(8).nearest();
        if (!wheel) {
            await Traversal.walkResilient(wheelStand, { radius: 2, attempts: 3, timeoutMs: 300_000, log });
            await Execution.delayTicks(2);
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
        if (now < last) {
            last = now;
            idle = 0;
        } else {
            idle++;
        }
    }
    return Inventory.count('Ball of wool') > ballsBefore;
}

export function gatherWool(snap: QuestSnapshot, need: number, sites: WoolSites): QuestStep {
    if ((snap.inv.get('wool') ?? 0) >= need) {
        return { kind: 'custom', name: sites.spinLabel, run: log => spinAllWool(sites.wheelStand, log) };
    }
    if (!snap.inv.has('shears')) {
        return { kind: 'grabGround', item: 'Shears', anchor: sites.shearsSpawn };
    }
    return { kind: 'custom', name: 'shear a sheep', run: log => shearOne(sites.pen, log) };
}
