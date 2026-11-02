import Tile from '../../../../../geometry/Tile.js';
import { EventSignal } from '../../../../execution/EventSignal.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { executeStep } from '../../exec/steps.js';

const SHOP = { npc: 'Wydin', anchor: new Tile(3014, 3204, 0) };
const RESTOCK_TICKS = 100;
const SPAWNS = [new Tile(3267, 3371, 0), new Tile(3271, 3366, 0), new Tile(3278, 3374, 0)];

export async function acquireRedberries(log: (message: string) => void): Promise<boolean> {
    const before = Inventory.count('Redberries');
    if (before >= 3) return true;
    if (EventSignal.pending() || Inventory.isFull()) return false;
    const here = Game.tile();
    if (!here || here.level !== 0 || SPAWNS[0]!.distanceTo(here) > 24) {
        await executeStep({ kind: 'buy', item: 'Redberries', qty: 3 - before, shop: SHOP, estGp: 60 }, [], log);
        if (Inventory.count('Redberries') >= 3) return true;
        log(`Wydin supplied ${Inventory.count('Redberries') - before} redberries; gathering the remaining berries southeast of Varrock`);
    }
    for (let attempt = 0; attempt < 4; attempt++) {
        if (EventSignal.pending()) return false;
        if (Inventory.isFull()) break;
        const roundBefore = Inventory.count('Redberries');
        for (const anchor of SPAWNS) {
            if (EventSignal.pending()) return false;
            if (Inventory.isFull()) break;
            await Sustain.run();
            if (EventSignal.pending()) return false;
            await executeStep({ kind: 'grabGround', item: 'Redberries', anchor, waitIfMissing: true }, [], log);
            if (Inventory.count('Redberries') >= 3) return true;
        }
        if (attempt === 3 || Inventory.isFull()) break;
        if (Inventory.count('Redberries') > roundBefore) continue;
        log(`waiting for ground redberries to respawn (${Inventory.count('Redberries')}/3, wait ${attempt + 1}/3)`);
        for (let tick = 0; tick < RESTOCK_TICKS; tick++) {
            if (EventSignal.pending()) return false;
            await Sustain.run();
            if (EventSignal.pending()) return false;
            await Execution.delayTicks(1);
        }
    }
    log(`redberry acquisition stopped at ${Inventory.count('Redberries')}/3`);
    return Inventory.count('Redberries') > before;
}
