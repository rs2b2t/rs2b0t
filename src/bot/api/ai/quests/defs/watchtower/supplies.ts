import Tile from '../../../../../geometry/Tile.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { WT_ITEM, WT_TILE, type WatchtowerItem } from './areas.js';
import { QuestFood } from '../../food.js';

// Why: every shop here was read out of the engine's own configs rather than a guide.
// Why: nobody in this game is called 'Shop keeper', the shop belongs to a named NPC through param=owned_shop, and Shop.open() matches on the display name.
export const ARDOUGNE_ADVENTURER = { npc: 'Aemad', anchor: new Tile(2613, 3294, 0) };
export const MAGIC_GUILD = { npc: 'Magic Store owner', anchor: new Tile(2595, 3087, 1) };
export const OGRE_HERBLORE = { npc: 'Ogre merchant', anchor: new Tile(2528, 3048, 0) };

// Shop asking prices run above the obj cost, so each of these leaves headroom.
const ROPE_PRICE = 60;
const DEATH_RUNE_PRICE = 120;
const VIAL_PRICE = 20;
const PESTLE_PRICE = 40;
const PICKAXE_PRICE = 60;

export function held(snap: QuestSnapshot, id: number): number {
    return snap.invIds?.get(id) ?? 0;
}

export function banked(snap: QuestSnapshot, id: number): number {
    return snap.bankIds?.get(id) ?? 0;
}

export function owned(snap: QuestSnapshot, id: number): number {
    return held(snap, id) + banked(snap, id);
}

/** The kit the bank can supply, one of each. */
const KIT_ITEMS: readonly WatchtowerItem[] = [
    WT_ITEM.ROPE,
    WT_ITEM.LIT_CANDLE,
    WT_ITEM.VIAL_WATER,
    WT_ITEM.GUAM_LEAF,
    WT_ITEM.PESTLE,
    WT_ITEM.PICKAXE,
    WT_ITEM.BAT_BONES,
    WT_ITEM.DRAGON_BONES,
    WT_ITEM.DEATH_RUNE,
    WT_ITEM.GOLD_BAR,
    WT_ITEM.SKAVID_MAP
];

/** Tolls and shop money the quest runs on. */
const KIT_COINS = 2000;

export function withdrawFrom(items: { name: string; id?: number; qty: number }[]): QuestStep {
    return { kind: 'withdraw', items, bank: WT_TILE.YANILLE_BANK };
}

export function scanBank(): QuestStep {
    return { kind: 'scanBank', bank: WT_TILE.YANILLE_BANK };
}

/** Bank first, then shop. Null once the pack already holds enough. */
export function source(
    snap: QuestSnapshot,
    item: WatchtowerItem,
    qty: number,
    shop: { npc: string; anchor: Tile },
    unitGp: number
): QuestStep | null {
    if (held(snap, item.id) >= qty) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const missing = qty - held(snap, item.id);
    const inBank = banked(snap, item.id);
    if (inBank > 0) {
        return withdrawFrom([{ name: item.name, id: item.id, qty: Math.min(missing, inBank) }]);
    }
    return { kind: 'buy', item: item.name, qty: missing, shop, estGp: missing * unitGp };
}

/** Bank only. Drop-only items are never bought, so an empty bank is an honest park. */
export function bankOnly(snap: QuestSnapshot, item: WatchtowerItem, qty: number = 1): QuestStep | null {
    if (held(snap, item.id) >= qty) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const inBank = banked(snap, item.id);
    if (inBank > 0) {
        return withdrawFrom([{ name: item.name, id: item.id, qty: Math.min(qty - held(snap, item.id), inBank) }]);
    }
    return { kind: 'wait', reason: `no ${item.name} in the bank — it is a drop-only item` };
}

export function sourceCoins(snap: QuestSnapshot, want: number): QuestStep | null {
    if (held(snap, WT_ITEM.COINS.id) >= want) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const available = banked(snap, WT_ITEM.COINS.id);
    if (available <= 0) {
        return { kind: 'wait', reason: `need ${want} gp for Gu'Tanoth tolls and shops` };
    }
    return withdrawFrom([{ name: WT_ITEM.COINS.name, id: WT_ITEM.COINS.id, qty: Math.min(want, available) }]);
}

export function sourceRope(snap: QuestSnapshot): QuestStep | null {
    return source(snap, WT_ITEM.ROPE, 1, ARDOUGNE_ADVENTURER, ROPE_PRICE);
}

export function sourceDeathRune(snap: QuestSnapshot): QuestStep | null {
    return source(snap, WT_ITEM.DEATH_RUNE, 1, MAGIC_GUILD, DEATH_RUNE_PRICE);
}

export function sourceVial(snap: QuestSnapshot): QuestStep | null {
    return source(snap, WT_ITEM.VIAL_WATER, 1, ARDOUGNE_ADVENTURER, VIAL_PRICE);
}

