import { HERBS, type HerbDef } from '../../data/herbs.js';
export { HERBS, HERB_OPTIONS, type HerbDef } from '../../data/herbs.js';

// Pure data and decisions for the HerbCleaner script.

// Why: 2004scape unids all render as the same display name ("Unidentified herb"), so matches go through the numeric id, never the name.
// Why: `unidId` is the grimy or unidentified form and `id` is the cleaned form.

/** How the bot cleans a grimy herb (the first/held op; same as RoguesPurse). */
export const IDENTIFY_OP = 'Identify';

export function herbById(id: number): HerbDef | null {
    return HERBS.find(h => h.unidId === id || h.id === id) ?? null;
}

export function herbByCleanId(id: number): HerbDef | null {
    return HERBS.find(h => h.id === id) ?? null;
}

export function herbByUnidId(id: number): HerbDef | null {
    return HERBS.find(h => h.unidId === id) ?? null;
}

// Why: the list comes back lowest-level first, so cheap identify XP precedes expensive.

/** The herbs the player can clean this run: those Herblore allows, restricted to `selected` when non-empty. */
export function eligibleHerbs(herbloreLevel: number, selected: readonly string[]): HerbDef[] {
    return HERBS
        .filter(h => h.level <= herbloreLevel)
        .filter(h => selected.length === 0 || selected.some(s => s.toLowerCase() === h.name.toLowerCase()))
        .sort((a, b) => a.level - b.level);
}

/** Chat refusal from the engine when Herblore is below the herb's level, or the world is non-members. */
export const CANNOT_IDENTIFY = /you cannot identify this herb|need to be on a members['’]? world/i;