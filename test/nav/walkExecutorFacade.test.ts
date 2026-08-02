import { describe, expect, test } from 'bun:test';
import { WalkExecutor } from '#/bot/nav/WalkExecutor.js';
import { Traversal } from '#/bot/api/Traversal.js';

/**
 * Guard against nav exec-split regressions: Traversal.walkResilient and scripts
 * call methods on the WalkExecutor facade. #323 was tryNearbyDoor missing after
 * the doorCrossing extract.
 */
describe('WalkExecutor public facade (walkResilient / scripts)', () => {
    test('unstick + probe + walk surface is callable', () => {
        expect(typeof WalkExecutor.walkTo).toBe('function');
        expect(typeof WalkExecutor.tryNearbyDoor).toBe('function');
        expect(typeof WalkExecutor.probeDest).toBe('function');
        expect(typeof WalkExecutor.remaining).toBe('number');
        expect('lastOutcome' in WalkExecutor).toBe(true);
    });

    test('Traversal still delegates to WalkExecutor (not a free import of moved helpers)', () => {
        expect(typeof Traversal.walkTo).toBe('function');
        expect(typeof Traversal.walkResilient).toBe('function');
        expect(typeof Traversal.remaining).toBe('function');
        expect(typeof Traversal.preload).toBe('function');
    });
});
