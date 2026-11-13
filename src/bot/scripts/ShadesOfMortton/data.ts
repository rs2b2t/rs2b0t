export const ID = {
    COINS: 995,
    MAGIC_LOGS: 1513,
    MAGIC_PYRE_LOGS: 3448,
    TINDERBOX: 590,
    FINE_CLOTH: 3470,
    SWAMP_PASTE: 1941,
    PYRE_EMPTY: 4093,
    PYRE_LOGS: 4099,
    PYRE_BONES: 4105,
    ENTRANCE_LEFT: 4132,
    ENTRANCE_RIGHT: 4133
} as const;

export const SHADE_TIERS = [
    { name: 'Loar', remains: 3396, shadow: 1240, shade: 1241, accessTier: -1 },
    { name: 'Phrin', remains: 3398, shadow: 1243, shade: 1244, accessTier: 0 },
    { name: 'Riyl', remains: 3400, shadow: 1245, shade: 1246, accessTier: 1 },
    { name: 'Asyn', remains: 3402, shadow: 1247, shade: 1248, accessTier: 2 },
    { name: 'Fiyr', remains: 3404, shadow: 1249, shade: 1250, accessTier: 3 }
] as const;

const METALS = ['bronze', 'steel', 'black', 'silver'] as const;
const COLOURS = ['red', 'brown', 'crimson', 'black', 'purple'] as const;

export const KEY_CHESTS = METALS.flatMap((metal, tier) => COLOURS.map((colour, trim) => ({
    id: 3450 + tier * 5 + trim,
    chestId: 4111 + tier * 5 + trim,
    tier,
    metal,
    colour
})));

export const chestForKey = (id: number) => KEY_CHESTS.find(key => key.id === id) ?? null;
export const keyTier = (id: number): number => chestForKey(id)?.tier ?? -1;

export function reserveKey(counts: ReadonlyMap<number, number>): number | null {
    return [...KEY_CHESTS].reverse().find(key => (counts.get(key.id) ?? 0) > 0)?.id ?? null;
}

export function spendableKeys(counts: ReadonlyMap<number, number>): { id: number; count: number }[] {
    const reserved = reserveKey(counts);
    return KEY_CHESTS.flatMap(key => {
        const count = (counts.get(key.id) ?? 0) - Number(key.id === reserved);
        return count > 0 ? [{ id: key.id, count }] : [];
    });
}
