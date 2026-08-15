import { Bank } from '../bank/Bank.js';
import { Execution } from '../execution/Execution.js';
import { Inventory } from '../inventory/Inventory.js';

interface NamedStack {
    name: string | null;
    count: number;
}

export const THIEVER_BANKING_OPTIONS = ['None', 'Auto'];

/**
 * Combat ticks a failed pickpocket stun locks movement for (Ardy / Thiever).
 * Engine stun is 9 ticks — wait the full lock so the next click can path.
 */
export const STUN_COMBAT_TICKS = 9;

type WithdrawChunk =
    | { kind: 'x'; count: number }
    | { kind: 'op'; op: 'Withdraw-10' | 'Withdraw-5' | 'Withdraw-1' };

/**
 * Choose the next bulk bank withdraw step for `need` more items.
 * Prefer Withdraw-X when need > 10; else 10 / 5 / 1 ladder (FireGiant withdrawTo).
 */
export function nextWithdrawChunk(need: number): WithdrawChunk | null {
    if (need <= 0) {
        return null;
    }
    if (need > 10) {
        return { kind: 'x', count: need };
    }
    if (need >= 10) {
        return { kind: 'op', op: 'Withdraw-10' };
    }
    if (need >= 5) {
        return { kind: 'op', op: 'Withdraw-5' };
    }
    return { kind: 'op', op: 'Withdraw-1' };
}

/**
 * Bulk-withdraw `name` until inventory holds `target` or bank/inv blocks progress.
 * Mirrors FireGiant/RockCrab withdrawTo (X when need>10, else 10/5/1).
 */
export async function withdrawTo(
    name: string,
    target: number,
    countInInv: () => number = () => Inventory.count(name)
): Promise<number> {
    const start = countInInv();
    for (let guard = 0; guard < 40 && countInInv() < target && !Inventory.isFull(); guard++) {
        const before = countInInv();
        const need = target - before;
        const chunk = nextWithdrawChunk(need);
        if (!chunk) {
            break;
        }
        if (chunk.kind === 'x') {
            if (await Bank.withdrawX(name, chunk.count)) {
                if (countInInv() > before) {
                    continue;
                }
            }
            // Fall through to labeled ops if X failed or gained nothing.
            const fallback = nextWithdrawChunk(Math.min(need, 10));
            if (!fallback || fallback.kind !== 'op') {
                break;
            }
            await Bank.withdraw(name, fallback.op);
            if (!(await Execution.delayUntil(() => countInInv() > before, 2500))) {
                break;
            }
            continue;
        }
        await Bank.withdraw(name, chunk.op);
        if (!(await Execution.delayUntil(() => countInInv() > before, 2500))) {
            break;
        }
    }
    return countInInv() - start;
}

/** Close both bank panes and prove the same backpack count is visible afterward. */
export async function closeBankAndConfirmCount(expected: number, count: () => number): Promise<boolean> {
    if (!(await Bank.close())) {
        return false;
    }
    await Execution.delayTicks(1);
    return Execution.delayUntil(() => count() >= expected, 3000);
}

export function autoFoodBanking(mode: string): boolean {
    return mode.trim().toLowerCase() === 'auto';
}

export function foodMatches(name: string | null, keyword: string): boolean {
    const wanted = keyword.trim().toLowerCase();
    return wanted.length > 0 && (name ?? '').toLowerCase().includes(wanted);
}

export function countFood(items: NamedStack[], keyword: string): number {
    return items.filter(item => foodMatches(item.name, keyword)).reduce((sum, item) => sum + item.count, 0);
}

export function shouldRestockFood(enabled: boolean, foodCount: number, restockAt: number, bankablePackFull: boolean): boolean {
    return enabled && (foodCount <= restockAt || bankablePackFull);
}

export function safeToSteal(hpFraction: number, eatAt: number, foodCount: number): boolean {
    return hpFraction >= eatAt || foodCount > 0;
}
