import { Execution } from '../../api/execution/Execution.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Locs } from '../../api/locs/Locs.js';
import { Traversal } from '../../api/walking/Traversal.js';
import Tile from '../../geometry/Tile.js';

export const VIAL_FOUNTAIN = new Tile(2949, 3381, 0);

export async function fillSupplyVials(count: number, log: (message: string) => void): Promise<boolean> {
    if (count < 1 || count > 28) return false;
    if (!(await Traversal.walkResilient(VIAL_FOUNTAIN, { radius: 3, timeoutMs: 120000, log }))) return false;
    for (let i = 0; i < count; i++) {
        const fountain = Locs.query().name('Fountain').within(6).nearest();
        const vial = Inventory.items().find(item => item.id === 229 && !item.noted);
        if (!fountain || !vial) return false;
        const water = Inventory.countById(227);
        const empty = Inventory.countById(229);
        if (!(await vial.useOn(fountain))) return false;
        if (!(await Execution.delayUntil(() => Inventory.countById(227) > water && Inventory.countById(229) < empty, 4000))) return false;
        await Execution.delayTicks(1);
    }
    return true;
}
