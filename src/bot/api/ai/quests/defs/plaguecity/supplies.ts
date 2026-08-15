import Tile from '../../../../../geometry/Tile.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { PC_ITEM, PC_TILE, banked, held, type PlagueItem } from './areas.js';
import { takeFromHouse } from './east.js';

// Why: nobody in this game is called 'Shop keeper' — Shop.open matches the display name of the NPC that owns the stock.
export const AEMAD = { npc: 'Aemad', anchor: PC_TILE.AEMAD };
export const JATIX = { npc: 'Jatix', anchor: PC_TILE.JATIX };
export const WYDIN = { npc: 'Wydin', anchor: PC_TILE.WYDIN };

const ROPE_PRICE = 60;
const PESTLE_PRICE = 40;
const CHOCOLATE_PRICE = 60;

/** One float for all three shops, with headroom over their asking prices. */
const PURSE = 2000;

export function withdrawFrom(items: { name: string; id: number; qty: number }[]): QuestStep {
    return { kind: 'withdraw', items, bank: PC_TILE.BANK };
}

// Why: one bank inventory serves every booth, and the shopping float is asked for beside
// the snape grass spawns, five hundred tiles from the Ardougne booth this quest banks at.
function withdrawAnywhere(items: { name: string; id: number; qty: number }[]): QuestStep {
    return { kind: 'withdraw', items };
}

export function scanBank(): QuestStep {
    return { kind: 'scanBank', bank: PC_TILE.BANK };
}

function fromBank(snap: QuestSnapshot, item: PlagueItem, qty: number): QuestStep | null {
    if (!snap.bankKnown) {
        return scanBank();
    }
    const stock = banked(snap, item);
    if (stock <= 0) {
        return null;
    }
    return withdrawFrom([{ name: item.name, id: item.id, qty: Math.min(qty - held(snap, item), stock) }]);
}

// Why: Jethick reissues the book and Bravek reissues the warrant only while neither the
// pack nor the bank holds one, so a banked copy has to come out before anyone is asked again.

/** Withdraw a quest-issued item the bank is holding, or null when it is not banked. */
export function reclaim(snap: QuestSnapshot, item: PlagueItem): QuestStep | null {
    return held(snap, item) > 0 ? null : fromBank(snap, item, 1);
}

/** What the rope, pestle and chocolate bar cost between them. */
const SHOPPING_NEED = ROPE_PRICE + PESTLE_PRICE + CHOCOLATE_PRICE;

// Why: the float is drawn once and spent down, so the trigger is the shopping still to do —
// a purse topped back up to 2000 after every price walks to a bank between each shop.
function sourcePurse(snap: QuestSnapshot, floor: number, blocking: boolean): QuestStep | null {
    if (held(snap, PC_ITEM.COINS) >= floor) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const available = banked(snap, PC_ITEM.COINS);
    if (available <= 0) {
        return blocking ? { kind: 'wait', reason: 'no coins banked for the rope, pestle and chocolate bar' } : null;
    }
    return withdrawAnywhere([{ name: PC_ITEM.COINS.name, id: PC_ITEM.COINS.id, qty: Math.min(PURSE, available) }]);
}

/** Draw the float for all three shops, or null once the pack carries the shopping money. */
export const sourceShoppingFloat = (snap: QuestSnapshot): QuestStep | null => sourcePurse(snap, SHOPPING_NEED, false);

/** Bank first, then the shop with a purse withdrawn ahead of the trip. */
export function buyItem(
    snap: QuestSnapshot,
    item: PlagueItem,
    qty: number,
    shop: { npc: string; anchor: Tile },
    unitGp: number
): QuestStep | null {
    if (held(snap, item) >= qty) {
        return null;
    }
    const stocked = fromBank(snap, item, qty);
    if (stocked) {
        return stocked;
    }
    const missing = qty - held(snap, item);
    const gp = missing * unitGp;
    // Why: the shops are a rope in Ardougne, a pestle in Taverley and a chocolate bar in
    // Port Sarim, so the float is drawn once rather than walking back for each price.
    const purse = sourcePurse(snap, gp, true);
    return purse ?? { kind: 'buy', item: item.name, qty: missing, shop, estGp: gp };
}

// Why: a respawning spawn is worth waiting on, as walking away and back costs more than the respawn timer.

/** Bank first, then the ground spawn. Null once the pack already holds enough. */
export function takeSpawn(snap: QuestSnapshot, item: PlagueItem, qty: number, anchor: Tile): QuestStep | null {
    if (held(snap, item) >= qty) {
        return null;
    }
    return fromBank(snap, item, qty) ?? { kind: 'grabGround', item: item.name, anchor, waitIfMissing: true };
}

function fromHouseFloor(snap: QuestSnapshot, item: PlagueItem): QuestStep | null {
    if (held(snap, item) > 0) {
        return null;
    }
    return fromBank(snap, item, 1) ?? {
        kind: 'custom',
        name: `take the ${item.name.toLowerCase()} from Edmond's house`,
        run: log => takeFromHouse(item, log)
    };
}

export const sourceSpade = (snap: QuestSnapshot): QuestStep | null => fromHouseFloor(snap, PC_ITEM.SPADE);

export const sourcePicture = (snap: QuestSnapshot): QuestStep | null => fromHouseFloor(snap, PC_ITEM.PICTURE);

// Why: the garden takes four pours and hands the bucket back empty each time, so one bucket
// is four fountain-to-garden round trips; four buckets is one.

/** How many buckets the garden leg carries. */
export const BUCKET_TARGET = 4;

export function sourceBucket(snap: QuestSnapshot, qty = BUCKET_TARGET): QuestStep | null {
    if (held(snap, PC_ITEM.BUCKET) >= qty) {
        return null;
    }
    return fromBank(snap, PC_ITEM.BUCKET, qty)
        ?? { kind: 'grabGround', item: PC_ITEM.BUCKET.name, anchor: PC_TILE.BUCKET_SPAWN, waitIfMissing: true };
}

export const sourceDwellberries = (snap: QuestSnapshot): QuestStep | null =>
    takeSpawn(snap, PC_ITEM.DWELLBERRIES, 1, PC_TILE.DWELLBERRIES);

export const sourceSnapeGrass = (snap: QuestSnapshot): QuestStep | null =>
    takeSpawn(snap, PC_ITEM.SNAPE_GRASS, 1, PC_TILE.SNAPE_GRASS);

export const sourceRope = (snap: QuestSnapshot): QuestStep | null =>
    buyItem(snap, PC_ITEM.ROPE, 1, AEMAD, ROPE_PRICE);

export const sourcePestle = (snap: QuestSnapshot): QuestStep | null =>
    buyItem(snap, PC_ITEM.PESTLE, 1, JATIX, PESTLE_PRICE);

export const sourceChocolateBar = (snap: QuestSnapshot): QuestStep | null =>
    buyItem(snap, PC_ITEM.CHOCOLATE_BAR, 1, WYDIN, CHOCOLATE_PRICE);

/** Milk a cow in the field north-east of Ardougne; the empty bucket comes first. */
export function sourceMilk(snap: QuestSnapshot): QuestStep | null {
    if (held(snap, PC_ITEM.BUCKET_MILK) > 0) {
        return null;
    }
    return fromBank(snap, PC_ITEM.BUCKET_MILK, 1)
        ?? sourceBucket(snap, 1)
        ?? {
            kind: 'useOn',
            item: PC_ITEM.BUCKET.name,
            targetKind: 'npc',
            target: 'Cow',
            anchor: PC_TILE.COW_FIELD,
            product: PC_ITEM.BUCKET_MILK.name
        };
}
