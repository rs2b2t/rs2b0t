import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { QuestFood } from '../../food.js';
import { PT_ID, PT_NAME, PT_TILE, THESSALIA_SHOP } from './areas.js';

// Why: the crossing costs 30gp each way and Karamja has no bank, so the float is a threshold rather than a target — topping up to an exact balance puts a booth trip between every purchase.
export const COIN_TARGET = 2000;
export const COIN_LOW = 300;
export const FOOD_TARGET = 8;
export const FOOD_LOW = 3;
const APRON_GP = 50;

export function heldId(snap: QuestSnapshot, id: number): number {
    return snap.invIds?.get(id) ?? 0;
}

export function bankedId(snap: QuestSnapshot, id: number): number {
    return snap.bankIds?.get(id) ?? 0;
}

export function wornId(snap: QuestSnapshot, id: number): boolean {
    return snap.wornIds?.has(id) ?? false;
}

// Why: `ownsInventory` marks the quest provisioned before the engine reads `coinFloat` or `food`, so both are inert and this is the only place either is drawn.

/** Coins, food, and whichever of the apron and spade the caller still needs. */
export function kit(snap: QuestSnapshot, wantApron: boolean, wantSpade: boolean): QuestStep | null {
    const needCoins = heldId(snap, PT_ID.COINS) < COIN_LOW;
    const needApron = wantApron && heldId(snap, PT_ID.WHITE_APRON) === 0 && !wornId(snap, PT_ID.WHITE_APRON);
    const needSpade = wantSpade && heldId(snap, PT_ID.SPADE) === 0;
    const foodName = QuestFood.name?.trim();
    const foodHeld = foodName ? (snap.inv.get(foodName.toLowerCase()) ?? 0) : 0;
    const needFood = Boolean(foodName) && foodHeld < FOOD_LOW;

    if (!needCoins && !needApron && !needSpade && !needFood) {
        return null;
    }
    if (!snap.bankKnown) {
        return { kind: 'scanBank' };
    }

    const items: { name: string; qty: number; id?: number }[] = [];
    const bankedCoins = snap.bank?.get('coins') ?? 0;
    if (needCoins && bankedCoins > 0) {
        items.push({ name: PT_NAME.COINS, qty: Math.min(COIN_TARGET, bankedCoins) });
    }
    if (needFood && foodName) {
        const banked = snap.bank?.get(foodName.toLowerCase()) ?? 0;
        if (banked > 0) {
            items.push({ name: foodName, qty: Math.min(FOOD_TARGET - foodHeld, banked) });
        }
    }
    if (needApron && bankedId(snap, PT_ID.WHITE_APRON) > 0) {
        items.push({ name: PT_NAME.WHITE_APRON, qty: 1, id: PT_ID.WHITE_APRON });
    }
    if (needSpade && bankedId(snap, PT_ID.SPADE) > 0) {
        items.push({ name: PT_NAME.SPADE, qty: 1, id: PT_ID.SPADE });
    }
    if (items.length > 0) {
        return { kind: 'withdraw', items };
    }
    if (needApron) {
        return { kind: 'buy', item: PT_NAME.WHITE_APRON, qty: 1, shop: THESSALIA_SHOP, estGp: APRON_GP };
    }
    if (needSpade) {
        return { kind: 'grabGround', item: PT_NAME.SPADE, anchor: PT_TILE.SPADE_SPAWN, waitIfMissing: true };
    }
    return null;
}
