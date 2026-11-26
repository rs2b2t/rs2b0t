import { QUESTS, questRecord } from '../../api/ai/quests/data/quests.js';
import type { LevelerSnapshot } from './types.js';

export const QUEST_POINT_PRIORITY = ([
    'runemysteries', 'cook', 'doric', 'sheep', 'priest', 'haunted', 'hetty', 'romeojuliet',
    'prince', 'hunt', 'gobdip', 'blackknight', 'vampire', 'squire', 'arthur'
] as const).map(questRecord);

export function questPoints(s: LevelerSnapshot): number {
    return s.questPoints ?? QUESTS.reduce((total, quest) => total + (s.quests[quest.name] ? quest.questPoints : 0), 0);
}
