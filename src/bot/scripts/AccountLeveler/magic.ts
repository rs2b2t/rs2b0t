import { runesPerCast } from '../../api/combat/CombatStyleLogic.js';
import { SPELL_DB } from '../../data/spelldb.js';
import { consumableBatch } from './catalog.js';
import { combatGauntlets } from './equipment.js';
import { purchaseBudget, supplyOffer } from './offers.js';
import { canStealChaos } from './runes.js';
import { stockOf, type LevelerSnapshot, type Requirement } from './types.js';

export const COMBAT_STAVES = ['Staff of fire', 'Staff of air'];

export function magicEquipment(s: LevelerSnapshot): { spell: string; needs: Requirement[]; casts: number } {
    const advanced = s.levels.magic >= 60;
    const stealChaos = canStealChaos(s);
    const supply = stealChaos ? { ...s, stock: { ...s.stock, 'chaos rune': Math.max(200, stockOf(s, 'Chaos rune')) } } : s;
    const coins = stockOf(s, 'Coins');
    const affordable = (budget: number) => budget === 0 || budget + 200 <= coins;
    const kitFor = (spell: string, staff: string, reserve = 200) => {
        const costs = runesPerCast(spell, [staff])!;
        const runes = consumableBatch(supply, costs.map(r => ({ item: r.rune, count: r.count })), reserve, 150);
        const needs = [{ item: staff, count: 1, carry: 1, equip: true }, ...runes];
        const budget = needs.reduce((sum, n) => {
            const missing = Math.max(0, n.count - stockOf(s, n.item));
            if (!missing || n.item === 'Chaos rune' && stealChaos) return sum;
            if (s.unavailableItems?.some(item => item.toLowerCase() === n.item.toLowerCase())) return Infinity;
            const offer = supplyOffer(n.item);
            return sum + (offer ? purchaseBudget(offer, missing) : Infinity);
        }, 0);
        return { spell, staff, needs, reserve: runes[0].count / runes[0].minimum!, casts: runes[0].carry! / runes[0].minimum!, budget };
    };
    const options = Object.entries(SPELL_DB)
        .filter(([name, row]) => row.level <= s.levels.magic && (/Strike|Bolt/.test(name) || advanced && /Blast/.test(name)))
        .reverse().flatMap(([spell]) => COMBAT_STAVES.map(staff => kitFor(spell, staff)));
    const ranked = (advanced ? options.find(option => option.spell.endsWith('Blast') && option.budget === 0) : undefined)
        ?? (stealChaos ? options.find(option => option.spell.endsWith('Bolt') && option.budget + 200 <= coins) : undefined)
        ?? options.find(option => option.budget === 0)
        ?? options.find(option => affordable(option.budget))
        ?? options.find(option => option.spell === 'Wind Strike' && option.staff === 'Staff of air');
    if (!ranked) throw new Error('Magic level has not loaded');
    const preferred = ranked.staff === 'Staff of fire' ? ranked : kitFor(ranked.spell, 'Staff of fire', ranked.reserve);
    const selected = affordable(preferred.budget) ? preferred : ranked;
    return { spell: selected.spell, needs: [...selected.needs, ...combatGauntlets(s)], casts: selected.casts };
}
