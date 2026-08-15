import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { QUEST_ROCK_TYPES } from '../../../../../data/miningRocks.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import type Tile from '../../../../../geometry/Tile.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Navigator } from '../../../../../event/webwalk/Navigator.js';
import { isUnderground } from '../../exec/primitives.js';
import { settleScene } from '../../exec/prompts.js';
import { BLURITE_ROCKS, KS_ID, KS_TILE } from './areas.js';

const BLURITE_IDS = new Set(QUEST_ROCK_TYPES.Blurite);
const MINE_ATTEMPTS = 30;

/**
 * Walkable is not reachable: the rocks sit past the ice warriors in a cave whose
 * shape the crow does not describe, so the pick is an actual pathfind.
 */
async function nearestReachableRock(log: (m: string) => void): Promise<Tile | null> {
    const here = Game.tile();
    if (!here) {
        return null;
    }
    for (const rock of [...BLURITE_ROCKS].sort((a, b) => a.distanceTo(here) - b.distanceTo(here))) {
        if ((await Navigator.findPath(here, rock)).ok) {
            return rock;
        }
    }
    log('no blurite rock answered a path');
    return null;
}

async function run(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (!here || !isUnderground(here)) {
        if (!(await Traversal.walkResilient(KS_TILE.LADDER_BOTTOM, { radius: 4, attempts: 4, timeoutMs: 360_000, log }))) {
            log('could not get down into the Asgarnian Ice Dungeon');
            return false;
        }
        await settleScene();
    }
    const rock = await nearestReachableRock(log);
    if (!rock) {
        return false;
    }
    for (let i = 0; i < MINE_ATTEMPTS; i++) {
        // Sustain only runs where a step calls it, and this one fights for its life.
        await Sustain.run();
        if (Inventory.countById(KS_ID.BLURITE_ORE) > 0) {
            return true;
        }
        const target = Locs.query().where(l => BLURITE_IDS.has(l.id)).action('Mine').within(12).nearest();
        if (!target) {
            if (!(await Traversal.walkResilient(rock, { radius: 2, attempts: 2, timeoutMs: 180_000, log }))) {
                return false;
            }
            await settleScene();
            continue;
        }
        await target.interact('Mine');
        await Execution.delayUntil(() => Inventory.countById(KS_ID.BLURITE_ORE) > 0, 20_000);
    }
    log('never landed a blurite ore');
    return false;
}

// Why: auto-retaliate is the hazard here rather than the damage — an ice warrior landing a hit makes the bot swing back, and the swing cancels the mine.
// Why: nothing in this trip wants a reflex, as it is one ore and out.

/** Mine one blurite ore and leave. */
export async function mineBlurite(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(KS_ID.BLURITE_ORE) > 0) {
        return true;
    }
    Game.setAutoRetaliate(false);
    try {
        return await run(log);
    } finally {
        Game.setAutoRetaliate(true);
    }
}
