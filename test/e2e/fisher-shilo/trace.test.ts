import { expect, test } from 'bun:test';
import { retainBankSnapshots } from '../../../e2e/fisher-shilo/trace.js';
import type { Observation } from '../../../e2e/fisher-shilo/contracts.js';

test('retains an observed bank balance when the interface closes', () => {
    const common = { kind: 'sample', at: 0, tick: 0, keeper: '', opened: false, stock: [],
        inventory: [], bankVials: 25, bankTrout: 24, bankDagger: 1, bankCoins: 8400,
        bankOpen: true, xp: 1000, runner: 'running' } satisfies Observation;
    const events = [common, { ...common, bankOpen: false, bankVials: 0, bankTrout: 0, bankDagger: 0, bankCoins: 0 }];
    const retained = retainBankSnapshots(events).at(-1);
    expect(retained).toMatchObject({ bankOpen: false, bankVials: 25, bankTrout: 24, bankDagger: 1, bankCoins: 8400 });
});
