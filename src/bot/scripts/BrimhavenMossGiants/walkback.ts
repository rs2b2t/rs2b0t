import { Execution } from '../../api/execution/Execution.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { atField, walkToField } from './shared.js';
import type BrimhavenMossGiants from './BrimhavenMossGiants.js';

// Re-enter the field mid-fight after drifting past FIELD_RADIUS.
export async function quickReturnToField(bot: BrimhavenMossGiants): Promise<boolean> {
    bot.setStatus('returning to the field');
    for (let i = 0; i < 3 && !atField() && !EventSignal.pending(); i++) {
        await walkToField(bot);
        if (await Execution.delayUntil(() => atField(), 4000)) {
            break;
        }
    }
    return atField();
}
