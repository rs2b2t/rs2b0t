import { Execution } from '../../../api/Execution.js';
import type Tile from '../../../api/Tile.js';
import { Traversal } from '../../../api/Traversal.js';
import { Bank } from '../../../api/hud/Bank.js';
import { GroundItems } from '../../../api/queries/GroundItems.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { driveUntil, settleScene } from '../../exec/prompts.js';
import { gatherWool, type WoolSites } from '../../exec/wool.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { AGGIE_PASTE, NED_WIG, PA_ITEM, PA_LOC, PA_NPC, PA_SHOP, PA_TILE } from './areas.js';
import { buyItem, fromBank, grabItem, held, heldItem, owned } from './supplies.js';

const WOOL_SITES: WoolSites = {
    pen: PA_TILE.SHEEP_PEN,
    wheelStand: PA_TILE.SPIN_STAND,
    shearsSpawn: PA_TILE.SHEARS_SPAWN,
    spinLabel: 'spin wool at Lumbridge'
};

const BALLS_FOR_WIG = 3;
const ONIONS_FOR_DYE = 2;

const TINDERBOX_GP = 10;
const SHEARS_GP = 10;
const SKIRT_GP = 20;
const REDBERRIES_GP = 20;
const FLOUR_GP = 30;

function haveWig(snap: QuestSnapshot): boolean {
    return owned(snap, PA_ITEM.BLOND_WIG.id) > 0 || owned(snap, PA_ITEM.PLAIN_WIG.id) > 0;
}

function haveDye(snap: QuestSnapshot): boolean {
    return owned(snap, PA_ITEM.BLOND_WIG.id) > 0 || owned(snap, PA_ITEM.YELLOW_DYE.id) > 0;
}

function havePaste(snap: QuestSnapshot): boolean {
    return owned(snap, PA_ITEM.PASTE.id) > 0;
}

/** The prince consumes all three from the pack, so a banked piece does not count. */
export function disguiseComplete(snap: QuestSnapshot): boolean {
    return held(snap, PA_ITEM.BLOND_WIG.id) > 0
        && held(snap, PA_ITEM.PINK_SKIRT.id) > 0
        && held(snap, PA_ITEM.PASTE.id) > 0;
}

export function sourceTinderbox(snap: QuestSnapshot): QuestStep | null {
    if (havePaste(snap) || owned(snap, PA_ITEM.ASHES.id) > 0) {
        return null;
    }
    return buyItem(snap, PA_ITEM.TINDERBOX, 1, PA_SHOP.LUMBRIDGE, TINDERBOX_GP);
}

export function sourceShears(snap: QuestSnapshot): QuestStep | null {
    if (haveWig(snap) || owned(snap, PA_ITEM.BALL_OF_WOOL.id) >= BALLS_FOR_WIG) {
        return null;
    }
    return buyItem(snap, PA_ITEM.SHEARS, 1, PA_SHOP.LUMBRIDGE, SHEARS_GP);
}

export function sourceOnions(snap: QuestSnapshot): QuestStep | null {
    if (haveDye(snap) || held(snap, PA_ITEM.ONION.id) >= ONIONS_FOR_DYE) {
        return null;
    }
    return fromBank(snap, PA_ITEM.ONION, ONIONS_FOR_DYE)
        ?? { kind: 'pickLoc', loc: PA_LOC.ONION, op: 'Pick', item: PA_ITEM.ONION.name, anchor: PA_TILE.ONION_PATCH };
}

export function sourceWool(snap: QuestSnapshot): QuestStep | null {
    if (haveWig(snap) || held(snap, PA_ITEM.BALL_OF_WOOL.id) >= BALLS_FOR_WIG) {
        return null;
    }
    const banked = fromBank(snap, PA_ITEM.BALL_OF_WOOL, BALLS_FOR_WIG);
    if (banked) {
        return banked;
    }
    // gatherWool reads the name map; this quest reads ids everywhere else.
    const shears: [string, number][] = held(snap, PA_ITEM.SHEARS.id) > 0 ? [['shears', 1]] : [];
    const woolSnap: QuestSnapshot = {
        ...snap,
        inv: new Map<string, number>([['wool', held(snap, PA_ITEM.WOOL.id)], ...shears])
    };
    return gatherWool(woolSnap, BALLS_FOR_WIG - held(snap, PA_ITEM.BALL_OF_WOOL.id), WOOL_SITES);
}

export function sourcePinkSkirt(snap: QuestSnapshot): QuestStep | null {
    return buyItem(snap, PA_ITEM.PINK_SKIRT, 1, PA_SHOP.THESSALIA, SKIRT_GP);
}

export function sourcePasteGoods(snap: QuestSnapshot): QuestStep | null {
    if (havePaste(snap)) {
        return null;
    }
    return buyItem(snap, PA_ITEM.REDBERRIES, 1, PA_SHOP.WYDIN, REDBERRIES_GP)
        ?? buyItem(snap, PA_ITEM.POT_OF_FLOUR, 1, PA_SHOP.WYDIN, FLOUR_GP);
}

export function makeAshes(snap: QuestSnapshot): QuestStep | null {
    if (havePaste(snap) || owned(snap, PA_ITEM.ASHES.id) > 0 || held(snap, PA_ITEM.TINDERBOX.id) === 0) {
        return null;
    }
    return grabItem(snap, PA_ITEM.LOGS, PA_TILE.LOGS_SPAWN)
        ?? { kind: 'custom', name: 'burn the logs for ashes', run: burnLogs };
}

