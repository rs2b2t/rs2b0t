import type { WorldTile } from '../../adapter/ClientAdapter.js';

export interface LevelerSnapshot {
    accountName?: string | null;
    levels: Record<string, number>;
    stock: Record<string, number>;
    bankStock?: Readonly<Record<string, number>>;
    bankReady: boolean;
    quests: Record<string, boolean>;
    questPoints?: number;
    dragonStage?: number;
    target: number;
    mode?: string;
    wilderness: boolean;
    allowQuests?: boolean;
    supplySeers?: boolean;
    supplierOnly?: boolean;
    seersWorld?: boolean;
    now: number;
    unavailableItems?: readonly string[];
    marketItem?: (need: Requirement) => number | undefined;
}

export interface Requirement {
    item: string;
    id?: number;
    count: number;
    minimum?: number;
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
    bankTeleport?: string;
    output?: Requirement;
    quest?: string;
    combat?: boolean;
    meleeMilestone?: number;
    starterCombatSkill?: string;
    deathWalk?: boolean;
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

export type Decision = { kind: 'activity'; plan: ActivityPlan; queue: ActivityPlan[] } | { kind: 'complete' } | { kind: 'refresh' } | { kind: 'blocked'; reason: string };

export function stockOf(snapshot: LevelerSnapshot, item: string): number {
    return snapshot.stock[item.toLowerCase()] ?? 0;
}

export function banksGatheredResource(plan: ActivityPlan): boolean {
    return plan.script === 'EssMiner' || plan.settings.bank === true && (plan.script === 'Miner' || plan.script === 'Woodcutter');
}

export function bankedStockOf(snapshot: LevelerSnapshot, item: string): number {
    return (snapshot.bankStock ?? snapshot.stock)[item.toLowerCase()] ?? 0;
}

export function requirementKey(need: Requirement): string {
    return need.id === undefined ? need.item : `#${need.id}`;
}