export function sourcePestle(snap: QuestSnapshot): QuestStep | null {
    return source(snap, WT_ITEM.PESTLE, 1, OGRE_HERBLORE, PESTLE_PRICE);
}

// Why: the Rock of Dalgroth is the quest's only mining, and a rock does not respond without a pickaxe, no message, no refusal, so the step retries forever.
// Why: Aemad stocks bronze, which is all a max-stats miner needs here.

/** Source a pickaxe, or null when one is held. */
export function sourcePickaxe(snap: QuestSnapshot): QuestStep | null {
    return source(snap, WT_ITEM.PICKAXE, 1, ARDOUGNE_ADVENTURER, PICKAXE_PRICE);
}

/** The candle by the tower respawns already lit, so no tinderbox is needed. */
export function sourceLightSource(snap: QuestSnapshot): QuestStep | null {
    if (held(snap, WT_ITEM.LIT_CANDLE.id) > 0) {
        return null;
    }
    if (banked(snap, WT_ITEM.LIT_CANDLE.id) > 0) {
        return withdrawFrom([{ name: WT_ITEM.LIT_CANDLE.name, id: WT_ITEM.LIT_CANDLE.id, qty: 1 }]);
    }
    return { kind: 'grabGround', item: WT_ITEM.LIT_CANDLE.name, anchor: WT_TILE.CANDLE, waitIfMissing: true };
}

// Why: the chosen food comes first, as naming three fish meant a bank stocked with anything else read as no food at all and the enclave trip waited instead of withdrawing.
const FALLBACK_FOODS = ['Tuna', 'Swordfish', 'Lobster'] as const;

/** The configured food, then the fish the module falls back on. */
function questFoods(): string[] {
    const chosen = QuestFood.name?.trim();
    const out = chosen ? [chosen] : [];
    for (const food of FALLBACK_FOODS) {
        if (!out.some(held => held.toLowerCase() === food.toLowerCase())) {
            out.push(food);
        }
    }
    return out;
}

export function carriedFood(snap: QuestSnapshot): number {
    return questFoods().reduce((total, food) => total + (snap.inv.get(food.toLowerCase()) ?? 0), 0);
}

// Why: the shamans are 99 in every combat stat and respawn about every hundred ticks, so an enclave trip without food is a death.
// Why: ownsInventory means the engine's own food provisioning never runs for this quest.

/** Source `want` food, or null when the pack has it. */
export function sourceFood(snap: QuestSnapshot, want: number): QuestStep | null {
    const carried = carriedFood(snap);
    if (carried >= want) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    for (const food of questFoods()) {
        const inBank = snap.bank?.get(food.toLowerCase()) ?? 0;
        if (inBank > 0) {
            return { kind: 'withdraw', items: [{ name: food, qty: Math.min(want - carried, inBank) }], bank: WT_TILE.YANILLE_BANK };
        }
    }
    return { kind: 'wait', reason: 'no food in the bank for the shaman enclave' };
}

// Why: the bank supplies the kit in one go, where sourcing item by item paid for a trip each, from wherever the quest had got to.
// Why: only what the bank holds is asked for, so the shop, the ground candle and the guard's riddle stay as the fallbacks and an empty bank changes nothing.

/** Everything the kit still needs that the bank can supply, in one withdrawal. */
export function questKit(snap: QuestSnapshot, foodWant: number): QuestStep | null {
    // Why: an unread bank is left to whichever stage first needs a scan, so a quest wanting nothing more from the bank never takes a trip to prove it.
    if (!snap.bankKnown) {
        return null;
    }
    const items: { name: string; id?: number; qty: number }[] = [];
    for (const item of KIT_ITEMS) {
        const missing = 1 - held(snap, item.id);
        if (missing > 0 && banked(snap, item.id) > 0) {
            items.push({ name: item.name, id: item.id, qty: missing });
        }
    }
    // Why: gear is what the trip is for, as a purse 23 coins down or a lobster eaten is not a reason to walk back to Yanille and the stage sourcers refill those.
    // Why: topping a delta up each tick spent sixteen trips on one run and fed the no-progress watchdog until it parked the quest.
    if (items.length === 0) {
        return null;
    }
    const coinsShort = KIT_COINS - held(snap, WT_ITEM.COINS.id);
    const bankedCoins = banked(snap, WT_ITEM.COINS.id);
    if (coinsShort > 0 && bankedCoins > 0) {
        items.push({ name: WT_ITEM.COINS.name, id: WT_ITEM.COINS.id, qty: Math.min(coinsShort, bankedCoins) });
    }
    const foodShort = foodWant - carriedFood(snap);
    if (foodShort > 0) {
        for (const food of questFoods()) {
            const inBank = snap.bank?.get(food.toLowerCase()) ?? 0;
            if (inBank > 0) {
                items.push({ name: food, qty: Math.min(foodShort, inBank) });
                break;
            }
        }
    }
    return items.length > 0 ? withdrawFrom(items) : null;
}
