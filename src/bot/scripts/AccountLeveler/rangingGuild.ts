import { spotCrowded } from './crowding.js';
import { ARROW_RESTOCK_FEE, ENTRY_FEE, JUDGE_STAND, RANGED_REQUIRED } from '../RangingGuild/RangingGuildLogic.js';
import { equipmentPrice, rangedArmour, rangedBow } from './equipment.js';
import { SHOPPING_RESERVE } from './shopping.js';
import { stockOf, type ActivityPlan, type LevelerSnapshot, type SessionMemory } from './types.js';

export function rangingGuildPlan(s: LevelerSnapshot, memory: SessionMemory): ActivityPlan | null {
    if (s.levels.ranged < RANGED_REQUIRED || spotCrowded(JUDGE_STAND, memory, s.now) || (memory.cooldowns['ranging-guild'] ?? 0) > s.now) return null;
    const minimum = ENTRY_FEE + ARROW_RESTOCK_FEE + 2 * SHOPPING_RESERVE;
    const gold = stockOf(s, 'Coins');
    const gearBudget = { ...s, stock: { ...s.stock, coins: gold - minimum + SHOPPING_RESERVE } };
    const bow = rangedBow(gearBudget);
    const bowPrice = equipmentPrice(s, bow);
    if (Number.isFinite(bowPrice)) gearBudget.stock.coins -= bowPrice;
    else if (s.marketItem?.(bow) === undefined) return null;
    const gear = [bow, ...rangedArmour(gearBudget)];
    const prices = gear.map(need => equipmentPrice(s, need));
    const coins = prices.every(Number.isFinite) ? Math.min(10000, gold - prices.reduce((sum, price) => sum + price, 0)) : minimum;
    if (coins < minimum) return null;
    return {
        id: 'ranging-guild', label: 'Ranging Guild archery competition', objective: 'ranged', script: 'RangingGuild',
        settings: { coinsPerTrip: coins, coinsReserve: SHOPPING_RESERVE },
        needs: [{ item: 'Coins', count: coins, carry: coins }, ...gear], travel: JUDGE_STAND
    };
}
