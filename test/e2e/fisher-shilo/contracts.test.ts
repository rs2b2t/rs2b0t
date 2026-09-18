import { describe, expect, test } from 'bun:test';
import { assess, type Observation } from '../../../e2e/fisher-shilo/contracts.js';

const observation = (changes: Partial<Observation> = {}): Observation => ({
    kind: 'sample', at: 0, tick: 0, keeper: '', opened: false, stock: [],
    inventory: [{ name: 'Fly fishing rod', count: 1 }, { name: 'Feather', count: 1 }],
    bankVials: 0, bankTrout: 0, bankDagger: 0, bankCoins: 10000,
    bankOpen: false, xp: 1000, runner: 'running', ...changes
});
const inv = (vials: number) => [
    { name: 'Fly fishing rod', count: 1 }, { name: 'Feather', count: 801 },
    ...(vials ? [{ name: 'Vial of water', count: vials }] : [])
];
const successful = (stock = 50): Observation[] => [
    observation(),
    observation({ kind: 'shop-before', keeper: 'Obli' }),
    observation({ kind: 'shop-after', keeper: 'Obli', opened: true, stock: [{ name: 'Vial of water', count: stock }] }),
    observation({ kind: 'shop-before', keeper: 'Fernahei' }),
    observation({ kind: 'shop-after', keeper: 'Fernahei', opened: true, stock: [{ name: 'Feather', count: 800 }] }),
    observation({ inventory: inv(Math.min(stock, 25)) }),
    observation({ kind: 'bank-close', bankOpen: true, inventory: inv(0), bankVials: Math.min(stock, 25) }),
    observation({ inventory: inv(0), bankVials: Math.min(stock, 25), xp: 1050 })
];

describe('Fisher shopping observable contracts', () => {
    test('passes when both shops precede the vial deposit and resumed XP', () => {
        const trace = successful();
        const result = assess(trace, 'empty');
        expect(result).toEqual({ status: 'pass', vialOutcome: 'bought' });
    });
    test('rejects fish at first shop even when held coins suffice', () => {
        const trace = successful();
        trace[1] = observation({ kind: 'shop-before', keeper: 'Obli', inventory: [{ name: 'Raw trout', count: 24 }] });
        expect(() => assess(trace, 'full')).toThrow('shop inventory');
    });
    test('rejects discarded rather than banked full-pack junk', () => {
        const trace = successful();
        expect(() => assess(trace, 'full')).toThrow('banked');
    });
    test('rejects XP before final deposit', () => {
        const trace = successful();
        trace[5] = observation({ xp: 1050, inventory: inv(25) });
        expect(() => assess(trace, 'empty')).toThrow('before final deposit');
    });
    test('waits when vials remain held', () => {
        const trace = successful().slice(0, 6);
        expect(assess(trace, 'empty').status).toBe('wait');
    });
    test('passes a runtime-zero shelf once without buying vials', () => {
        const trace = successful(0);
        expect(assess(trace, 'limited')).toEqual({ status: 'pass', vialOutcome: 'skipped-zero' });
    });
    test('rejects repeated zero-stock visits in the same trip', () => {
        const trace = successful(0);
        trace.splice(5, 0, observation({ kind: 'shop-before', keeper: 'Obli' }));
        expect(() => assess(trace, 'limited')).toThrow('once');
    });
    test('rejects a normal shelf for the limited-stock fixture', () => {
        const trace = successful();
        expect(() => assess(trace, 'limited')).toThrow('limited-stock precondition');
    });
    test('passes a verified limited shelf with deposited purchases', () => {
        const trace = successful(3);
        expect(assess(trace, 'limited')).toEqual({ status: 'pass', vialOutcome: 'bought' });
    });
    test('passes full-pack banking when both seeded items reach the bank before shops', () => {
        const trace = successful().map((event, index) => index === 0 ? event : { ...event, bankTrout: 24, bankDagger: 1 });
        expect(assess(trace, 'full').status).toBe('pass');
    });
    test('rejects one vial purchased from a full shelf despite available space', () => {
        const trace = successful().map(event => ({ ...event,
            inventory: event.inventory.some(item => item.name === 'Vial of water') ? inv(1) : event.inventory,
            bankVials: event.bankVials > 0 ? 1 : 0
        }));
        expect(() => assess(trace, 'empty')).toThrow('vial quantity');
    });
    test('allows zero-stock skip without a pointless final bank visit', () => {
        const trace = successful(0).filter(event => event.kind !== 'bank-close');
        expect(assess(trace, 'limited')).toEqual({ status: 'pass', vialOutcome: 'skipped-zero' });
    });
});
