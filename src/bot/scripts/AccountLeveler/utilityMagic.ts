import { MARKET_PRICES } from '../../data/marketprices.js';
import { ALCH_ITEMS, CUSTOM_ALCH_KEY, DEFAULT_ALCH_ITEMS, HIGH_ALCH_LEVEL, HIGH_ALCH_FIRES, customAlchItem, type AlchItem } from '../../api/magic/alchemy.js';
import { FIRE_STAFF, NATURE_RUNE, pickFireStaff } from '../../api/magic/fireStaves.js';
import { superheatBatchSize, MAGIC_REQUIRED, SUPERHEAT_FIRES } from '../../api/magic/superheat.js';
import { oreQuantities, RECIPES } from '../../data/smelting.js';
import { purchaseBudget, shoppingReserve, supplyOffer } from './offers.js';
import { requirementKey, stockOf, type ActivityPlan, type LevelerSnapshot, type Requirement } from './types.js';

const marketItems = ALCH_ITEMS.filter(item => DEFAULT_ALCH_ITEMS.includes(item.key));
const bankItems = [...marketItems, ...['maple_longbow', 'iron_platebody', 'hardleather_body'].map(key => customAlchItem(key)!)];
const fireValue = MARKET_PRICES.find(row => row.name === 'Fire rune')!.mid;
const staffBudget = purchaseBudget(supplyOffer(FIRE_STAFF)!, 1);
const natureValue = MARKET_PRICES.find(row => row.name === NATURE_RUNE)!.mid;

function fodder(item: AlchItem): Requirement {
    const ambiguous = item.key.includes('dragonhide') || item.key.endsWith('_longbow');
    return { item: item.name, count: 1, ...(ambiguous ? { id: item.id } : {}) };
}

export function utilityMagicPlan(s: LevelerSnapshot, objective: string): ActivityPlan | null {
    const natures = stockOf(s, NATURE_RUNE);
    if (!natures || s.levels.magic < MAGIC_REQUIRED) return null;
    const staff = pickFireStaff(name => stockOf(s, name) > 0
        && (name === FIRE_STAFF || s.levels.attack >= (name.startsWith('Mystic') ? 40 : 30)));
    const coins = stockOf(s, 'Coins');
    const reserve = shoppingReserve(coins);
    const fires = stockOf(s, 'Fire rune');
    const buyStaff = coins - reserve >= staffBudget && !s.unavailableItems?.includes(FIRE_STAFF.toLowerCase());
    const fuel = (perCast: number) => {
        const useFireRunes = !staff && fires >= perCast;
        const casts = useFireRunes ? Math.min(natures, Math.floor(fires / perCast)) : staff || buyStaff ? natures : 0;
        const needs = (count: number): Requirement[] => [{ item: NATURE_RUNE, count }, useFireRunes
            ? { item: 'Fire rune', count: perCast * count }
            : { item: staff ?? FIRE_STAFF, count: 1, carry: 1, equip: true }];
        return { casts, useFireRunes, needs };
    };
    const alch = fuel(HIGH_ALCH_FIRES);
    const alchemy = objective === 'magic' && s.levels.magic >= HIGH_ALCH_LEVEL;
    if (alchemy && alch.casts) {
        for (const item of bankItems) {
            const need = fodder(item);
            const count = Math.min(alch.casts, stockOf(s, requirementKey(need)), 100);
            if (!count) continue;
            const selection = ALCH_ITEMS.includes(item) ? { items: [item.key] } : { items: [CUSTOM_ALCH_KEY], customItem: item.key };
            return { id: 'high-alchemy', label: 'High alchemy on ' + item.label, objective, script: 'Alcher',
                settings: { spell: 'High', ...selection, alchs: count, useFireRunes: alch.useFireRunes }, needs: [...alch.needs(count), { ...need, count }] };
        }
    }
    const heat = fuel(SUPERHEAT_FIRES);
    for (const recipe of RECIPES.toReversed()) {
        if (s.levels.smithing < recipe.level) continue;
        const count = superheatBatchSize(recipe, heat.casts, heat.useFireRunes, ore => stockOf(s, ore));
        if (!count) continue;
        return { id: 'superheat-' + recipe.bar.toLowerCase(), label: 'Superheat ' + recipe.bar + ' bars', objective, script: 'Superheater',
            settings: { bar: recipe.bar, useFireRunes: heat.useFireRunes, goldsmithGauntlets: recipe.bar === 'Gold' && stockOf(s, 'Goldsmith gauntlet') > 0 },
            needs: [...heat.needs(count), ...oreQuantities(recipe, count).map(({ ore, count }) => ({ item: ore, count }))] };
    }
    if (!alchemy || !alch.casts || !s.marketItem) return null;
    const keep = reserve + (!staff && !alch.useFireRunes ? staffBudget : 0);
    if (coins <= keep) return null;
    const runeCost = natureValue + (alch.useFireRunes ? HIGH_ALCH_FIRES * fireValue : 0);
    for (const item of marketItems) {
        const maxUnitPrice = Math.min(coins - keep, item.alchValue - runeCost);
        if (maxUnitPrice < 1) continue;
        const count = Math.min(100, alch.casts, Math.floor((coins - keep) / maxUnitPrice));
        const output = { item: item.name, id: item.id, count };
        if (s.marketItem(output) !== item.id) continue;
        return { id: 'seers-market-' + item.id, label: 'Buy ' + item.label + ' for high alchemy', objective, script: 'SeersMarket',
            settings: { maxUnitPrice, reserve: keep }, needs: [], output };
    }
    return null;
}
