import { SPELL_DB, STAFF_RUNES, type SpellRow } from '#/bot/api/combat/data/spelldb.js';

const STAFF_SPELLS_COM0 = 1830;
export const AUTO_CHOOSE_COM = 353;
export const AUTO_TOGGLE_COM = 349;
export const ATTACKSTYLE_MAGIC_VARP = 108;
export const AUTOCAST_ARMED = 3;

function spellRow(spellName: string): SpellRow | null {
    const wanted = spellName.trim().toLowerCase();
    for (const [name, row] of Object.entries(SPELL_DB)) {
        if (name.toLowerCase() === wanted) {
            return row;
        }
    }
    return null;
}

function providedRunes(wielded: string[]): Set<string> {
    const provided = new Set<string>();
    for (const item of wielded) {
        const runes = Object.entries(STAFF_RUNES).find(([staff]) => staff.toLowerCase() === item.toLowerCase())?.[1] ?? [];
        for (const rune of runes) {
            provided.add(rune.toLowerCase());
        }
    }
    return provided;
}

export function runesPerCast(spellName: string, wielded: string[]): { rune: string; count: number }[] | null {
    const row = spellRow(spellName);
    if (!row) {
        return null;
    }
    const provided = providedRunes(wielded);
    return row.runes.filter(r => !provided.has(r.rune.toLowerCase())).map(r => ({ ...r }));
}

export function spellButtonCom(spellName: string): number {
    const row = spellRow(spellName);
    return row ? STAFF_SPELLS_COM0 + row.ssb : -1;
}

export function castsAvailable(spellName: string, wielded: string[], held: (rune: string) => number): number {
    const costs = runesPerCast(spellName, wielded);
    if (!costs || costs.length === 0) {
        return costs ? Number.POSITIVE_INFINITY : 0;
    }
    return Math.min(...costs.map(c => Math.floor(held(c.rune) / c.count)));
}

export function runeWithdrawList(spellName: string, wielded: string[], casts: number): { rune: string; count: number }[] {
    return (runesPerCast(spellName, wielded) ?? []).map(c => ({ rune: c.rune, count: c.count * casts }));
}
