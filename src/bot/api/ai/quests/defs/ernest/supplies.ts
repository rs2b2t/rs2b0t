import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { QuestFood } from '../../food.js';
import { EC_ID, EC_NAME, EC_TILE } from './areas.js';

export const FOOD_TARGET = 8;
export const FOOD_LOW = 3;

export function heldId(snap: QuestSnapshot, id: number): number {
    return snap.invIds?.get(id) ?? 0;
}

export function bankedId(snap: QuestSnapshot, id: number): number {
    return snap.bankIds?.get(id) ?? 0;
}

// Why: `ownsInventory` opts the module out of the engine's food withdrawal, so it is drawn here.
// Why: nothing in the manor is aggressive, so the float covers random events rather than the quest.

/** The module's own spade and food withdrawal, or null when the pack is ready. */
export function kit(snap: QuestSnapshot): QuestStep | null {
    const needSpade = heldId(snap, EC_ID.SPADE) === 0;
    const foodName = QuestFood.name?.trim();
    const foodHeld = foodName ? (snap.inv.get(foodName.toLowerCase()) ?? 0) : 0;
    const foodBanked = foodName ? (snap.bank?.get(foodName.toLowerCase()) ?? 0) : 0;
    const needFood = Boolean(foodName) && foodHeld < FOOD_LOW && foodBanked > 0;

    if (!needSpade && !needFood) {
        return null;
    }
    if (!snap.bankKnown) {
        return { kind: 'scanBank' };
    }

    const items: { name: string; qty: number; id?: number }[] = [];
    if (needSpade && bankedId(snap, EC_ID.SPADE) > 0) {
        items.push({ name: EC_NAME.SPADE, qty: 1, id: EC_ID.SPADE });
    }
    if (needFood && foodName) {
        items.push({ name: foodName, qty: Math.min(FOOD_TARGET - foodHeld, foodBanked) });
    }
    if (items.length > 0) {
        return { kind: 'withdraw', items };
    }
    // No banked spade. The only free source is the manor ground spawn.
    return { kind: 'grabGround', item: EC_NAME.SPADE, anchor: EC_TILE.SPADE_SPAWN, waitIfMissing: true };
}
