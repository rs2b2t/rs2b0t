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
