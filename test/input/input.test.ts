import { describe, expect, test } from 'bun:test';
import { Input } from '#/bot/input/Input.js';

describe('Input', () => {
    test('exposes every driver operation', () => {
        for (const op of [
            'interactNpc',
            'interactPlayer',
            'interactLoc',
            'takeObj',
            'heldOp',
            'invButton',
            'useItemOnLoc',
            'useItemOnNpc',
            'useItemOnItem',
            'useItemOnObj',
            'castOnNpc',
            'walk',
            'continueDialog'
        ]) {
            expect(typeof (Input as unknown as Record<string, unknown>)[op]).toBe('function');
        }
    });
});
