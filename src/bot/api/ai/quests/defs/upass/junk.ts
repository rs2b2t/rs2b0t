import { Execution } from '../../../../execution/Execution.js';
import { Inventory } from '../../../../inventory/Inventory.js';

/** Pie dishes and empty bowls are eat-scraps that fill the pack; drop them before they crowd out food or an arrow. */
const JUNK_NAMES = ['pie dish', 'bowl'];

export async function dropJunk(log: (m: string) => void): Promise<void> {
    for (const item of Inventory.items()) {
        if (item.name === null || !JUNK_NAMES.includes(item.name.toLowerCase())) {
            continue;
        }
        await item.interact('Drop');
        await Execution.delayTicks(1);
    }
    log(`dropped eat-scraps, ${Inventory.free()} free`);
}
