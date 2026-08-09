/**
 * Pure data and decisions for the GemCutter script.
 * Matches gems by numeric id — every uncut gem has a distinct id.
 */

export const CHISEL_ID = 1755;

export interface GemDef {
    key: string;
    name: string;
    uncutId: number;
    cutId: number;
    level: number;
    xp: number;
    canCrush: boolean;
}

export const GEMS: readonly GemDef[] = [
    { key: 'sapphire', name: 'Sapphire', uncutId: 1623, cutId: 1607, level: 20, xp: 500, canCrush: false },
    { key: 'emerald', name: 'Emerald', uncutId: 1621, cutId: 1605, level: 27, xp: 675, canCrush: false },
    { key: 'ruby', name: 'Ruby', uncutId: 1619, cutId: 1603, level: 34, xp: 850, canCrush: false },
    { key: 'diamond', name: 'Diamond', uncutId: 1617, cutId: 1601, level: 43, xp: 1075, canCrush: false },
    { key: 'dragonstone', name: 'Dragonstone', uncutId: 1631, cutId: 1615, level: 55, xp: 1375, canCrush: false },
    { key: 'opal', name: 'Opal', uncutId: 1625, cutId: 1609, level: 1, xp: 150, canCrush: true },
    { key: 'jade', name: 'Jade', uncutId: 1627, cutId: 1611, level: 13, xp: 200, canCrush: true },
    { key: 'red_topaz', name: 'Red topaz', uncutId: 1629, cutId: 1613, level: 16, xp: 250, canCrush: true },
];

export const GEM_OPTIONS = GEMS.map(g => g.name);

export function gemById(id: number): GemDef | null {
    return GEMS.find(g => g.uncutId === id || g.cutId === id) ?? null;
}

export function gemByUncutId(id: number): GemDef | null {
    return GEMS.find(g => g.uncutId === id) ?? null;
}

export function gemByCutId(id: number): GemDef | null {
    return GEMS.find(g => g.cutId === id) ?? null;
}

/**
 * The gems the player can cut this run: those the player's Crafting level
 * allows, restricted to `selected` when a non-empty selection is given.
 * Returned lowest-level first so cheap XP comes before expensive.
 */
export function eligibleGems(craftingLevel: number, selected: readonly string[]): GemDef[] {
    return GEMS
        .filter(g => g.level <= craftingLevel)
        .filter(g => selected.length === 0 || selected.some(s => s.toLowerCase() === g.name.toLowerCase()))
        .sort((a, b) => a.level - b.level);
}



export const CRUSHED_GEMSTONE_ID = 1633;