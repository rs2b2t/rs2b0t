// Quest Eligibility Dashboard — shared types. Imports NOTHING so the pure
// evaluators that consume it stay free of any client/DOM dependency (their
// tests run under bun:test with no game client). Live reads happen only in
// QuestDashboard.ts, which converts game state into the plain snapshots here.

export interface SkillReq {
    skill: string; // matches Skills.level() name, e.g. 'mining'
    level: number;
}

export interface QuestRequirements {
    /** Minimum TOTAL quest points to start (e.g. Dragon Slayer 32). Omit if none. */
    minQuestPoints?: number;
    /** Hard skill-level gates. */
    skills?: SkillReq[];
    /** Prerequisite quest ids (QuestRecord.id values). */
    quests?: string[];
}

export interface QuestItem {
    name: string; // display name as it appears in bank/inventory
    qty: number;
    kind: 'mustHave' | 'acquirable';
}

export interface QuestRecord {
    id: string; // internal handle, matches journal component (e.g. 'cook')
    name: string; // display name; MUST match Quests.status() key
    members: boolean;
    questPoints: number; // QP awarded on completion
    requirements: QuestRequirements;
    items: QuestItem[];
}

export interface PlayerState {
    questPoints: number;
    skillLevels: Map<string, number>; // skill name -> base level
    completedQuests: Set<string>; // QuestRecord.id set
}

export interface BankInventorySnapshot {
    counts: Map<string, number>; // item display name -> total qty (bank + inventory)
}

export type QuestStatusV = 'DONE' | 'READY' | 'BLOCKED';

export interface QuestEligibility {
    id: string;
    name: string;
    members: boolean;
    status: QuestStatusV;
    reasons: string[]; // empty for DONE/READY; one human string per unmet gate for BLOCKED
}

export interface RequirementResult {
    ok: boolean;
    reason: string; // human string, meaningful when !ok
}

export interface ItemResult {
    name: string;
    qty: number;
    kind: 'mustHave' | 'acquirable';
    present: number;
    ok: boolean; // mustHave: present>=qty ; acquirable: always true
    willGather: boolean; // true for acquirable items not (yet) present
}
