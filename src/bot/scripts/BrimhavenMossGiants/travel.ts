import { EventSignal } from '../../api/execution/EventSignal.js';
import { atField, walkToField } from './shared.js';
import { Phase, getPhase } from './phase.js';
import type { Task } from '../../api/bot/Bot.js';
import type BrimhavenMossGiants from './BrimhavenMossGiants.js';

/**
 * High-level "get to the Brimhaven field" task (TRAVEL phase) — runs when the
 * director has decided we should be at the field. The walk crosses the
 * Ardougne↔Brimhaven boat via the web-walker; coins for the fare are withdrawn
 * in bankRoutine.
 */
export class TravelToField implements Task {
    constructor(private bot: BrimhavenMossGiants) {}
    validate(): boolean {
        return getPhase() === Phase.Travel && !EventSignal.pending() && !atField();
    }
    async execute(): Promise<void> {
        if (EventSignal.pending()) {
            return;
        }
        await walkToField(this.bot);
    }
}
