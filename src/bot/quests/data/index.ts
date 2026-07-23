import type { QuestRecord } from '../types.js';

import { QUESTS } from './quests.js';

export function loadQuestRecords(): QuestRecord[] {
    return QUESTS;
}
