import { EventSignal } from '../../../execution/EventSignal.js';
import { Execution } from '../../../execution/Execution.js';
import { Game } from '../../../game/Game.js';
import type { QuestModule, QuestSnapshot } from './types.js';

export async function prepareQuestRetaliation(module: QuestModule, snap: QuestSnapshot): Promise<boolean> {
    if (EventSignal.pending()) return false;
    const wanted = typeof module.autoRetaliate === 'function' ? module.autoRetaliate(snap) : module.autoRetaliate ?? true;
    if (Game.autoRetaliateOn() === wanted) return true;
    if (!Game.setAutoRetaliate(wanted)) return false;
    return await Execution.delayUntilTicks(() => Game.autoRetaliateOn() === wanted, 5) && !EventSignal.pending();
}
