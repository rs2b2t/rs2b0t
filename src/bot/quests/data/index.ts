import type { QuestRecord } from '../types.js';

import { F2P } from './f2p.js';
import { MEMBERS_A } from './members-a.js';
import { MEMBERS_B } from './members-b.js';
import { MEMBERS_C } from './members-c.js';

/** All quest records for the eligibility dashboard. */
export function loadQuestRecords(): QuestRecord[] {
    return [...F2P, ...MEMBERS_A, ...MEMBERS_B, ...MEMBERS_C];
}
