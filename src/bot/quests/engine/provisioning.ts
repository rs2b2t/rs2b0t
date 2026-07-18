import type { QuestItem } from '../types.js';

export interface ProvisionPlan {
    withdraw: { name: string; qty: number }[];
    gather: { name: string; need: number }[];
    blocked: string[];
    satisfied: boolean;
}

/**
 * Bank-first, gather fallback (design decision): pack counts first, then bank
 * (withdraw), then gather for acquirable / BLOCKED for mustHave. Inputs are
 * lowercased-name count maps so live casing never matters here. Pure.
 */
export function planProvisioning(
    items: QuestItem[],
    inv: Map<string, number>,
    bank: Map<string, number>
): ProvisionPlan {
    const plan: ProvisionPlan = { withdraw: [], gather: [], blocked: [], satisfied: true };
    for (const item of items) {
        const key = item.name.toLowerCase();
        const have = inv.get(key) ?? 0;
        if (have >= item.qty) {
            continue;
        }
        plan.satisfied = false;
        let short = item.qty - have;
        const banked = bank.get(key) ?? 0;
        if (banked > 0) {
            const take = Math.min(short, banked);
            plan.withdraw.push({ name: item.name, qty: take });
            short -= take;
        }
        if (short > 0) {
            if (item.kind === 'mustHave') {
                plan.blocked.push(`${item.name} x${item.qty}`);
            } else {
                plan.gather.push({ name: item.name, need: short });
            }
        }
    }
    return plan;
}

/**
 * Items the between-quest deposit should send to the bank: everything in the
 * pack whose name matches none of the `keep` substrings. `inv` keys and `keep`
 * entries are both LOWERCASED (the QuestSnapshot convention); matching is
 * substring-inclusive so 'pickaxe' keeps every pickaxe tier and 'cadava' keeps
 * both the berries and the potion. Pure — the engine only issues a deposit
 * step when this is non-empty, so a clean pack never earns a bank trip.
 */
export function depositPlan(inv: Map<string, number>, keep: string[]): string[] {
    return [...inv.keys()].filter(name => !keep.some(k => name.includes(k)));
}

/** How many MORE gp a purchase needs beyond pack + last-seen bank coins.
 *  0 = affordable. bankCoins is last-SEEN (0 before any bank visit this run),
 *  so a broke verdict can be stale-pessimistic on a fresh login; the buy
 *  executor's own bank trip refreshes it and the next loop re-decides. Pure. */
export function gpShort(snap: { inv: Map<string, number>; bankCoins: number }, estGp: number): number {
    const have = (snap.inv.get('coins') ?? 0) + snap.bankCoins;
    return Math.max(0, estGp - have);
}

/** Default coin float, fetched once at provisioning time: coins are useful in
 *  nearly every quest (gate tolls, shop buys), so top the PACK up to `float` from
 *  the BANK. Returns the withdraw to issue, or null when the pack already carries
 *  the float or the bank is dry. Capped at what the bank holds, so a partial bank
 *  drains in one trip and — with bank counts refreshed after the withdraw — the
 *  next pass sees `banked === 0` and stops (no re-withdraw loop). Pure. */
export function coinFloatWithdraw(
    inv: Map<string, number>,
    bank: Map<string, number>,
    float: number
): { name: string; qty: number } | null {
    const pack = inv.get('coins') ?? 0;
    const banked = bank.get('coins') ?? 0;
    const want = Math.min(float - pack, banked);
    return want > 0 ? { name: 'Coins', qty: want } : null;
}