export function makeBlondWig(snap: QuestSnapshot): QuestStep | null {
    if (owned(snap, PA_ITEM.BLOND_WIG.id) > 0) {
        return fromBank(snap, PA_ITEM.BLOND_WIG, 1);
    }
    if (held(snap, PA_ITEM.YELLOW_DYE.id) === 0) {
        if (held(snap, PA_ITEM.ONION.id) < ONIONS_FOR_DYE) {
            return null;
        }
        return { kind: 'custom', name: 'have Aggie make yellow dye', run: makeYellowDye };
    }
    if (held(snap, PA_ITEM.PLAIN_WIG.id) === 0) {
        if (held(snap, PA_ITEM.BALL_OF_WOOL.id) < BALLS_FOR_WIG) {
            return null;
        }
        return { kind: 'talk', stop: NED_WIG };
    }
    return { kind: 'custom', name: 'dye the wig blond', run: dyeWig };
}

export function makePaste(snap: QuestSnapshot): QuestStep | null {
    if (havePaste(snap)) {
        return fromBank(snap, PA_ITEM.PASTE, 1);
    }
    const missing: (string | null)[] = [
        held(snap, PA_ITEM.REDBERRIES.id) === 0 ? PA_ITEM.REDBERRIES.name : null,
        held(snap, PA_ITEM.POT_OF_FLOUR.id) === 0 ? PA_ITEM.POT_OF_FLOUR.name : null,
        held(snap, PA_ITEM.ASHES.id) === 0 ? PA_ITEM.ASHES.name : null,
        held(snap, PA_ITEM.JUG_OF_WATER.id) === 0 ? PA_ITEM.JUG_OF_WATER.name : null
    ];
    const absent = missing.filter((name): name is string => name !== null);
    if (absent.length > 0) {
        return { kind: 'wait', reason: `paste needs ${absent.join(', ')}` };
    }
    return { kind: 'talk', stop: AGGIE_PASTE };
}

/**
 * Item-on-NPC is an opnpcu, so this walks and then uses. It must not open a
 * conversation first, which is all `Reach.npcDialog` does.
 */
export async function useHeldOnNpc(
    itemId: number,
    npcName: string,
    near: Tile,
    expect: () => boolean,
    log: (m: string) => void
): Promise<boolean> {
    if (expect()) {
        return true;
    }
    if (!(await Traversal.walkResilient(near, { radius: 3, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    await settleScene();
    const npc = Npcs.query().name(npcName).within(10).nearest();
    const item = heldItem(itemId);
    if (!npc || !item) {
        log(`useHeldOnNpc: no '${npcName}' or no item ${itemId} in the pack`);
        return false;
    }
    if (!(await item.useOn(npc))) {
        return false;
    }
    return driveUntil(expect, [], log);
}

async function burnLogs(log: (m: string) => void): Promise<boolean> {
    if (heldItem(PA_ITEM.ASHES.id)) {
        return true;
    }
    const tinder = heldItem(PA_ITEM.TINDERBOX.id);
    const logs = heldItem(PA_ITEM.LOGS.id);
    if (!tinder || !logs) {
        log('burnLogs: no tinderbox or no logs');
        return false;
    }
    // Bank tiles (and an open bank) refuse firemaking — walk outside first (#278).
    if (Bank.isOpen()) {
        await Bank.close();
    }
    log(`burnLogs: lighting outside near ${PA_TILE.LOGS_SPAWN.x},${PA_TILE.LOGS_SPAWN.z}`);
    if (!(await Traversal.walkResilient(PA_TILE.LOGS_SPAWN, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
        log('burnLogs: could not reach an outdoor fire tile');
        return false;
    }
    await settleScene();
    if (!(await tinder.useOn(logs))) {
        return false;
    }
    const ashesNear = (): boolean => GroundItems.query().name(PA_ITEM.ASHES.name).within(3).nearest() !== null;
    if (!(await Execution.delayUntil(ashesNear, 150_000))) {
        log('burnLogs: the fire never left any ashes');
        return false;
    }
    const ash = GroundItems.query().name(PA_ITEM.ASHES.name).within(3).nearest();
    if (!ash || !(await ash.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => heldItem(PA_ITEM.ASHES.id) !== null, 5000);
}

function makeYellowDye(log: (m: string) => void): Promise<boolean> {
    return useHeldOnNpc(
        PA_ITEM.ONION.id,
        PA_NPC.AGGIE,
        PA_TILE.AGGIE,
        () => heldItem(PA_ITEM.YELLOW_DYE.id) !== null,
        log
    );
}

async function dyeWig(log: (m: string) => void): Promise<boolean> {
    if (heldItem(PA_ITEM.BLOND_WIG.id)) {
        return true;
    }
    const dye = heldItem(PA_ITEM.YELLOW_DYE.id);
    const wig = heldItem(PA_ITEM.PLAIN_WIG.id);
    if (!dye || !wig) {
        log('dyeWig: no yellow dye or no plain wig');
        return false;
    }
    if (!(await dye.useOn(wig))) {
        return false;
    }
    return Execution.delayUntil(() => heldItem(PA_ITEM.BLOND_WIG.id) !== null, 8000);
}
