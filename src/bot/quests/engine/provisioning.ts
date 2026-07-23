import type { QuestItem } from '../types.js';

export interface ProvisionPlan {
    withdraw: { name: string; qty: number }[];
    gather: { name: string; need: number }[];
    blocked: string[];
    satisfied: boolean;
}

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

export function depositPlan(inv: Map<string, number>, keep: string[]): string[] {
    return [...inv.keys()].filter(name => !keep.some(k => name.includes(k)));
}

export function gpShort(snap: { inv: Map<string, number>; bankCoins: number }, estGp: number): number {
    const have = (snap.inv.get('coins') ?? 0) + snap.bankCoins;
    return Math.max(0, estGp - have);
}

export function floatWithdraw(
    inv: Map<string, number>,
    bank: Map<string, number>,
    name: string,
    target: number
): { name: string; qty: number } | null {
    const key = name.toLowerCase();
    const pack = inv.get(key) ?? 0;
    const banked = bank.get(key) ?? 0;
    const want = Math.min(target - pack, banked);
    return want > 0 ? { name, qty: want } : null;
}

export function coinFloatWithdraw(
    inv: Map<string, number>,
    bank: Map<string, number>,
    float: number
): { name: string; qty: number } | null {
    return floatWithdraw(inv, bank, 'Coins', float);
}
