import { ITEMS_BY_ID, ITEMS_BY_NAME } from '../../../../data/itemIndex.js';
import type { Slot } from '../../../loadout/types.js';
import type { QuestSnapshot } from './types.js';

const COINS_ID = 995;

export interface PackItem { id: number; name: string | null; count: number; noted?: boolean }

export function unnotedCounts(inventory: readonly PackItem[]): Map<number, number> {
    const ids = new Map<number, number>();
    for (const item of inventory) {
        if (!item.noted) ids.set(item.id, (ids.get(item.id) ?? 0) + item.count);
    }
    return ids;
}

function occupiedSlots(snap: QuestSnapshot): Set<Slot> {
    const occupied = new Set<Slot>();
    for (const id of snap.wornIds ?? []) {
        const slot = ITEMS_BY_ID.get(id)?.slot;
        if (slot) occupied.add(slot);
    }
    for (const name of snap.worn) {
        for (const item of ITEMS_BY_NAME.get(name) ?? []) {
            if (item.slot) occupied.add(item.slot);
        }
    }
    return occupied;
}

interface RetentionPolicy {
    caps: ReadonlyMap<number, number>;
    foods: ReadonlySet<string>;
    foodLimit: number;
    reserve: number;
    excludeGear?: (id: number) => boolean;
}

export function retainGearAndFood(snap: QuestSnapshot, inventory: readonly PackItem[], ids: ReadonlyMap<number, number>, policy: RetentionPolicy) {
    const names = new Map(inventory.map(item => [item.id, item.name?.toLowerCase()]));
    const occupied = occupiedSlots(snap);
    const retained = new Map<number, number>();
    let slots = 0;
    for (const [id, count] of ids) {
        if (policy.foods.has(names.get(id) ?? '')) continue;
        const slot = ITEMS_BY_ID.get(id)?.slot;
        const keepGear = slot && !occupied.has(slot) && !policy.excludeGear?.(id);
        const limit = policy.caps.get(id) ?? (keepGear ? slot === 'quiver' ? Infinity : 1 : 0);
        const qty = Math.min(count, limit);
        if (qty <= 0) continue;
        retained.set(id, qty);
        slots += id === COINS_ID || slot === 'quiver' ? 1 : qty;
        if (slot) occupied.add(slot);
    }

    let food = Math.min(policy.foodLimit, Math.max(0, 28 - slots - policy.reserve));
    const keepIds: number[] = [];
    const caps: { id: number; qty: number }[] = [];
    for (const [id, count] of ids) {
        const edible = policy.foods.has(names.get(id) ?? '');
        const qty = edible ? Math.min(count, food) : retained.get(id) ?? 0;
        if (edible) food -= qty;
        if (qty > 0) keepIds.push(id);
        if (qty > 0 && qty < count) caps.push({ id, qty });
    }
    return { keepIds, caps };
}
