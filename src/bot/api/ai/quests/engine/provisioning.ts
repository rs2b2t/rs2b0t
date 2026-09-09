// docs/reference/quest-provisioning.md
import type { QuestStatus } from '../../../ui/questlog/Quests.js';
import type { QuestItem } from '../types.js';

interface ProvisionPlan {
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

/** Spending money a quest keeps in the pack unless its module names another figure. */
export const COIN_FLOAT = 1000;

/** Purse below which a counter trip is worth making, well under anything a quest asks for. */
const BUY_TOPUP_DIVISOR = 4;

/**
 * Why: topping up to the item's own estimate left 20 gp in the purse after a loaf and the next boat fare emptied it, so Merlin's Crystal crossed, ran dry and walked back for another twenty.
 * Why: the trip refills a float rather than one purchase, and only once the purse is a quarter of it, so nothing returns to the bank between two cheap buys.
 */
export function buyPurseTopUp(held: number, estGp: number): { need: boolean; draw: number } {
    const target = Math.max(estGp, COIN_FLOAT);
    return held >= Math.ceil(target / BUY_TOPUP_DIVISOR)
        ? { need: false, draw: 0 }
        : { need: true, draw: target - held };
}

/**
 * Why: the bot starts carrying anything and the quest before this one leaves anything behind, so every quest provisions from empty.
 * Why: the journal is the only gate. A quest already underway may be carrying the only copy of something: Shield of Arrav's chest and Straven both re-check the bank, so a swept store key and shield half never come back.
 */
export function shouldFreshenPack(
    journal: QuestStatus,
    usedSlots: number,
    alreadyFresh: boolean
): boolean {
    if (usedSlots === 0 || alreadyFresh) {
        return false;
    }
    return journal === 'notStarted';
}

/**
 * Why: the provisioning block re-runs every tick while a quest is still gathering, so topping a float up sent the bot back to the bank each time it ate a lobster or drank a dose.
 * Why: `drawn` closes the float for the quest once the pack has held it, and an empty bank leaves it open so a restock is still honoured.
 */
export function floatDrawPlan(
    held: number,
    banked: number,
    target: number,
    alreadyDrawn: boolean
): { qty: number; drawn: boolean } {
    if (alreadyDrawn || held >= target) {
        return { qty: 0, drawn: true };
    }
    return { qty: Math.max(0, Math.min(target - held, banked)), drawn: false };
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

/**
 * Why: the provisioning block re-runs every tick while a quest is still gathering, so topping the purse after a 10gp gate sent Cook's Assistant back to Al Kharid.
 * Why: `drawn` closes the float once the pack has held it, the same latch food already uses, and a target of 0 never withdraws.
 */
export function coinFloatPlan(
    held: number,
    banked: number,
    target: number,
    alreadyDrawn: boolean
): { qty: number; drawn: boolean } {
    if (target <= 0) {
        return { qty: 0, drawn: true };
    }
    return floatDrawPlan(held, banked, target, alreadyDrawn);
}
