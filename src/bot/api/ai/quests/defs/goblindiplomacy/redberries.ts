import Tile from '../../../../../geometry/Tile.js';
import { EventSignal } from '../../../../execution/EventSignal.js';
import { Execution } from '../../../../execution/Execution.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { executeStep } from '../../exec/steps.js';

const SHOP = { npc: 'Wydin', anchor: new Tile(3014, 3204, 0) };
const RESTOCK_TICKS = 100;

export async function acquireRedberries(log: (message: string) => void): Promise<boolean> {
    const before = Inventory.count('Redberries');
    if (before >= 3) return true;
    for (let attempt = 0; attempt < 4; attempt++) {
        if (EventSignal.pending()) return false;
        if (Inventory.isFull()) break;
        await executeStep({ kind: 'buy', item: 'Redberries', qty: 3 - Inventory.count('Redberries'), shop: SHOP, estGp: 60 }, [], log);
        if (Inventory.count('Redberries') >= 3) return true;
        if (attempt === 3 || Inventory.isFull()) break;
        log(`waiting for Wydin to restock redberries (${Inventory.count('Redberries')}/3, wait ${attempt + 1}/3)`);
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
