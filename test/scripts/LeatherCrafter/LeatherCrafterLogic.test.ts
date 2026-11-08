import { describe, expect, test } from 'bun:test';

import { HARD_LEATHER_BURST, issueHardLeatherBurst } from '../../../src/bot/scripts/LeatherCrafter/LeatherCrafterLogic.js';

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
