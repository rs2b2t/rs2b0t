import type { QuestRecord } from '../types.js';

import { QUESTS } from './quests.js';

/** All quest records for the eligibility dashboard. */
export function loadQuestRecords(): QuestRecord[] {
    return QUESTS;
}
