import type { PurchaseIntent } from './marketTrade.js';

export type ClueTier = 'easy' | 'medium' | 'hard';
export interface Point { x: number; z: number; level: number }
export interface Box { minX: number; maxX: number; minZ: number; maxZ: number; level: number }
export interface ItemStack { id: number; count: number; noted?: boolean }
export type PotionFamily = 'prayer' | 'attack' | 'strength' | 'defence' | 'antifire' | 'antipoison';
export interface SiteValidation {
    revision: string;
    evidence: string;
    entry: boolean;
    melee: boolean;
    loot: boolean;
    exit: boolean;
    npcIds: number[];
}
export interface JiveTarget { ids: number[]; name: string; defences: { stab: number; slash: number; crush: number }; clueChance: number; spawnTiles: Point[] }
export interface JiveSite {
    id: string;
    label: string;
    dragonSiteKey?: string;
    targets: JiveTarget[];
    region: Box;
    bank: Point;
    staging: Point;
    entry: Point[];
    exit: Point[];
    escapeTeleportId: string;
    requirements: {
        skills: Record<string, number>;
        quests: string[];
        access?: string[];
        items: number[];
        entryCoins: number;
        antifire: boolean;
        antipoison: boolean;
    };
    validation: SiteValidation | null;
    capacity: number;
    weight: number;
}
export interface JiveSettings {
    clueTier: ClueTier;
    allowedSites: string[];
    allowedWorlds: number[];
    shard: string;
    offensivePrayers: boolean;
    boostThreshold: number;
    sharks: number;
    prayerDoses: number;
    superDoses: number;
    stockSharks: number;
    stockPrayerDoses: number;
    stockSuperSets: number;
    stockAntifireDoses: number;
    stockAntipoisonDoses: number;
    marketEnabled: boolean;
    priceBook: string;
    priceCeilings: Record<string, number>;
    maxRestockSpend: number;
    coinReserve: number;
    marketBatch: number;
    retrySeconds: number;
    keepItems: string[];
    dragonBones: 'bury' | 'leave';
    dragonHides: 'bank' | 'leave';
    ordinaryBones: 'bury' | 'leave';
    blockedClue: 'discard' | 'park';
    eatHp: number;
    retreatHp: number;
    stopAfterDeath: boolean;
}
export interface AccountSnapshot {
    account: string;
    world: number;
    bankFresh: boolean;
    inventory: ItemStack[];
    bank: ItemStack[];
    equipment: ItemStack[];
    levels: Record<string, number>;
    quests: string[];
    access?: string[];
    weaponId: number | null;
    escapeReady: boolean;
    suppliesReady: boolean;
}
export type Phase = 'audit' | 'bank' | 'market' | 'switch-world' | 'travel' | 'hunt' | 'prepare-clue' | 'solve' | 'rewards' | 'parked';
export interface Counters {
    kills: number;
    clueDrops: number;
    completed: number;
    discarded: number;
    blocked: number;
    rewardsBanked: number;
    dosesUsed: number;
    sharksUsed: number;
    coinsSpent: number;
    deaths: number;
    elapsedMs: number;
    huntingMs: number;
}
export interface SiteObservation { kills: number; huntingMs: number; idleMs: number; bankingMs: number; completed: number; elapsedMs?: number }
export interface SessionState {
    version: 1;
    account: string;
    phase: Phase;
    returnWorld: number | null;
    destinationWorld: number | null;
    siteId: string | null;
    cooldowns: Record<string, number>;
    purchases: { item: string; count: number; coins: number; at: number }[];
    pendingPurchase: PurchaseIntent | null;
    pendingRewards: { items: ItemStack[]; bankBefore: ItemStack[] | null } | null;
    rewardBankBefore: ItemStack[] | null;
    restockSpent: number;
    pendingClue: { id: number; acquired: boolean; outcome: string | null; retries: number; lastResupplyId?: number; resupplies?: number; trailItems?: number[] } | null;
    counters: Counters;
    observations: Record<string, SiteObservation>;
    lastFailure: string | null;
    stopped: boolean;
}
export interface PackLine { id: number; count: number; stackable: boolean; purpose: string }
export type PackPlan = { kind: 'ready'; items: PackLine[]; slots: number; reserveSlots: number } | { kind: 'blocked'; reason: string };
