/**
 * The real withdraw-op label off a bank item's OWN ops. Labels vary by content
 * build ('Withdraw All' vs 'Withdraw-All'; 'Withdraw 1' with a SPACE per
 * bank_main.if), so a hardcoded guess silently withdraws nothing — read the
 * label instead. '1' is anchored so it never catches 'Withdraw 10'; 'any' is
 * the loosest fallback. Null when the item offers no such op. Pure module —
 * no client imports, so pure logic modules can share it.
 */
export function withdrawOp(ops: readonly (string | null)[], amount: 'all' | '10' | '1' | 'any'): string | null {
    const named = ops.filter((o): o is string => o !== null);
    switch (amount) {
        case 'all':
            return named.find(o => /withdraw[\s-]*all/i.test(o)) ?? null;
        case '10':
            return named.find(o => /withdraw[\s-]*10/i.test(o)) ?? null;
        case '1':
            return named.find(o => /^withdraw[\s-]*1$/i.test(o)) ?? null;
        case 'any':
            return named.find(o => /^withdraw/i.test(o)) ?? null;
    }
}
