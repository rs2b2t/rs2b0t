import { describe, expect, test } from 'bun:test';

import {
    HARD_LEATHER_BURST,
    MAX_REFIRES,
    STALL_TICKS,
    findOp,
    issueHardLeatherBurst,
    newDrain,
    predictLeatherSlots,
    sideCacheFrom,
    stepDrain
} from '../../../src/bot/scripts/LeatherCrafter/LeatherCrafterLogic.js';

describe('issueHardLeatherBurst', () => {
    test('queues every slot without awaiting each send', async () => {
        const used: number[] = [];
        const sent = await issueHardLeatherBurst(
            Array.from({ length: 26 }, (_, slot) => slot),
            slot => {
                used.push(slot);
                return true;
            }
        );

        expect(sent).toBe(26);
        expect(used).toEqual(Array.from({ length: 26 }, (_, slot) => slot));
    });

    test('stops when an input action is rejected synchronously', async () => {
        const used: number[] = [];
        const sent = await issueHardLeatherBurst([1, 2, 3, 4], slot => {
            used.push(slot);
            return slot < 3;
        });

        expect(sent).toBe(2);
        expect(used).toEqual([1, 2, 3]);
    });

    test('honours a smaller explicit limit', async () => {
        const used: number[] = [];
        const sent = await issueHardLeatherBurst(
            [1, 2, 3],
            slot => {
                used.push(slot);
                return true;
            },
            2
        );

        expect(sent).toBe(2);
        expect(used).toEqual([1, 2]);
    });

    test('the packet-burst cap covers a full inventory', () => {
        expect(HARD_LEATHER_BURST).toBeGreaterThanOrEqual(26);
    });
});

describe('stepDrain', () => {
    test('waits while the burst is still draining', () => {
        const first = stepDrain(newDrain(26), 21);

        expect(first.action).toBe('wait');
        expect(first.state.idle).toBe(0);
        expect(first.state.last).toBe(21);
    });

    test('done once the pack is empty of leather', () => {
        expect(stepDrain(newDrain(26), 0).action).toBe('done');
    });

    test('re-fires only after the stall threshold, not on the first quiet tick', () => {
        const once = stepDrain(newDrain(26), 26);

        expect(once.action).toBe('wait');
        expect(once.state.idle).toBe(1);
        expect(once.state.refires).toBe(0);
        expect(once.state.idle).toBeLessThan(STALL_TICKS);
    });

    test('banks once the re-fire budget is spent', () => {
        let state = newDrain(26);
        const actions: string[] = [];
        for (let i = 0; i < (STALL_TICKS + 1) * (MAX_REFIRES + 2); i++) {
            const step = stepDrain(state, 26);
            state = step.state;
            actions.push(step.action);
            if (step.action === 'bank') {
                break;
            }
        }

        expect(actions.filter(a => a === 'refire').length).toBe(MAX_REFIRES);
        expect(actions[actions.length - 1]).toBe('bank');
    });

    test('banks immediately when the thread is gone rather than re-firing into a dead burst', () => {
        const step = stepDrain(newDrain(26), 26, true);

        expect(step.action).toBe('bank');
        expect(step.state.refires).toBe(0);
    });

    test('a drop mid-stall clears the idle count instead of re-firing', () => {
        const stalled = stepDrain(newDrain(26), 26);
        const resumed = stepDrain(stalled.state, 20);

        expect(resumed.action).toBe('wait');
        expect(resumed.state.idle).toBe(0);
        expect(resumed.state.refires).toBe(0);
    });
});

describe('predictLeatherSlots', () => {
    test('takes the lowest free slots and stops at want', () => {
        expect(predictLeatherSlots([{ slot: 0, id: 1733 }], new Set(), 28, 3)).toEqual([1, 2, 3]);
    });

    test('treats a deposited id as freeing its slot', () => {
        // the body leaves, so its slot is free again and the withdrawal reuses it
        expect(predictLeatherSlots([{ slot: 0, id: 1733 }, { slot: 1, id: 1131 }], new Set([1131]), 28, 2)).toEqual([1, 2]);
    });

    test('never predicts a slot that keeps an item', () => {
        const slots = predictLeatherSlots([{ slot: 5, id: 1734 }], new Set(), 6, 6);
        expect(slots).not.toContain(5);
        expect(slots).toEqual([0, 1, 2, 3, 4]);
    });

    test('returns nothing when the pack is full of kept items', () => {
        const full = Array.from({ length: 28 }, (_, slot) => ({ slot, id: 1733 }));
        expect(predictLeatherSlots(full, new Set(), 28, 4)).toEqual([]);
    });
});

describe('findOp', () => {
    test('is 1-based, as the menu actions expect', () => {
        expect(findOp(['Deposit-1', 'Deposit-5', 'Deposit-All'], /deposit[\s-]*all/i)).toBe(3);
    });

    test('skips null ops', () => {
        expect(findOp([null, 'Withdraw-All'], /withdraw[\s-]*all/i)).toBe(2);
    });

    test('is -1 when nothing matches', () => {
        expect(findOp(['Deposit-1'], /withdraw[\s-]*all/i)).toBe(-1);
    });
});

describe('sideCacheFrom', () => {
    const rows = [{ id: 1131, comId: 5386, ops: ['Deposit-1', 'Deposit-All'] }];

    test('caches the component and 1-based Deposit-All', () => {
        expect(sideCacheFrom(rows, 1131, findOp)).toEqual({ comId: 5386, op: 2 });
    });

    test('is null when the body is absent, which keeps Tier 2 out of the session', () => {
        expect(sideCacheFrom(rows, 1743, findOp)).toBeNull();
    });

    test('is null when the row has no Deposit-All', () => {
        expect(sideCacheFrom([{ id: 1131, comId: 5386, ops: ['Deposit-1'] }], 1131, findOp)).toBeNull();
    });
});
