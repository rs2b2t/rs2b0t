import { Execution } from '../../../../execution/Execution.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Reach } from '../../../../walking/Reach.js';
import type Tile from '../../../../../geometry/Tile.js';
import { talkStrict } from '../../exec/primitives.js';
import { driveUntil, heldId, settleScene } from '../../exec/prompts.js';
import { PC_ITEM, PC_LOC, PC_NPC, PC_TILE, type PlagueItem } from './areas.js';
import { locById, walkTo } from './travel.js';

const START_PREFER = ["What's happened to her?", 'Can I help find her?'];

/** How many pours the garden takes from a standing start. */
const POURS = 4;

export async function talkAt(
    npc: string,
    near: Tile,
    prefer: string[],
    log: (m: string) => void,
    radius = 2
): Promise<boolean> {
    if (!(await walkTo(near, radius, log))) {
        return false;
    }
    await settleScene();
    if ((await Reach.npcDialog({ name: npc, near, log })) !== 'done') {
        log(`no dialogue with ${npc} near (${near.x},${near.z})`);
        return false;
    }
    return talkStrict(npc, prefer, log);
}

export const startQuest = (log: (m: string) => void): Promise<boolean> =>
    talkAt(PC_NPC.EDMOND, PC_TILE.EDMOND, START_PREFER, log);

export const giveDwellberries = (log: (m: string) => void): Promise<boolean> =>
    talkAt(PC_NPC.ALRENA, PC_TILE.ALRENA, [], log);

export const askAboutDigging = (log: (m: string) => void): Promise<boolean> =>
    talkAt(PC_NPC.EDMOND, PC_TILE.EDMOND, [], log);

export const pullTheGrill = (log: (m: string) => void): Promise<boolean> =>
    talkAt(PC_NPC.EDMOND, PC_TILE.SEWER_EDMOND, [], log);

export const thankEdmond = (log: (m: string) => void): Promise<boolean> =>
    talkAt(PC_NPC.EDMOND, PC_TILE.EDMOND, ['No problem.'], log);

export async function fillBuckets(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(PC_TILE.FOUNTAIN, 2, log))) {
        return false;
    }
    await settleScene();
    let filled = 0;
    while (heldId(PC_ITEM.BUCKET.id) > 0 && filled < POURS) {
        const before = heldId(PC_ITEM.BUCKET_WATER.id);
        const fountain = Locs.query().name('Fountain').within(8).nearest();
        const bucket = Inventory.items().find(item => item.id === PC_ITEM.BUCKET.id);
        if (!fountain || !bucket) {
            break;
        }
        if (!(await bucket.useOn(fountain))) {
            break;
        }
        if (!(await Execution.delayUntil(() => heldId(PC_ITEM.BUCKET_WATER.id) > before, 8000))) {
            break;
        }
        filled++;
    }
    log(`filled ${filled} bucket(s) at the Ardougne fountain`);
    return filled > 0;
}

export async function pourWater(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(PC_TILE.GARDEN, 1, log))) {
        return false;
    }
    await settleScene();
    let poured = 0;
    while (heldId(PC_ITEM.BUCKET_WATER.id) > 0 && poured < POURS) {
        const before = heldId(PC_ITEM.BUCKET_WATER.id);
        const patch = locById(PC_LOC.MUD_PATCH, null, 6);
        const water = Inventory.items().find(item => item.id === PC_ITEM.BUCKET_WATER.id);
        if (!patch || !water) {
            log('no Mud patch or no Bucket of water in the garden');
            break;
        }
        if (!(await water.useOn(patch))) {
            break;
        }
        if (!(await driveUntil(() => heldId(PC_ITEM.BUCKET_WATER.id) < before, [], log, 15_000))) {
            log('the soil took no more water');
            break;
        }
        poured++;
    }
    log(`poured ${poured} bucket(s) onto the garden soil`);
    return poured > 0;
}

// Why: both spawns sit behind two shut doors, and a plain ground grab clicks Take from
// the garden, where the server's own path search dead-ends and nothing happens at all.
export async function takeFromHouse(item: PlagueItem, log: (m: string) => void): Promise<boolean> {
    if (heldId(item.id) > 0) {
        return true;
    }
    if (!(await walkTo(PC_TILE.HOUSE_FLOOR, 1, log))) {
        return false;
    }
    await settleScene();
    const drop = GroundItems.query().name(item.name).within(6).nearest();
    if (!drop) {
        log(`no ${item.name} on the floor of Edmond's house`);
        return false;
    }
    if (!(await drop.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(item.id) > 0, 8000);
}

// Why: Alrena hides a spare mask in the cupboard, and it is the only re-issue in the quest for a mask that was dropped or destroyed.
export async function searchCupboard(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(PC_TILE.CUPBOARD, 1, log))) {
        return false;
    }
    await settleScene();
    const open = locById(PC_LOC.CUPBOARD_OPEN, 'Search', 6);
    if (open) {
        if (!(await open.interact('Search'))) {
            return false;
        }
        return driveUntil(() => heldId(PC_ITEM.GAS_MASK.id) > 0, [], log, 10_000);
    }
    const shut = locById(PC_LOC.CUPBOARD_SHUT, 'Open', 6);
    if (!shut || !(await shut.interact('Open'))) {
        log("no cupboard in Alrena's house");
        return false;
    }
    return Execution.delayUntil(() => locById(PC_LOC.CUPBOARD_OPEN, 'Search', 6) !== null, 6000);
}

export async function readScroll(log: (m: string) => void): Promise<boolean> {
    const scroll = Inventory.items().find(item => item.id === PC_ITEM.ARDOUGNE_SCROLL.id);
    if (!scroll) {
        return true;
    }
    if (!(await scroll.interact('Read'))) {
        return false;
    }
    const learnt = await driveUntil(() => heldId(PC_ITEM.ARDOUGNE_SCROLL.id) === 0, [], log, 10_000);
    log(learnt ? 'memorised the Ardougne Teleport scroll' : 'the magic scroll would not read');
    return learnt;
}

export async function tieRope(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(PC_TILE.SEWER_PIPE, 1, log))) {
        return false;
    }
    await settleScene();
    const pipe = locById(PC_LOC.SEWER_PIPE, null, 8);
    const rope = Inventory.items().find(item => item.id === PC_ITEM.ROPE.id);
    if (!pipe || !rope) {
        log(`no ${pipe ? 'Rope' : 'Sewer pipe'} for the grill`);
        return false;
    }
    if (!(await rope.useOn(pipe))) {
        return false;
    }
    return driveUntil(() => heldId(PC_ITEM.ROPE.id) === 0, [], log, 15_000);
}
