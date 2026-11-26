import { GEMS, type GemDef } from '../../data/gems.js';

export { GEMS, gemByCutId, gemById, gemByUncutId, type GemDef } from '../../data/gems.js';

export const CHISEL_ID = 1755;
export const CRUSHED_GEMSTONE_ID = 1633;
export const GEM_OPTIONS = GEMS.map(g => g.name);

// Why: the list comes back lowest-level first, so cheap XP precedes expensive.

/** The gems the player can cut this run: those Crafting allows, restricted to `selected` when non-empty. */
export function eligibleGems(craftingLevel: number, selected: readonly string[]): GemDef[] {
    return GEMS
        .filter(g => g.level <= craftingLevel)
        .filter(g => selected.length === 0 || selected.some(s => s.toLowerCase() === g.name.toLowerCase()))
        .sort((a, b) => a.level - b.level);
}
