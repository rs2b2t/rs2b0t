import { bankTeleportSpec, bankTeleportSupplies } from '../../api/bank/BankTeleport.js';
import { purchaseBudget, supplyOffer } from './offers.js';
import { stockOf, type LevelerSnapshot, type Requirement } from './types.js';

export function dragonTeleport(s: LevelerSnapshot, site: 'wilderness' | 'blue' | 'red'): { name: string; needs: Requirement[] } {
    const names = site === 'wilderness' ? ['Varrock'] : site === 'blue' ? ['Falador'] : ['Ardougne', 'Camelot', 'Falador'];
    const name = names.find(name => {
        const spell = bankTeleportSpec(name)!;
        return (spell.requires?.skills ?? []).every(skill => s.levels[skill.name] >= skill.level)
            && (spell.requires?.quests ?? []).every(quest => s.quests[quest.quest]);
    }) ?? 'Off';
    if (name === 'Off') return { name, needs: [] };
    const runes = bankTeleportSupplies(name);
    const law = runes.find(need => need.item === 'Law rune')!;
    const craft = s.levels.runecraft >= 54 && s.quests['Rune Mysteries Quest'] && stockOf(s, 'Law talisman') > 0;
    const casts = craft ? 3 : Math.min(3, Math.floor(stockOf(s, 'Law rune') / law.count));
    if (!casts) return { name, needs: [] };
    let cost = 0;
    const needs = runes.map(need => ({ item: need.item, count: need.count * casts, carry: need.count * casts }));
    for (const need of needs) {
        const missing = Math.max(0, need.count - stockOf(s, need.item));
        if (!missing || need.item === 'Law rune' && craft) continue;
        const offer = supplyOffer(need.item);
        if (!offer || s.unavailableItems?.includes(need.item.toLowerCase())) return { name, needs: [] };
        cost += purchaseBudget(offer, missing);
    }
    return { name, needs: cost <= Math.max(0, stockOf(s, 'Coins') - 200) ? needs : [] };
}
