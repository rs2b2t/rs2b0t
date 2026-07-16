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
