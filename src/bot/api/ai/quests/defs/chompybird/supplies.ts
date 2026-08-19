import { QuestFood } from '../../food.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { BOB_AXES, CB_ID, CB_NAME, CB_TILE, GERRANT } from './areas.js';

/** Six for Rantz and six to shoot with; a burnt chompy costs a second kill. */
export const ARROW_TARGET = 12;
export const FOOD_TARGET = 6;
export const COIN_TARGET = 2000;
const COIN_FLOOR = 300;

const AXES: readonly string[] = [
    'Rune axe', 'Adamant axe', 'Mithril axe', 'Black axe', 'Steel axe', 'Iron axe', 'Bronze axe'
];

export const heldId = (snap: QuestSnapshot, id: number): number => snap.invIds?.get(id) ?? 0;
export const bankedId = (snap: QuestSnapshot, id: number): number => snap.bankIds?.get(id) ?? 0;
const held = (snap: QuestSnapshot, name: string): number => snap.inv.get(name.toLowerCase()) ?? 0;
const banked = (snap: QuestSnapshot, name: string): number => snap.bank?.get(name.toLowerCase()) ?? 0;

export function selectedFood(): string | null {
    const food = QuestFood.name?.trim();
    return food ? food : null;
}

export function scanBank(): QuestStep {
    return { kind: 'scanBank', bank: CB_TILE.YANILLE_BANK };
}

export function withdraw(items: { name: string; qty: number; id?: number }[]): QuestStep {
    return { kind: 'withdraw', items, bank: CB_TILE.YANILLE_BANK };
}

/** Everything this quest carries; anything else is spillover. */
export function keepList(): string[] {
    const food = selectedFood()?.toLowerCase();
    return [
        ...AXES.map(a => a.toLowerCase()),
        CB_NAME.KNIFE, CB_NAME.CHISEL, CB_NAME.FEATHER, CB_NAME.COINS,
        CB_NAME.ACHEY_LOGS, CB_NAME.SHAFT, CB_NAME.FLIGHTED, CB_NAME.WOLF_BONES, CB_NAME.ARROWTIPS,
        CB_NAME.ARROW, CB_NAME.BOW, CB_NAME.TOAD, CB_NAME.RAW_CHOMPY, CB_NAME.SEASONED_CHOMPY,
        CB_NAME.POTATO, CB_NAME.ONION, CB_NAME.CABBAGE, CB_NAME.TOMATO, CB_NAME.DOOGLE, CB_NAME.EQUA,
        'ogre bellows',
        'scimitar', 'longsword', 'battleaxe', 'mace', 'sword',
        'chainbody', 'platebody', 'platelegs', 'plateskirt', 'full helm', 'med helm',
        'kiteshield', 'sq shield',
        ...(food ? [food] : [])
    ].map(n => n.toLowerCase());
}

export function heldAxe(snap: QuestSnapshot): string | null {
    return AXES.find(name => held(snap, name) > 0) ?? null;
}

function bankedAxe(snap: QuestSnapshot): string | null {
    return AXES.find(name => banked(snap, name) > 0) ?? null;
}

/** Bank the junk this quest has no use for, so a withdrawal has somewhere to land. */
export function makeSpace(snap: QuestSnapshot, slots: number): QuestStep | null {
    if (snap.freeSlots === undefined || snap.freeSlots >= slots) {
        return null;
    }
    const keep = keepList();
    const spillover = [...snap.inv.keys()].some(name => !keep.some(k => name.includes(k)));
    if (!spillover) {
        return null;
    }
    return { kind: 'deposit', keep, bank: CB_TILE.YANILLE_BANK };
}

// Why: `ownsInventory` retires the engine's provisioning, so coins, food and the axe are this module's own bank trip.

/** Coins, food and — when `wantAxe` — an axe. Null once the pack is dressed. */
export function loadoutStep(snap: QuestSnapshot, wantAxe = true): QuestStep | null {
    if (!snap.bankKnown) {
        return scanBank();
    }
    const space = makeSpace(snap, 4);
    if (space) {
        return space;
    }
    const wants: { name: string; qty: number; id?: number }[] = [];
    // Why: the axe trip is to Lumbridge and the bank is Yanille, so anything else the booth can answer goes in the same withdrawal.
    for (const tool of [{ name: CB_NAME.KNIFE, id: CB_ID.KNIFE }, { name: CB_NAME.CHISEL, id: CB_ID.CHISEL }]) {
        if (heldId(snap, tool.id) === 0 && bankedId(snap, tool.id) > 0) {
            wants.push({ name: tool.name, qty: 1, id: tool.id });
        }
    }
    const coins = held(snap, CB_NAME.COINS);
    if (coins < COIN_FLOOR) {
        const take = Math.min(COIN_TARGET - coins, banked(snap, CB_NAME.COINS));
        if (take > 0) {
            wants.push({ name: CB_NAME.COINS, qty: take });
        }
    }
    const food = selectedFood();
    if (food && held(snap, food) === 0) {
        const take = Math.min(FOOD_TARGET, banked(snap, food));
        if (take > 0) {
            wants.push({ name: food, qty: take });
        }
    }
    if (wantAxe && heldAxe(snap) === null) {
        const fromBank = bankedAxe(snap);
        if (fromBank) {
            wants.push({ name: fromBank, qty: 1 });
        }
    }
    if (wants.length > 0) {
        return withdraw(wants);
    }
    if (wantAxe && heldAxe(snap) === null) {
        // Why: nothing in the ogre area sells an axe, and the achey trees answer nothing without one.
        return { kind: 'buy', item: 'Bronze axe', qty: 1, shop: BOB_AXES, estGp: 100 };
    }
    return null;
}

// Why: Bugs only sells the pair while the quest sits at stage 5, so an established account's own knife and chisel are the source every later leg has.

/** A knife and a chisel from the bank. Null when both are held, or when the bank has neither. */
export function toolStep(snap: QuestSnapshot): QuestStep | null {
    const missing = [
        { name: CB_NAME.KNIFE, id: CB_ID.KNIFE },
        { name: CB_NAME.CHISEL, id: CB_ID.CHISEL }
    ].filter(tool => heldId(snap, tool.id) === 0);
    if (missing.length === 0) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const stored = missing.filter(tool => bankedId(snap, tool.id) > 0);
    if (stored.length < missing.length) {
        return null;
    }
    return withdraw(stored.map(tool => ({ name: tool.name, qty: 1, id: tool.id })));
}

export function toolsHeld(snap: QuestSnapshot): boolean {
    return heldId(snap, CB_ID.KNIFE) > 0 && heldId(snap, CB_ID.CHISEL) > 0;
}

/** Feathers up to `want`: the bank first, then Gerrant's counter in Port Sarim. */
export function feathersStep(snap: QuestSnapshot, want: number): QuestStep | null {
    const have = heldId(snap, CB_ID.FEATHER);
    if (have >= want) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const space = makeSpace(snap, 1);
    if (space) {
        return space;
    }
    const short = want - have;
    const fromBank = Math.min(short, bankedId(snap, CB_ID.FEATHER));
    if (fromBank > 0) {
        return withdraw([{ name: CB_NAME.FEATHER, qty: fromBank, id: CB_ID.FEATHER }]);
    }
    return { kind: 'buy', item: CB_NAME.FEATHER, qty: short, shop: GERRANT, estGp: short * 4 };
}
