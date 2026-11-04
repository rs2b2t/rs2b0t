import type { ClueStep } from './types.js';

export interface TrailReward { id: number; count: number }

export interface TrailResult {
    kind: 'completed' | 'resupply' | 'access-blocked' | 'unsupported' | 'transient-failure' | 'death' | 'stopped';
    reason: string;
    clueId: number | null;
    rewards?: readonly TrailReward[];
}

export interface ClueHazard {
    phase: 'travel' | 'guardian' | 'reward';
    guardian: string | null;
}

export interface CluePolicy {
    allowWilderness: boolean;
    verifyRewards: boolean;
    guardianProtectionByHost?: boolean;
    prepareRewards?: () => Promise<boolean>;
    beforeStep?: (step: ClueStep) => Promise<boolean>;
}
