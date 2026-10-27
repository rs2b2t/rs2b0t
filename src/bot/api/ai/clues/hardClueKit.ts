import { ITEM_DB } from '#/bot/data/itemdb.js';

export const GUARDIAN_WEAPON_IDS: readonly number[] = [1231, 1215, 1305];
export const SUPERANTI = [
    { id: 2448, name: 'Superantipoison(4)', doses: 4 },
    { id: 181, name: 'Superantipoison(3)', doses: 3 },
    { id: 183, name: 'Superantipoison(2)', doses: 2 },
    { id: 185, name: 'Superantipoison(1)', doses: 1 }
] as const;
export const SHARK_ID = 385;
export const MIN_SHARKS = 15;
export const GUARDIAN_FOOD_RESERVE = 3;
export const GUARDIAN_MIN_SHARKS = GUARDIAN_FOOD_RESERVE + 1;
export type GuardianRangedLoadout = { weapon: string; ammo: string; quantity: number; mode: number };
export type KitItem = { readonly id: number; readonly count: number; readonly name?: string | null };
export type HardKitStatus = 'ready' | 'attack' | 'lost-city' | 'weapon' | 'ammo' | 'superantipoison' | 'sharks';
export type HardKitSnapshot = {
    readonly attack: number;
    readonly lostCity: boolean;
    readonly items: readonly KitItem[];
    readonly ranged?: GuardianRangedLoadout;
};

export function superantiDoses(items: readonly KitItem[]): number {
    return items.reduce((sum, item) => sum + item.count * (SUPERANTI.find(dose => dose.id === item.id)?.doses ?? 0), 0);
}

export function rangedWeaponId(name: string): number | undefined {
    return ITEM_DB.find(item => item.slot === 'righthand' && item.name.toLowerCase() === name.toLowerCase())?.id;
}

export function hardClueKit(kit: HardKitSnapshot, minimumSharks = MIN_SHARKS, needsAntipoison = true): HardKitStatus {
    if (kit.ranged) {
        const has = (name: string): boolean => kit.items.some(item => item.name?.toLowerCase() === name.toLowerCase() && item.count > 0);
        const weapon = rangedWeaponId(kit.ranged.weapon);
        if (!kit.items.some(item => item.id === weapon && item.count > 0)) return 'weapon';
        if (!has(kit.ranged.ammo)) return 'ammo';
    } else {
        if (kit.attack < 60) return 'attack';
        if (!kit.lostCity) return 'lost-city';
        if (!kit.items.some(item => GUARDIAN_WEAPON_IDS.includes(item.id) && item.count > 0)) return 'weapon';
    }
    if (needsAntipoison && superantiDoses(kit.items) === 0) return 'superantipoison';
    if (kit.items.filter(item => item.id === SHARK_ID).reduce((n, item) => n + item.count, 0) < minimumSharks) return 'sharks';
    return 'ready';
}
