import { Execution } from '../../../../execution/Execution.js';
import type Tile from '../../../../../geometry/Tile.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { GEM_CUTS, LQ_ID, LQ_TILE } from './areas.js';
import { heldId, promptLoc, settleScene, useOnLoc } from './scene.js';

/** `gemrock`; the depleted stage reverts to the ordinary empty rocks. */
const GEM_ROCK_ID = 2111;

const MINE_MS = 240_000;

function uncutHeld(): number {
    return GEM_CUTS.reduce((sum, gem) => sum + heldId(gem.uncut), 0);
}

// Why: the rock rolls one of 7 gems, opal 60/128 down to diamond 4/128, so waiting for a named uncut gem times out on nearly every swing.
// Why: Any uncut gem confirms one mining attempt; `decide()` handles the remaining types.

/** Mine the Shilo gem rocks until one more uncut gem is in the pack. */
export async function mineGem(log: (m: string) => void): Promise<boolean> {
    const before = uncutHeld();
    if (!(await Traversal.walkResilient(LQ_TILE.GEM_ROCKS, { radius: 3, attempts: 3, timeoutMs: 240_000, log }))) {
        return false;
    }
    await settleScene();
    const deadline = performance.now() + MINE_MS;
    while (performance.now() < deadline) {
        if (uncutHeld() > before) {
            return true;
        }
        const rock = Locs.query().where(l => l.id === GEM_ROCK_ID).action('Mine').within(10).nearest();
        if (!rock) {
            // Every rock is depleted; they come back on a 200-tick respawn.
            await Execution.delayTicks(10);
            continue;
        }
        if (await rock.interact('Mine')) {
            await Execution.delayUntil(() => uncutHeld() > before, 20_000);
        }
        await Execution.delayTicks(1);
    }
    log('no gem in four minutes at the Shilo rocks');
    return false;
}

/** Smelt one gold ore into a bar at the East Ardougne furnace. */
export async function smeltGoldBar(log: (m: string) => void): Promise<boolean> {
    const before = heldId(LQ_ID.GOLD_BAR);
    if (heldId(LQ_ID.GOLD_ORE) === 0) {
        log('no gold ore to smelt');
        return false;
    }
    if (!(await Traversal.walkResilient(LQ_TILE.FURNACE, { radius: 3, attempts: 3, timeoutMs: 180_000, log }))) {
        return false;
    }
    await settleScene();
    // Why: the furnace's own Smelt op opens the bar-picker interface and waits, so the ore goes on the furnace and smelts where it lands.
    return useOnLoc(
        LQ_ID.GOLD_ORE,
        { name: 'Furnace', near: LQ_TILE.FURNACE, within: 10 },
        [],
        () => heldId(LQ_ID.GOLD_BAR) > before,
        log
    );
}

export interface JungleHerb {
    /** Every unid renders "Unidentified herb", so the pick is proved by id. */
    unidId: number;
    id: number;
    name: string;
    loc: string;
    stand: Tile;
}

export const BRAVERY_HERBS: readonly JungleHerb[] = [
    { unidId: LQ_ID.UNID_SNAKE_WEED, id: LQ_ID.SNAKE_WEED, name: 'Snake weed', loc: 'Marshy jungle vine', stand: LQ_TILE.SNAKE_WEED },
    { unidId: LQ_ID.UNID_ARDRIGAL, id: LQ_ID.ARDRIGAL, name: 'Ardrigal', loc: 'Palm tree', stand: LQ_TILE.ARDRIGAL }
];

/** Search a herb's own loc until the unid is in the pack. */
export function pickHerb(herb: JungleHerb): (log: (m: string) => void) => Promise<boolean> {
    return async log => {
        if (heldId(herb.id) > 0 || heldId(herb.unidId) > 0) {
            return true;
        }
        return promptLoc(
            {
                name: herb.loc,
                op: 'Search',
                near: herb.stand,
                expect: () => heldId(herb.unidId) > 0
            },
            log
        );
    };
}

export function identifyHerb(herb: JungleHerb): (log: (m: string) => void) => Promise<boolean> {
    return async log => {
        if (heldId(herb.id) > 0) {
            return true;
        }
        const unid = Inventory.items().find(item => item.id === herb.unidId);
        if (!unid) {
            log(`no unidentified ${herb.name} in the pack`);
            return false;
        }
        if (!(await unid.interact('Identify'))) {
            return false;
        }
        return Execution.delayUntil(() => heldId(herb.id) > 0, 6000);
    };
}
