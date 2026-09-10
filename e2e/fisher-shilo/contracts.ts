import assert from 'node:assert/strict';

export type Scenario = 'full' | 'empty' | 'limited';
export type Item = { readonly name: string | null; readonly count: number };
export type Observation = {
    readonly kind: 'sample' | 'shop-before' | 'shop-after' | 'bank-close';
    readonly at: number;
    readonly tick: number;
    readonly keeper: string;
    readonly opened: boolean;
    readonly stock: readonly Item[];
    readonly inventory: readonly Item[];
    readonly bankVials: number;
    readonly bankTrout: number;
    readonly bankDagger: number;
    readonly bankCoins: number;
    readonly bankOpen: boolean;
    readonly xp: number;
    readonly runner: string;
};
export type Outcome = { readonly status: 'wait' } | {
    readonly status: 'pass'; readonly vialOutcome: 'bought' | 'skipped-zero';
};
export const count = (items: readonly Item[], name: string): number =>
    items.filter(item => item.name?.toLowerCase() === name.toLowerCase()).reduce((sum, item) => sum + item.count, 0);

export function assess(trace: readonly Observation[], scenario: Scenario): Outcome {
    const initial = trace[0];
    if (!initial) return { status: 'wait' };
    let obli: Observation | undefined;
    let featherShop = false;
    let deposited: Observation | undefined;
    let visits = 0;
    let featherPeak = count(initial.inventory, 'Feather');
    let vialPeak = 0;
    for (const event of trace) {
        assert.notEqual(event.runner, 'crashed', 'Fisher crashed');
        const vials = count(event.inventory, 'Vial of water');
        vialPeak = Math.max(vialPeak, vials);
        featherPeak = Math.max(featherPeak, count(event.inventory, 'Feather'));
        if (event.kind === 'shop-before') {
            assert(event.inventory.every(item => item.count === 0 ||
                ['Fly fishing rod', 'Feather', 'Coins', 'Vial of water'].includes(item.name ?? '')),
            'shop inventory contains fish/junk');
            if (scenario === 'full') {
                assert(event.bankTrout >= initial.bankTrout + 24 && event.bankDagger >= initial.bankDagger + 1,
                    'full pack was not banked before first shop interaction');
            }
            if (event.keeper === 'Obli') {
                visits++;
                assert(visits === 1, 'Obli must be visited once per supply trip');
            }
        }
        if (event.kind === 'shop-after' && event.opened) {
            if (event.keeper === 'Obli') {
                obli = event;
                const stock = count(event.stock, 'Vial of water');
                assert(event.stock.some(item => item.name === 'Vial of water'), 'vial stock slot missing');
                if (scenario === 'limited') assert(stock < 25, 'limited-stock precondition requires 0..24 vials at runtime');
                else assert(stock >= 25, 'normal-stock precondition requires at least 25 vials at runtime');
            }
            if (event.keeper === 'Fernahei') {
                assert(count(event.stock, 'Feather') > 0, 'feather stock precondition requires available feathers');
                featherShop = true;
            }
        }
        const emptyShelf = obli !== undefined && count(obli.stock, 'Vial of water') === 0;
        if (obli && featherShop && event.kind === 'bank-close' && event.bankOpen && vials === 0 &&
            featherPeak > count(initial.inventory, 'Feather') &&
            (emptyShelf ? event.bankVials === initial.bankVials :
                vialPeak > 0 && event.bankVials - initial.bankVials === vialPeak)) {
            assert(emptyShelf || vialPeak >= Math.min(25, count(obli.stock, 'Vial of water')), 'vial quantity below stock/space minimum');
            deposited = event;
        }
        if (event.xp > initial.xp) {
            const skipped = emptyShelf && vialPeak === 0 && event.bankVials === initial.bankVials &&
                featherShop && featherPeak > count(initial.inventory, 'Feather');
            assert(deposited || skipped, 'Fishing XP resumed before final deposit');
            assert.equal(vials, 0, 'vials still held when fishing resumed');
            assert(obli && featherShop, 'both shops required');
            return { status: 'pass', vialOutcome: emptyShelf ? 'skipped-zero' : 'bought' };
        }
    }
    return { status: 'wait' };
}
