export interface QuestPreparationRequest {
    skills?: readonly { skill: string; level: number }[];
    items?: readonly { item: string; id?: number; count: number }[];
    food?: { item: string; count: number };
}

export type QuestPreparationResult = 'ready' | 'working';
