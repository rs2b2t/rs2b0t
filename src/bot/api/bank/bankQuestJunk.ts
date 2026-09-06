import type { QuestStatus } from '../ui/questlog/Quests.js';

export interface QuestJunkEntry {
    id: number;
    name: string;
    quest: string;
}

// Why: only items that are dead once their quest is complete, that gate no later quest, and whose id, display name and journal name were each read out of the content.
export const QUEST_JUNK: readonly QuestJunkEntry[] = [
    { id: 300, name: 'Rats tail', quest: "Witch's Potion" },
    { id: 1549, name: 'Stake', quest: 'Vampire Slayer' }
];

export interface QuestJunkFinding {
    id: number;
    name: string;
    quest: string;
    status: QuestStatus;
    droppable: boolean;
}

export function findQuestJunk(
    banked: readonly { id: number }[],
    statusOf: (quest: string) => QuestStatus
): QuestJunkFinding[] {
    const held = new Set(banked.map(item => item.id));
    return QUEST_JUNK
        .filter(entry => held.has(entry.id))
        .map(entry => {
            const status = statusOf(entry.quest);
            return { ...entry, status, droppable: status === 'complete' };
        });
}
