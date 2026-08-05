import { describe, expect, test } from 'bun:test';
import { isQuestLockDialogue, isQuestLockText } from '#/bot/nav/exec/questLock.js';

describe('quest lock dialogue', () => {
    test('matches common lock phrases', () => {
        expect(isQuestLockText('The door is locked.')).toBe(true);
        expect(isQuestLockText('You need a key to open this door.')).toBe(true);
        expect(isQuestLockText("You can't open this door.")).toBe(true);
        expect(isQuestLockText('Members only area.')).toBe(true);
        expect(isQuestLockText('You must complete the quest first.')).toBe(true);
        expect(isQuestLockText('Hello, traveller.')).toBe(false);
        expect(isQuestLockText('Yes, ok.')).toBe(false);
    });

    test('any line in chat modal', () => {
        expect(isQuestLockDialogue(['Ulizius looks at you.', 'The gate is locked.'])).toBe(true);
        expect(isQuestLockDialogue(['How can I help you?'])).toBe(false);
    });
});
