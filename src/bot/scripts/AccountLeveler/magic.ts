import { canStealChaos } from './runes.js';
import { SPELL_DB } from '../../data/spelldb.js';
import { consumableBatch } from './catalog.js';
import { purchaseBudget, supplyOffer } from './offers.js';
import { stockOf, type LevelerSnapshot, type Requirement } from './types.js';

export function magicEquipment(s: LevelerSnapshot): { spell: string; needs: Requirement[]; casts: number } {
    const options = Object.entries(SPELL_DB).filter(([name, row]) => row.level <= s.levels.magic && /Strike|Bolt/.test(name)).reverse().map(([spell, row]) => {
        const supply = canStealChaos(s) ? { ...s, stock: { ...s.stock, 'chaos rune': Math.max(200, stockOf(s, 'Chaos rune')) } } : s;
        const runes = consumableBatch(supply, row.runes.filter(r => r.rune !== 'Air rune').map(r => ({ item: r.rune, count: r.count })), 200, 150);
        const needs = [{ item: 'Staff of air', count: 1, carry: 1, equip: true }, ...runes];
        const budget = needs.reduce((sum, n) => {
            const missing = Math.max(0, n.count - stockOf(s, n.item));
            if (!missing || n.item === 'Chaos rune' && canStealChaos(s)) return sum;
            if (s.unavailableItems?.some(item => item.toLowerCase() === n.item.toLowerCase())) return Infinity;
            const offer = supplyOffer(n.item);
            return sum + (offer ? purchaseBudget(offer, missing) : Infinity);
        }, 0);
        return { spell, needs, casts: runes[0].carry! / runes[0].minimum!, budget };
    });
    const selected = (canStealChaos(s) ? options.find(option => option.spell.includes('Bolt') && option.budget + 200 <= stockOf(s, 'Coins')) : undefined)
        ?? options.find(option => option.budget === 0)
        ?? options.find(option => option.budget + 200 <= stockOf(s, 'Coins'))
        ?? options.find(option => option.spell === 'Wind Strike');
    if (!selected) throw new Error('Magic level has not loaded');
    return { spell: selected.spell, needs: selected.needs, casts: selected.casts };
}
