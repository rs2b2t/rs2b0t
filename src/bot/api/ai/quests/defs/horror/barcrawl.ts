import { BARCRAWL_GP } from '../../barcrawl/BarcrawlLogic.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { HD_ID, HD_ITEM } from './areas.js';

// Why: this is the quest's side of Alfred Grimhand's Barcrawl — the tour itself is a miniquest of its own and lives in `src/bot/api/ai/quests/barcrawl/`, where the standalone script runs it too.
// Why: all this quest adds is the coin provisioning, which has to be a `QuestStep` so the engine banks for it.

export { BARCRAWL_GP };

/** Coin cover for the tour, drawn before the walk rather than at the tenth bar. */
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
