import { ARROW_RESTOCK_FEE, ENTRY_FEE, JUDGE_STAND, RANGED_REQUIRED } from '../RangingGuild/RangingGuildLogic.js';
import { rangedBow } from './equipment.js';
import { purchaseBudget, supplyOffer } from './offers.js';
import { SHOPPING_RESERVE } from './shopping.js';
import { requirementKey, stockOf, type ActivityPlan, type LevelerSnapshot, type SessionMemory } from './types.js';

export function rangingGuildPlan(s: LevelerSnapshot, memory: SessionMemory): ActivityPlan | null {
    if (s.levels.ranged < RANGED_REQUIRED || (memory.cooldowns['ranging-guild'] ?? 0) > s.now) return null;
    const minimum = ENTRY_FEE + ARROW_RESTOCK_FEE + 2 * SHOPPING_RESERVE;
    const gold = stockOf(s, 'Coins');
    const bow = rangedBow({ ...s, stock: { ...s.stock, coins: Math.max(0, gold - minimum + SHOPPING_RESERVE) } });
    const owned = stockOf(s, requirementKey(bow)) > 0;
    if (!owned && s.unavailableItems?.some(item => [bow.item.toLowerCase(), requirementKey(bow)].includes(item.toLowerCase()))) return null;
    const offer = supplyOffer(bow.item);
    const cost = owned ? 0 : offer ? purchaseBudget(offer, 1) : Infinity;
    const coins = Math.min(10000, gold - cost);
    if (coins < minimum) return null;
    return {
        id: 'ranging-guild', label: 'Ranging Guild archery competition', objective: 'ranged', script: 'RangingGuild',
        settings: { coinsPerTrip: coins, coinsReserve: SHOPPING_RESERVE },
        needs: [{ item: 'Coins', count: coins, carry: coins }, bow], travel: JUDGE_STAND
    };
}
