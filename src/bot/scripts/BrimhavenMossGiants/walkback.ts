import { Execution } from '../../api/execution/Execution.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { atField, walkToField } from './shared.js';
import type BrimhavenMossGiants from './BrimhavenMossGiants.js';

/**
 * Walk back into the field during a fight when the bot drifts out of the
 * FIELD_RADIUS (multicombat can shove it around). Used directly inside the
 * Fight loop so it never yields the bot to another task mid-swing.
 */
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
