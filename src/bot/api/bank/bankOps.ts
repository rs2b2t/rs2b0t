/**
 * The withdraw op for an amount, read off the item's own op list, the label
 * uses a space ("Withdraw 1"), not a hyphen.
 * @see docs/reference/api-items.md#bank
 */
export function withdrawOp(ops: readonly (string | null)[], amount: 'all' | '10' | '5' | '1' | 'x' | 'any'): string | null {
    const named = ops.filter((o): o is string => o !== null);
    switch (amount) {
        case 'all':
            return named.find(o => /withdraw[\s-]*all/i.test(o)) ?? null;
        case '10':
            return named.find(o => /withdraw[\s-]*10/i.test(o)) ?? null;
        case '5':
            return named.find(o => /withdraw[\s-]*5\b/i.test(o)) ?? null;
        case 'x':
            return named.find(o => /withdraw[\s-]*x/i.test(o)) ?? null;
        case '1':
            return named.find(o => /^withdraw[\s-]*1$/i.test(o)) ?? null;
        case 'any':
            return named.find(o => /^withdraw/i.test(o)) ?? null;
    }
}
