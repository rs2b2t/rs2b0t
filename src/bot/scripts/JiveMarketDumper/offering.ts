import { reader } from '../../adapter/ClientAdapter.js';
import { Execution } from '../../api/execution/Execution.js';
import { offersMatch } from '../../api/market/driveMarketTrade.js';
import { Trade } from '../../api/trade/Trade.js';
import { itemCounts, type Dumpable } from './logic.js';

const ITEMS_PER_BATCH = 5;

export async function offerPile(pile: readonly Dumpable[]): Promise<boolean> {
    if (!pile.length || !Trade.onOfferScreen()) return false;
    const available = itemCounts([...reader.tradeSidePack(), ...Trade.myOffer()]);
    const expected = new Map<number, number>();
    for (const line of pile) {
        const ids = line.notedId === null ? [line.id] : [line.id, line.notedId];
        let total = 0;
        for (const id of ids) {
            const count = available.get(id) ?? 0;
            if (count) expected.set(id, count);
            total += count;
        }
        if (total !== line.count) return false;
    }

    while (Trade.onOfferScreen()) {
        const offered = itemCounts(Trade.myOffer());
        if (offersMatch(offered, expected)) return true;
        const pack = reader.tradeSidePack();
        const held = itemCounts(pack);
        const batch: number[] = [];
        for (const [id, count] of expected) {
            const missing = count - (offered.get(id) ?? 0);
            if (missing <= 0 || held.get(id) !== missing) continue;
            const slot = pack.find(item => item.id === id);
            if (!slot?.name || !(await Trade.offerAll(slot.name, item => item.id === id))) return false;
            batch.push(id);
            if (batch.length === ITEMS_PER_BATCH) break;
        }
        if (!batch.length) return false;
        const landed = () => {
            const current = itemCounts(Trade.myOffer());
            return batch.every(id => current.get(id) === expected.get(id));
        };
        await Execution.delayUntilTicks(() => !Trade.onOfferScreen() || landed(), 2);
        const current = itemCounts(Trade.myOffer());
        if (!batch.some(id => (current.get(id) ?? 0) > (offered.get(id) ?? 0))) return false;
    }
    return false;
}
