export const COSMIC = 'Cosmic rune';
export const PACK = 28;

export interface Rune {
    rune: string;
    count: number;
}

export interface Spell {
    level: number;
    /** The action text of the spellbook button, what `Game.castOnItem` matches. */
    name: string;
    magic: number;
    xp: number;
    elements: readonly Rune[];
}

const spell = (level: number, magic: number, xp: number, elements: readonly Rune[]): Spell => ({ level, name: `Enchant Lvl-${level} Jewelry`, magic, xp, elements });

/** The five enchants of `magic_spells.dbrow`, each with the cosmic rune left implicit. */
export const SPELLS: readonly Spell[] = [
    spell(1, 7, 17.5, [{ rune: 'Water rune', count: 1 }]),
    spell(2, 27, 37, [{ rune: 'Air rune', count: 3 }]),
    spell(3, 49, 59, [{ rune: 'Fire rune', count: 5 }]),
    spell(4, 57, 67, [{ rune: 'Earth rune', count: 10 }]),
    spell(5, 68, 78, [{ rune: 'Earth rune', count: 15 }, { rune: 'Water rune', count: 15 }])
];

export interface Jewel {
    label: string;
    /** The obj id, since a strung amulet shares its display name with the unstrung one. */
    id: number;
    name: string;
    product: string;
    spell: Spell;
}

const jewel = (label: string, id: number, product: string, level: number, name = label): Jewel => ({ label, id, name, product, spell: SPELLS[level - 1]! });

/** Every `convertobj` row of the enchant spells; the other necklaces have no enchant in this content. */
export const JEWELS: readonly Jewel[] = [
    jewel('Sapphire ring', 1637, 'Ring of recoil', 1),
    jewel('Sapphire necklace', 1656, 'Games necklace(8)', 1),
    jewel('Sapphire amulet', 1694, 'Amulet of magic', 1),
    jewel('Emerald ring', 1639, 'Ring of dueling(8)', 2),
    jewel('Emerald amulet', 1696, 'Amulet of defence', 2),
    jewel('Ruby ring', 1641, 'Ring of forging', 3),
    jewel('Ruby amulet', 1698, 'Amulet of strength', 3),
    jewel('Diamond ring', 1643, 'Ring of life', 4),
    jewel('Diamond amulet', 1700, 'Amulet of power', 4),
    jewel('Dragonstone ring', 1645, 'Ring of wealth', 5),
    jewel('Dragonstone amulet', 1702, 'Amulet of glory', 5, 'Dragonstoneamulet')
];

export const JEWEL_OPTIONS = JEWELS.map(j => j.label);

export function jewelByName(name: string): Jewel | null {
    const want = name.trim().toLowerCase();
    return JEWELS.find(j => j.label.toLowerCase() === want || j.name.toLowerCase() === want) ?? null;
}

/** The staves the spellbook button accepts in place of each element rune. */
export const STAFFS: Record<string, readonly string[]> = {
    'Water rune': ['Staff of water', 'Water battlestaff', 'Mystic water staff'],
    'Air rune': ['Staff of air', 'Air battlestaff', 'Mystic air staff'],
    'Fire rune': ['Staff of fire', 'Fire battlestaff', 'Mystic fire staff'],
    'Earth rune': ['Staff of earth', 'Earth battlestaff', 'Mystic earth staff']
};

const covered = (rune: string, wielded: readonly string[]): boolean => (STAFFS[rune] ?? []).some(s => wielded.includes(s));

/** What one cast takes from the pack with these items worn. */
export function runesPerCast(j: Jewel, wielded: readonly string[]): Rune[] {
    return [{ rune: COSMIC, count: 1 }, ...j.spell.elements.filter(e => !covered(e.rune, wielded))];
}

export function castsAffordable(j: Jewel, wielded: readonly string[], held: (rune: string) => number): number {
    return Math.min(...runesPerCast(j, wielded).map(r => Math.floor(held(r.rune) / r.count)));
}

/** Pack slots left for jewels once every rune the cast needs has a stack. */
export function jewelSlots(j: Jewel, wielded: readonly string[]): number {
    return PACK - runesPerCast(j, wielded).length;
}

export interface PackState {
    jewels: number;
    casts: number;
}

export type Step = { kind: 'cast' } | { kind: 'bank' };

/** One step per loop, read off the pack alone so a restart lands on the same choice. */
export function decide(pack: PackState): Step {
    return pack.jewels > 0 && pack.casts > 0 ? { kind: 'cast' } : { kind: 'bank' };
}

export interface Counts {
    jewels: number;
    rune(name: string): number;
}

export type Plan = { ok: true; jewels: number; runes: Rune[] } | { ok: false; reason: string };

/** What a bank visit withdraws, sized by the free slots and the scarcest of jewels and runes, or why the run has to stop. */
export function tripPlan(j: Jewel, wielded: readonly string[], pack: Counts, bank: Counts): Plan {
    const perCast = runesPerCast(j, wielded);
    const room = Math.max(0, jewelSlots(j, wielded) - pack.jewels);
    const fundable = Math.min(...perCast.map(r => Math.floor((pack.rune(r.rune) + bank.rune(r.rune)) / r.count)));
    const total = Math.min(pack.jewels + Math.min(room, bank.jewels), fundable);
    if (total < 1) {
        if (pack.jewels + bank.jewels < 1) {
            return { ok: false, reason: `the bank has no ${j.label}` };
        }
        const short = perCast.find(r => pack.rune(r.rune) + bank.rune(r.rune) < r.count)!;
        return { ok: false, reason: `the bank has no ${short.rune}` };
    }
    const runes = perCast.map(r => ({ rune: r.rune, count: total * r.count - pack.rune(r.rune) })).filter(r => r.count > 0);
    return { ok: true, jewels: Math.max(0, total - pack.jewels), runes };
}

/** A banked staff that covers one of the spell's elements, or null. */
export function staffFor(j: Jewel, stock: (name: string) => number): string | null {
    for (const e of j.spell.elements) {
        const hit = (STAFFS[e.rune] ?? []).find(s => stock(s) > 0);
        if (hit) {
            return hit;
        }
    }
    return null;
}
