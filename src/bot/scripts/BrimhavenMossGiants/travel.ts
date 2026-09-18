import { EventSignal } from '../../api/execution/EventSignal.js';
import { atField, walkToField } from './shared.js';
import { Phase, getPhase } from './phase.js';
import type { Task } from '../../api/bot/Bot.js';
import type BrimhavenMossGiants from './BrimhavenMossGiants.js';

// Reach the Brimhaven field by boat; bankRoutine supplies the fare.
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
