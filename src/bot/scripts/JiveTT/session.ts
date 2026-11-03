import type { SessionState } from './types.js';

export function emptySession(account: string): SessionState {
    return {
        version: 1, account: account.trim().toLowerCase(), phase: 'audit', returnWorld: null, destinationWorld: null, siteId: null,
        cooldowns: {}, purchases: [], pendingPurchase: null, pendingRewards: null, rewardBankBefore: null, restockSpent: 0, pendingClue: null, observations: {}, lastFailure: null, stopped: false,
        counters: { kills: 0, clueDrops: 0, completed: 0, discarded: 0, blocked: 0, rewardsBanked: 0, dosesUsed: 0, sharksUsed: 0, coinsSpent: 0, deaths: 0, elapsedMs: 0, huntingMs: 0 }
    };
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const natural = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function restoreSession(raw: string | null, account: string): SessionState {
    const state = emptySession(account);
    let saved: unknown;
    try { saved = JSON.parse(raw ?? 'null'); } catch { return state; }
    if (!record(saved) || saved.version !== 1 || saved.account !== state.account) return state;
    state.returnWorld = natural(saved.returnWorld) && saved.returnWorld > 0 ? saved.returnWorld : null;
    state.destinationWorld = natural(saved.destinationWorld) && saved.destinationWorld > 0 ? saved.destinationWorld : null;
    state.siteId = typeof saved.siteId === 'string' ? saved.siteId : null;
    state.lastFailure = typeof saved.lastFailure === 'string' ? saved.lastFailure.slice(0, 2000) : null;
    state.stopped = saved.stopped === true;
    state.phase = state.stopped ? 'parked' : 'audit';
    if (record(saved.cooldowns)) for (const [site, until] of Object.entries(saved.cooldowns)) if (natural(until)) state.cooldowns[site] = until;
    if (record(saved.counters)) for (const key of Object.keys(state.counters) as (keyof SessionState['counters'])[]) if (natural(saved.counters[key])) state.counters[key] = saved.counters[key];
    if (record(saved.observations)) for (const [site, observation] of Object.entries(saved.observations)) {
        if (record(observation) && ['kills', 'huntingMs', 'idleMs', 'bankingMs', 'completed'].every(key => natural(observation[key]))) state.observations[site] = { kills: Number(observation.kills), huntingMs: Number(observation.huntingMs), idleMs: Number(observation.idleMs), bankingMs: Number(observation.bankingMs), completed: Number(observation.completed), elapsedMs: natural(observation.elapsedMs) ? observation.elapsedMs : undefined };
    }
    if (Array.isArray(saved.purchases)) state.purchases = saved.purchases.filter((purchase): purchase is SessionState['purchases'][number] => record(purchase) && typeof purchase.item === 'string' && natural(purchase.count) && natural(purchase.coins) && natural(purchase.at)).slice(-100);
    const purchase = saved.pendingPurchase;
    const items = (value: unknown): value is { id: number; count: number }[] => Array.isArray(value) && value.every(item => record(item) && natural(item.id) && natural(item.count));
    if (record(purchase) && purchase.account === state.account && typeof purchase.item === 'string' && natural(purchase.quantity)
        && natural(purchase.coinsBefore) && natural(purchase.cost) && natural(purchase.at) && items(purchase.expected) && items(purchase.itemsBefore)) {
        state.pendingPurchase = { account: state.account, item: purchase.item, quantity: purchase.quantity, expected: purchase.expected,
            coinsBefore: purchase.coinsBefore, itemsBefore: purchase.itemsBefore, cost: purchase.cost, at: purchase.at };
    }
    const rewards = saved.pendingRewards;
    if (items(saved.rewardBankBefore)) state.rewardBankBefore = saved.rewardBankBefore;
    if (record(rewards) && items(rewards.items) && (rewards.bankBefore === null || items(rewards.bankBefore))) state.pendingRewards = { items: rewards.items, bankBefore: rewards.bankBefore };
    if (natural(saved.restockSpent)) state.restockSpent = saved.restockSpent;
    const clue = saved.pendingClue;
    if (record(clue) && natural(clue.id) && typeof clue.acquired === 'boolean' && (typeof clue.outcome === 'string' || clue.outcome === null) && natural(clue.retries)) state.pendingClue = {
        id: clue.id, acquired: clue.acquired, outcome: clue.outcome, retries: Math.min(1, clue.retries),
        lastResupplyId: natural(clue.lastResupplyId) ? clue.lastResupplyId : undefined,
        resupplies: natural(clue.resupplies) ? Math.min(1, clue.resupplies) : 0,
        trailItems: Array.isArray(clue.trailItems) ? clue.trailItems.filter(natural) : []
    };
    return state;
}

export function sessionKey(account: string): string { return `rs2b0t:jivett:${account.trim().toLowerCase()}`; }
