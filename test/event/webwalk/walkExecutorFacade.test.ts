import { describe, expect, test } from 'bun:test';
import { WalkExecutor } from '#/bot/event/webwalk/WalkExecutor.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';

// Why: Traversal.walkResilient and scripts call the WalkExecutor facade, so an exec split can drop a method with no compile error.
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
