import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItem, GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import type Tile from '../../../../../geometry/Tile.js';
import { Traversal } from '../../../../walking/Traversal.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { settleScene } from '../../exec/prompts.js';
import { CB_ID, CB_LOC, CB_NAME, CB_NPC, CB_TILE } from './areas.js';
import { ARROW_TARGET, heldId } from './supplies.js';

const held = (id: number): number => Inventory.countById(id);

export async function walkTo(tile: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && here.level === tile.level && tile.distanceTo(here) <= radius) {
        return true;
    }
    return Traversal.walkResilient(tile, { radius, attempts: 3, timeoutMs: 180_000, log });
}

const groundBones = (): GroundItem | null => GroundItems.query().name(CB_NAME.WOLF_BONES).within(14).nearest();

async function takeBones(before: number): Promise<boolean> {
    const bones = groundBones();
    if (!bones) {
        return false;
    }
    if (!(await bones.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => held(CB_ID.WOLF_BONES) > before, 8000);
}

// Why: the achey trees stand in a loose grove, so the query is the search and the anchor is only where the walk starts.

/** One chop of the nearest achey tree. */
async function chopAchey(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(CB_TILE.ACHEY, 6, log))) {
        return false;
    }
    await settleScene();
    const tree = Locs.query().name(CB_LOC.ACHEY).action('Chop').within(12).nearest();
    if (!tree) {
        log('no Achey Tree offering Chop near the grove');
        return false;
    }
    const before = held(CB_ID.ACHEY_LOGS);
    if (!(await tree.interact('Chop'))) {
        return false;
    }
    return Execution.delayUntil(() => held(CB_ID.ACHEY_LOGS) > before, 40_000);
}

// Why: a wolf is not aggressive to a quest-ready account, so the fight has to be started rather than waited for.

/** Kill one wolf and pick its bones up. */
async function killWolfForBones(log: (m: string) => void): Promise<boolean> {
    const before = held(CB_ID.WOLF_BONES);
    if (await takeBones(before)) {
        return true;
    }
    if (!(await walkTo(CB_TILE.WOLVES, 6, log))) {
        return false;
    }
    await settleScene();
    const wolf = Npcs.query().name(CB_NPC.WOLF).action('Attack').within(14).nearest();
    if (!wolf) {
        log('no Wolf in reach of the Feldip pack');
        return false;
    }
    const index = wolf.index;
    if (!(await wolf.interact('Attack'))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => Game.inCombat(), 8000))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => !Npcs.all().some(n => n.index === index), 120_000))) {
        log('the wolf outlasted its fight window');
        return false;
    }
    await settleScene();
    if (!(await takeBones(before))) {
        log('the wolf left no bones in reach');
        return false;
    }
    return true;
}

const useOn = (item: string, target: string, product: string): QuestStep =>
    ({ kind: 'useOn', item, targetKind: 'item', target, anchor: CB_TILE.ACHEY, product });

// Why: every fletch action caps at six, so a target above six is two passes and the decide() loop is what repeats them.

/** Feathers this pack still has to spend to reach `ARROW_TARGET`. */
export function feathersNeeded(snap: QuestSnapshot): number {
    const outstanding = ARROW_TARGET - heldId(snap, CB_ID.ARROW) - heldId(snap, CB_ID.FLIGHTED);
    return Math.max(0, outstanding) * 4;
}

/** The next arrow-making move, or null once `ARROW_TARGET` ogre arrows are held. */
export function arrowStep(snap: QuestSnapshot): QuestStep | null {
    const arrows = heldId(snap, CB_ID.ARROW);
    const remaining = ARROW_TARGET - arrows;
    if (remaining <= 0) {
        return null;
    }
    const flighted = heldId(snap, CB_ID.FLIGHTED);
    const tips = heldId(snap, CB_ID.ARROWTIPS);
    const shafts = heldId(snap, CB_ID.SHAFT);
    const feathers = heldId(snap, CB_ID.FEATHER);
    const logs = heldId(snap, CB_ID.ACHEY_LOGS);
    const bones = heldId(snap, CB_ID.WOLF_BONES);

    if (flighted > 0 && tips > 0) {
        return useOn(CB_NAME.ARROWTIPS, CB_NAME.FLIGHTED, CB_NAME.ARROW);
    }
    if (flighted > 0) {
        return bones > 0
            ? useOn(CB_NAME.CHISEL, CB_NAME.WOLF_BONES, CB_NAME.ARROWTIPS)
            : { kind: 'custom', name: 'kill a wolf for bones', run: killWolfForBones };
    }
    // Why: flighting spends four feathers per shaft and caps at six arrows, so the shafts are banked up first — feathering three at a time wastes twelve of the twenty-five Fycie sells.
    const batch = Math.min(6, remaining);
    if (shafts < batch) {
        return logs > 0
            ? useOn(CB_NAME.KNIFE, CB_NAME.ACHEY_LOGS, CB_NAME.SHAFT)
            : { kind: 'custom', name: 'chop an achey tree', run: chopAchey };
    }
    if (feathers >= 4) {
        return useOn(CB_NAME.FEATHER, CB_NAME.SHAFT, CB_NAME.FLIGHTED);
    }
    // Why: decide() tops the feathers up before this runs, so reaching here means the shop leg is still outstanding.
    return { kind: 'wait', reason: 'no feathers to flight the ogre arrow shafts with' };
}
