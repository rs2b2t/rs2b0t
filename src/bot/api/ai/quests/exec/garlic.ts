// Why: the cupboard on Morgan's upper floor is the only garlic in the world — no shop stocks it and no map square spawns it — so every quest that needs a clove walks to this tile.
import { Execution } from '../../../execution/Execution.js';
import { Game } from '../../../game/Game.js';
import Tile from '../../../../geometry/Tile.js';
import { Inventory } from '../../../inventory/Inventory.js';
import { Locs } from '../../../locs/Locs.js';
import { Traversal } from '../../../walking/Traversal.js';

export const GARLIC = 'Garlic';

const MORGAN_STAIRS_BOTTOM = new Tile(3099, 3266, 0);
export const MORGAN_STAIRS_TOP = new Tile(3100, 3266, 1);
const GARLIC_CUPBOARD = new Tile(3096, 3268, 1);

const CUPBOARD_SHUT = 2612;
const CUPBOARD_OPEN = 2613;

async function climbMorganStairs(log: (message: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(MORGAN_STAIRS_BOTTOM, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
        return false;
    }
    const stairs = Locs.query().name('Staircase').action('Climb-up').within(6).nearest();
    if (!stairs || !(await stairs.interact('Climb-up'))) {
        log("Morgan's Staircase did not offer Climb-up");
        return false;
    }
    await Execution.delayUntil(() => Game.tile()?.level === 1, 8000);
    return false;
}

// Why: the cupboard restocks, so the leg is repeatable and a second clove costs another Search rather than a walk.

/** Take one clove from Morgan's cupboard. False until the clove is in the pack — the climb and the Open each cost a pass. */
export async function takeGarlic(log: (message: string) => void): Promise<boolean> {
    if (Inventory.contains(GARLIC)) {
        return true;
    }
    if (Game.tile()?.level !== 1) {
        return climbMorganStairs(log);
    }
    if (!(await Traversal.walkResilient(GARLIC_CUPBOARD, { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const shut = Locs.query().where(loc => loc.id === CUPBOARD_SHUT).action('Open').within(6).nearest();
    if (shut) {
        await shut.interact('Open');
        await Execution.delayTicks(2);
        return false;
    }
    const open = Locs.query().where(loc => loc.id === CUPBOARD_OPEN).action('Search').within(6).nearest();
    if (!open) {
        log("Morgan's garlic Cupboard is neither open nor searchable");
        return false;
    }
    const before = Inventory.count(GARLIC);
    if (!(await open.interact('Search'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.count(GARLIC) > before, 8000);
}
