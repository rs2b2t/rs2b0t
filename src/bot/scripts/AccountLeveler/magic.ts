import { SPELL_DB } from '../../data/spelldb.js';
import { purchaseBudget, supplyOffer } from './offers.js';
import { stockOf, type LevelerSnapshot, type Requirement } from './types.js';

export function magicEquipment(s: LevelerSnapshot): { spell: string; needs: Requirement[] } {
    const options = Object.entries(SPELL_DB).filter(([name, row]) => row.level <= s.levels.magic && /Strike|Bolt/.test(name)).reverse();
    for (const [spell, row] of options) {
        const needs = [{ item: 'Staff of air', count: 1, carry: 1, equip: true },
            ...row.runes.filter(r => r.rune !== 'Air rune').map(r => ({ item: r.rune, count: 200 * r.count, carry: 150 * r.count }))];
        const budget = needs.reduce((sum, n) => {
            const missing = Math.max(0, n.count - stockOf(s, n.item));
            if (!missing) return sum;
            if (s.unavailableItems?.includes(n.item.toLowerCase())) return Infinity;
            const offer = supplyOffer(n.item);
            return sum + (offer ? purchaseBudget(offer, missing) : Infinity);
        }, 0);
        if (budget === 0 || budget + 200 <= stockOf(s, 'Coins') || spell === 'Wind Strike') return { spell, needs };
    }
    throw new Error('Magic level has not loaded');
}
