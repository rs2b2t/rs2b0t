import { expect, test } from 'bun:test';
import { assessCandidatePolicy } from '../../e2e/jivedragons-black-policy.js';

const sample = { at: 0, kind: 'tick', used: 28, sharks: 4, hp: 99, inventory: [{ name: 'Rune arrow', count: 20 }, { name: 'Bronze arrow', count: 10 }],
    equipment: [{ name: 'Rune arrow', count: 500 }] };

test('requires observed merge rather than an equipment action alone', () => {
    const result = assessCandidatePolicy([sample, { ...sample, at: 1, kind: 'inventory-action', action: 'Wield', item: 'Rune arrow' }]);
    expect(result.gaps).toContain('confirmed-rune-merge');
});
test('confirms Rune quiver gain, bag removal and free slot while preserving other arrows', () => {
    const result = assessCandidatePolicy([sample, { ...sample, at: 1, used: 27, inventory: [{ name: 'Bronze arrow', count: 10 }], equipment: [{ name: 'Rune arrow', count: 520 }] }]);
    expect(result.merges).toBe(1);
});
test('rejects equipping an unconfigured arrow', () => {
    const result = assessCandidatePolicy([{ ...sample, kind: 'inventory-action', action: 'Wield', item: 'Bronze arrow' }]);
    expect(result.violations).toContain('unconfigured-ammo');
});
test('rejects capacity exit at reserve but permits emergency HP escape', () => {
    const episode = { hp: 99, panicHp: 30, food: 4, reserve: 4, full: true, requiredSupplies: true, escaped: true, roomConfirmed: false };
    const healthy = assessCandidatePolicy([], [episode]);
    const danger = assessCandidatePolicy([], [{ ...episode, hp: 20 }]);
    expect(healthy.violations).toContain('food-capacity-exit');
    expect(danger.violations).not.toContain('food-capacity-exit');
});
test('requires confirmed room at reserve and an actual emergency escape', () => {
    const episode = { hp: 99, panicHp: 30, food: 4, reserve: 4, full: true, requiredSupplies: true, escaped: false, roomConfirmed: true };
    const result = assessCandidatePolicy([], [episode, { ...episode, hp: 20, escaped: true }]);
    expect(result.capacityMadeRoom).toBe(1);
    expect(result.emergencyEscapes).toBe(1);
    expect(result.gaps).toEqual(['confirmed-rune-merge', 'wrong-arrow-loot-preserved']);
});
test('does not accept unobserved candidate policy scenarios', () => {
    expect(assessCandidatePolicy([]).passed).toBe(false);
});
test('requires wrong-arrow Take followed by an actual backpack gain', () => {
    const take = { ...sample, kind: 'ground-action', action: 'Take', item: 'Bronze arrow' };
    expect(assessCandidatePolicy([take]).otherArrowLoot).toBe(0);
    const after = { ...sample, at: 100, inventory: [{ name: 'Bronze arrow', count: 20 }] };
    expect(assessCandidatePolicy([take, after]).otherArrowLoot).toBe(1);
});
