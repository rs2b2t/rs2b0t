import { describe, expect, test } from 'bun:test';

import { HARD_LEATHER_BURST, issueHardLeatherBurst } from '../../../src/bot/scripts/LeatherCrafter/LeatherCrafterLogic.js';

describe('issueHardLeatherBurst', () => {
    test('uses ten distinct slots in order', async () => {
        const used: number[] = [];
        const sent = await issueHardLeatherBurst(
            Array.from({ length: 26 }, (_, slot) => slot),
            slot => {
                used.push(slot);
                return true;
            }
        );

        expect(sent).toBe(HARD_LEATHER_BURST);
        expect(used).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    test('uses every slot when fewer than ten remain', async () => {
        const used: number[] = [];
        const sent = await issueHardLeatherBurst([4, 8, 12], slot => {
            used.push(slot);
            return true;
        });

        expect(sent).toBe(3);
        expect(used).toEqual([4, 8, 12]);
    });

    test('stops when an input action is rejected', async () => {
        const used: number[] = [];
        const sent = await issueHardLeatherBurst([1, 2, 3, 4], async slot => {
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
});
