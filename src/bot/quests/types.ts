export interface SkillReq {
    skill: string;
    level: number;
}

export interface QuestRequirements {
    minQuestPoints?: number;
    skills?: SkillReq[];
    quests?: string[];
}

export interface QuestItem {
    name: string;
    qty: number;
    kind: 'mustHave' | 'acquirable';
}

export interface QuestRecord {
    id: string;
    name: string;
    questPoints: number;
    requirements: QuestRequirements;
    items: QuestItem[];
}

export interface PlayerState {
    questPoints: number;
    skillLevels: Map<string, number>;
    completedQuests: Set<string>;
}

export interface BankInventorySnapshot {
    counts: Map<string, number>;
}

export type QuestStatusV = 'DONE' | 'READY' | 'BLOCKED';

export interface QuestEligibility {
    id: string;
    name: string;
    status: QuestStatusV;
    reasons: string[];
}

export interface RequirementResult {
    ok: boolean;
    reason: string;
}

export interface ItemResult {
    name: string;
    qty: number;
    kind: 'mustHave' | 'acquirable';
    present: number;
    ok: boolean;
    willGather: boolean;
}
