import { expect, test } from 'bun:test';
import { assessReward, type RewardCapture } from '../../e2e/jive-reward-contract.js';

const good = {
    manifest: { interfaceId: 6963, modalId: 6960, items: [{ id: 2448, count: 3 }, { id: 995, count: 1200 }] },
    before: [{ id: 2448, count: 1 }, { id: 995, count: 100 }],
    requireFullHpSpace: true,
    samples: [
        { at: 0, holdings: [{ id: 2448, count: 2 }, { id: 995, count: 1300 }], hp: 80, maxHp: 80, sharks: 20, used: 28, left: false },
        { at: 1, holdings: [{ id: 2448, count: 2 }, { id: 995, count: 1300 }], hp: 80, maxHp: 80, sharks: 19, used: 27, left: false, action: 'Eat Shark' },
        { at: 20, holdings: [{ id: 2448, count: 4 }, { id: 995, count: 1300 }], hp: 80, maxHp: 80, sharks: 19, used: 28, left: false },
        { at: 21, holdings: [{ id: 2448, count: 4 }, { id: 995, count: 1300 }], hp: 80, maxHp: 80, sharks: 19, used: 28, left: true }
    ]
} satisfies RewardCapture;
test('accounts for every potion unit and delayed overflow before leaving when the manifest contains multiple nonstackables', () => {
    const result = assessReward(good);
    expect(result.passed).toBe(true);
});
test('rejects leaving early even when delayed items arrive later', () => {
    const result = assessReward({ ...good, samples: good.samples.map(s => s.at === 1 ? { ...s, left: true } : s) });
    expect(result.passed).toBe(false);
});
test('rejects counting potion types instead of quantities', () => {
    const result = assessReward({ ...good, samples: good.samples.map(s => ({ ...s,
        holdings: [{ id: 2448, count: 2 }, { id: 995, count: 1300 }] })) });
    expect(result.passed).toBe(false);
});
test('rejects counting preexisting bank stock as a reward', () => {
    const result = assessReward({ ...good, before: [{ id: 2448, count: 3 }, { id: 995, count: 100 }] });
    expect(result.passed).toBe(false);
});
test('sums separate slots of the same nonstackable item', () => {
    const result = assessReward({ ...good, samples: good.samples.map(s => s.at >= 20 ? { ...s,
        holdings: [{ id: 2448, count: 1 }, { id: 2448, count: 1 }, { id: 2448, count: 1 }, { id: 2448, count: 1 }, { id: 995, count: 1300 }] } : s) });
    expect(result.passed).toBe(true);
});
test('sums repeated manifest rows instead of crediting one unit twice', () => {
    const result = assessReward({ ...good, manifest: { ...good.manifest, items: [{ id: 2448, count: 2 }, { id: 2448, count: 2 }] } });
    expect(result.passed).toBe(false);
});
for (const manifest of [null, { ...good.manifest, interfaceId: 6962 }, { ...good.manifest, modalId: 6959 },
    { ...good.manifest, items: [] }, { ...good.manifest, items: [{ id: 2448, count: 0 }] }]) {
    test(`rejects absent or invalid actual reward manifest: ${JSON.stringify(manifest)}`, () => {
        const result = assessReward({ ...good, manifest });
        expect(result.passed).toBe(false);
    });
}
test('requires confirmed Shark consumption at full HP to prove full-pack space recovery', () => {
    const result = assessReward({ ...good, samples: good.samples.map(s => ({ ...s, sharks: 20 })) });
    expect(result.passed).toBe(false);
});
test('rejects a Drop masquerading as space recovery', () => {
    const result = assessReward({ ...good, samples: good.samples.map(s => ({ ...s, action: undefined })) });
    expect(result.passed).toBe(false);
});
test('permits casket-only collection without guardian gear or food when space already exists', () => {
    const result = assessReward({ ...good, requireFullHpSpace: false,
        samples: good.samples.filter(s => s.at >= 20).map(s => ({ ...s, sharks: 0 })) });
    expect(result.passed).toBe(true);
});
test('rejects truncated accounting even when no departure was captured', () => {
    const result = assessReward({ ...good, samples: good.samples.filter(s => s.at < 20) });
    expect(result.passed).toBe(false);
});
test('accounts for reward Sharks consumed for space without treating initial food as loot', () => {
    const capture: RewardCapture = { ...good, manifest: { interfaceId: 6963, modalId: 6960, items: [{ id: 385, count: 5 }] },
        before: [{ id: 385, count: 20 }], requireFullHpSpace: false,
        samples: [{ at: 1, holdings: [{ id: 385, count: 24 }], consumed: [{ id: 385, count: 1 }],
            hp: 80, maxHp: 80, sharks: 24, used: 28, left: true }] };
    const result = assessReward(capture);
    expect(result.passed).toBe(true);
});
test('does not credit consumed initial food as new rewards', () => {
    const capture: RewardCapture = { ...good, manifest: { interfaceId: 6963, modalId: 6960, items: [{ id: 385, count: 5 }] },
        before: [{ id: 385, count: 20 }], requireFullHpSpace: false,
        samples: [{ at: 1, holdings: [{ id: 385, count: 19 }], consumed: [{ id: 385, count: 1 }],
            hp: 80, maxHp: 80, sharks: 19, used: 28, left: true }] };
    const result = assessReward(capture);
    expect(result.passed).toBe(false);
});
