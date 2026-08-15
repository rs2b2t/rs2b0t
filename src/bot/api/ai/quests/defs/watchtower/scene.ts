import { Execution } from '../../../../execution/Execution.js';
import { Locs } from '../../../../locs/Locs.js';

// Why: a blank Locs query is no evidence the loc is absent, so every scripted crossing in this quest settles before it decides anything is missing.

/**
 * Wait for scenery to exist again after a level change or teleport.
 * @see docs/decisions/level-change-lag.md
 */
export async function settleScene(within: number = 16): Promise<void> {
    await Execution.delayTicks(2);
    await Execution.delayUntil(() => Locs.query().within(within).count() > 0, 5000);
}
