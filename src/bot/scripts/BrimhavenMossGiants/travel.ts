import { EventSignal } from '../../api/execution/EventSignal.js';
import { atField, walkToField } from './shared.js';
import { Phase, getPhase } from './phase.js';
import type { Task } from '../../api/bot/Bot.js';
import type BrimhavenMossGiants from './BrimhavenMossGiants.js';

// TRAVEL-phase task: reach the Brimhaven field via the Ardougne↔Brimhaven boat (fare withdrawn in bankRoutine).
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
