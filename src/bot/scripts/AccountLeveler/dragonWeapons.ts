import { DRAGON_WEAPONS } from './equipment.js';
import { purchaseBudget, supplyOffer } from './offers.js';
import { SHOPPING_RESERVE, type SupplyAudit } from './shopping.js';
import { stockOf, type LevelerSnapshot, type Requirement } from './types.js';

export const DRAGON_SHOP_COOLDOWN = 'quest-zanaris-weapons';

export function zanarisExitNeeds(s: LevelerSnapshot): Requirement[] | null {
    if (s.levels.magic >= 25 && stockOf(s, 'Law rune') > 0) return [
        { item: 'Law rune', count: 1 }, { item: 'Air rune', count: 3 }, { item: 'Fire rune', count: 1 }
    ];
    if (stockOf(s, 'Diamond') > 0) return [{ item: 'Diamond', count: 1 }];
    if (s.levels.crafting >= 43 && stockOf(s, 'Uncut diamond') > 0) return [
        { item: 'Chisel', count: 1 }, { item: 'Uncut diamond', count: 1 }
    ];
    return null;
}

export function auditDragonWeapons(s: LevelerSnapshot): SupplyAudit {
    const gold = stockOf(s, 'Coins');
    const result: SupplyAudit = { needs: [], budget: 0, reserve: Math.min(gold, Math.max(SHOPPING_RESERVE, Math.floor(gold / 10))), skipped: [] };
    if (!s.bankReady || s.levels.attack < 60 || !s.quests['Lost City']) return result;
    const missing = DRAGON_WEAPONS.filter(item => stockOf(s, item) === 0);
    if (!missing.length) return result;
    if (!stockOf(s, 'Dramen staff')) return { ...result, skipped: ['Dragon weapons: need a Dramen staff for Zanaris'] };
    const cut = !stockOf(s, 'Diamond') && s.levels.crafting >= 43 && stockOf(s, 'Uncut diamond') > 0;
    if (!stockOf(s, 'Diamond') && !cut) return { ...result, skipped: ['Dragon weapons: need a Diamond, or Crafting 43 and an Uncut diamond, for the marketplace tax'] };
    for (const item of [...(cut && !stockOf(s, 'Chisel') ? ['Chisel'] : []), ...missing]) {
        if (s.unavailableItems?.some(unavailable => unavailable.toLowerCase() === item.toLowerCase())) {
            result.skipped.push(`Dragon weapons: ${item} supplier is cooling down`);
            continue;
        }
        const budget = purchaseBudget(supplyOffer(item)!, 1);
        if (result.budget + budget > gold - result.reserve) {
            result.skipped.push(`Dragon weapons: cannot budget ${item} (${budget} coins)`);
            continue;
        }
        result.needs.push({ item, count: 1 });
        result.budget += budget;
    }
    if (!result.needs.some(need => DRAGON_WEAPONS.includes(need.item)) || cut && !stockOf(s, 'Chisel') && !result.needs.some(need => need.item === 'Chisel')) {
        result.needs = [];
        result.budget = 0;
    }
    return result;
}
