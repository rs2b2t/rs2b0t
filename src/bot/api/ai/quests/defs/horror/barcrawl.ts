import { BARCRAWL_GP } from '../../barcrawl/BarcrawlLogic.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { HD_ID, HD_ITEM } from './areas.js';

// Why: the tour itself lives in `src/bot/api/ai/quests/barcrawl/`; this only adds the coin provisioning as a `QuestStep` so the engine banks for it.

export { BARCRAWL_GP };

/** Coin cover for the tour, drawn before the walk. */
export function barcrawlFunds(snap: QuestSnapshot): QuestStep | null {
    if ((snap.invIds?.get(HD_ID.COINS) ?? 0) >= BARCRAWL_GP) {
        return null;
    }
    if (!snap.bankKnown) {
        return { kind: 'scanBank' };
    }
    return {
        kind: 'withdraw',
        items: [{ name: HD_ITEM.COINS, qty: BARCRAWL_GP * 4, id: HD_ID.COINS }]
    };
}
