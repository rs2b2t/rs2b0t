import { GameMessages } from '../chatbox/gameMessages.js';
import { EventSignal } from '../execution/EventSignal.js';
import { Execution } from '../execution/Execution.js';
import { Game } from '../game/Game.js';
import { Inventory } from '../inventory/Inventory.js';
import { Skills } from '../skills/Skills.js';
import {
    CANT_LIGHT,
    FIRE_LIGHT_TICKS,
    FIRE_START_TICKS,
    TINDERBOX,
    type LightOutcome
} from './Firemaking.js';

/**
 * One light attempt on the tile the player is standing on.
 * `blocked` is the game refusing the tile, `stalled` is the attempt going unanswered.
 * @see docs/reference/api-skills.md#firemaking
 */
export async function lightFire(logName: string): Promise<LightOutcome> {
    const logs = Inventory.first(logName);
    const tinder = Inventory.first(TINDERBOX);
    if (!logs || !tinder) {
        return 'stalled';
    }
    const mark = GameMessages.mark();
    const xp = Skills.xp('firemaking');
    const held = Inventory.count(logName);
    const lit = (): boolean => Skills.xp('firemaking') > xp;
    const blocked = (): boolean => GameMessages.sawSince(mark, CANT_LIGHT);

    // Use tinderbox → logs (same order as working quest/FM paths). Logs→tinderbox is a no-op.
    if (!(await tinder.useOn(logs))) {
        return 'stalled';
    }
    if (
        !(await Execution.delayUntilTicks(
            () => Inventory.count(logName) < held || blocked() || Game.animating(),
            FIRE_START_TICKS
        ))
    ) {
        return 'stalled';
    }
    if (
        !(await Execution.delayUntilTicks(
            () => lit() || blocked() || EventSignal.pending(),
            FIRE_LIGHT_TICKS
        ))
    ) {
        return 'stalled';
    }
    return blocked() ? 'blocked' : lit() ? 'lit' : 'stalled';
}
