/**
 * Pure spell/rune math for the mage combat style (no client imports — plain
 * `bun test`). Mirrors the engine's `~staff_runes` (skill_magic/magic.rs2):
 * a wielded staff from STAFF_RUNES zeroes its element's per-cast cost. All
 * name matching is case-insensitive display names, so bot settings and
 * Equipment/Inventory strings can be compared directly.
 */
import { SPELL_DB, STAFF_RUNES, type SpellRow } from '#/bot/api/combat/data/spelldb.js';

/** staff_spells:ssb0 component id — spell N's button is STAFF_SPELLS_COM0 + ssb. */
const STAFF_SPELLS_COM0 = 1830;
/** combat_staff_2:auto_choose — opens the staff_spells panel. */
export const AUTO_CHOOSE_COM = 353;
/** combat_staff_2:auto_toggle — arms autocast once a spell is chosen. */
export const AUTO_TOGGLE_COM = 349;
/** attackstyle_magic varp (transmit=yes): 3 = spell chosen + autocast armed. */
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

/** Runes provided free by any wielded item (lowercased display names). */
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

/** Per-cast rune costs for `spellName` while wielding `wielded`, with the
 *  staff's element removed. Null for a spell not in the autocast table. */
export function runesPerCast(spellName: string, wielded: string[]): { rune: string; count: number }[] | null {
    const row = spellRow(spellName);
    if (!row) {
        return null;
    }
    const provided = providedRunes(wielded);
    return row.runes.filter(r => !provided.has(r.rune.toLowerCase())).map(r => ({ ...r }));
}

/** The staff_spells button component id for `spellName`, or -1. */
export function spellButtonCom(spellName: string): number {
    const row = spellRow(spellName);
    return row ? STAFF_SPELLS_COM0 + row.ssb : -1;
}

/** Full casts affordable with the held rune counts (`held` = count by
 *  display name). 0 for an unknown spell. */
export function castsAvailable(spellName: string, wielded: string[], held: (rune: string) => number): number {
    const costs = runesPerCast(spellName, wielded);
    if (!costs || costs.length === 0) {
        return costs ? Number.POSITIVE_INFINITY : 0;
    }
    return Math.min(...costs.map(c => Math.floor(held(c.rune) / c.count)));
}

/** Runes to withdraw for `casts` casts (per-cast costs × casts). */
export function runeWithdrawList(spellName: string, wielded: string[], casts: number): { rune: string; count: number }[] {
    return (runesPerCast(spellName, wielded) ?? []).map(c => ({ rune: c.rune, count: c.count * casts }));
}
