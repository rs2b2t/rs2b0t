import type { QuestModule } from '../engine/types.js';
import { runemysteries } from './runemysteries.js';

/** Implemented quests, in RUN ORDER (cheapest/most-certain first). */
export const QUEST_DEFS: QuestModule[] = [runemysteries];

export function defById(id: string): QuestModule | undefined {
    return QUEST_DEFS.find(d => d.record.id === id);
}
