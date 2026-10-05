import type { WorldTile } from '../../adapter/ClientAdapter.js';

export interface LevelerSnapshot {
    levels: Record<string, number>;
    stock: Record<string, number>;
    bankReady: boolean;
    quests: Record<string, boolean>;
    target: number;
    wilderness: boolean;
    now: number;
}

export interface Requirement {
    item: string;
    id?: number;
    count: number;
    carry?: number;
    equip?: boolean;
}

export interface ActivityPlan {
    id: string;
    label: string;
    objective: string;
    script: string;
    settings: Record<string, unknown>;
    needs: Requirement[];
    travel?: WorldTile;
    output?: Requirement;
    quest?: string;
    combat?: boolean;
    wilderness?: boolean;
    food?: string;
    prerequisiteLevels?: Record<string, number>;
}

export interface SessionMemory {
    objective: string | null;
    recent: string[];
    cooldowns: Record<string, number>;
    attempted: Record<string, number>;
    deaths: number;
}

export type Decision = { kind: 'activity'; plan: ActivityPlan } | { kind: 'complete' } | { kind: 'refresh' } | { kind: 'blocked'; reason: string };

export function stockOf(snapshot: LevelerSnapshot, item: string): number {
    return snapshot.stock[item.toLowerCase()] ?? 0;
}

export function requirementKey(need: Requirement): string {
    return need.id === undefined ? need.item : `#${need.id}`;
}
