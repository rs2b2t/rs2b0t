import { lootIdentity } from './loot.js';
import type { ItemStack, JiveSettings, PackLine, PackPlan, PotionFamily } from './types.js';

export const POTIONS: Record<PotionFamily, readonly number[]> = {
    prayer: [143, 141, 139, 2434],
    attack: [149, 147, 145, 2436],
    strength: [161, 159, 157, 2440],
    defence: [167, 165, 163, 2442],
    antifire: [2458, 2456, 2454, 2452],
    antipoison: [185, 183, 181, 2448]
};
const notes = new Map<number, number>([[386, 385], ...Object.values(POTIONS).flatMap(ids => ids.map(id => [id + 1, id] as [number, number]))]);

export function canonicalId(id: number): number { return notes.get(id) ?? lootIdentity(id)?.id ?? id; }

export function countStock(items: readonly ItemStack[], id: number, usableOnly = false): number {
    return items.reduce((count, item) => count + (canonicalId(item.id) === canonicalId(id) && (!usableOnly || (!item.noted && item.id === canonicalId(item.id))) ? item.count : 0), 0);
}

export function countDoses(items: readonly ItemStack[], family: PotionFamily, usableOnly = false): number {
    return POTIONS[family].reduce((doses, id, index) => doses + countStock(items, id, usableOnly) * (index + 1), 0);
}

export function stockDeficits(items: readonly ItemStack[], settings: JiveSettings) {
    return {
        sharks: Math.max(0, settings.stockSharks - countStock(items, 385)),
        prayerDoses: Math.max(0, settings.stockPrayerDoses - countDoses(items, 'prayer')),
        superSets: Math.ceil(Math.max(...(['attack', 'strength', 'defence'] as const).map(family => Math.max(0, settings.stockSuperSets * 3 - countDoses(items, family)))) / 3),
        antifireDoses: Math.max(0, settings.stockAntifireDoses - countDoses(items, 'antifire')),
        antipoisonDoses: Math.max(0, settings.stockAntipoisonDoses - countDoses(items, 'antipoison'))
    };
}

export function planPack(lines: readonly PackLine[], reserveSlots = 1): PackPlan {
    if (!Number.isSafeInteger(reserveSlots) || reserveSlots < 0 || reserveSlots > 28) return { kind: 'blocked', reason: 'Invalid inventory reserve' };
    const merged = new Map<number, PackLine>();
    for (const line of lines) {
        if (!Number.isSafeInteger(line.count) || line.count < 0 || !Number.isSafeInteger(line.id) || line.id < 0) return { kind: 'blocked', reason: 'Invalid item count in trip manifest' };
        if (!line.count) continue;
        if (canonicalId(line.id) !== line.id) return { kind: 'blocked', reason: `Trip manifest contains noted item ${line.id}` };
        const previous = merged.get(line.id);
        merged.set(line.id, { ...line, count: (previous?.count ?? 0) + line.count });
    }
    const items = [...merged.values()];
    const slots = items.reduce((slots, item) => slots + (item.stackable ? 1 : item.count), 0);
    return slots + reserveSlots > 28 ? { kind: 'blocked', reason: `Trip needs ${slots} slots plus ${reserveSlots} reserved; inventory has 28` } : { kind: 'ready', items, slots, reserveSlots };
}

export function potionPack(items: readonly ItemStack[], family: PotionFamily, doses: number): PackLine[] | null {
    const lines: PackLine[] = [];
    let remaining = doses;
    for (let index = 3; index >= 0 && remaining > 0; index--) {
        const id = POTIONS[family][index];
        const count = Math.min(countStock(items, id), Math.ceil(remaining / (index + 1)));
        if (count > 0) { lines.push({ id, count, stackable: false, purpose: family }); remaining -= count * (index + 1); }
    }
    return remaining > 0 ? null : lines;
}
