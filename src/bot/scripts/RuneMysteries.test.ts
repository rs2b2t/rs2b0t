import { expect, test, describe } from 'bun:test';
import { heldQuestItem, nextStep } from './RuneMysteries.js';

describe('heldQuestItem', () => {
    test('exact case-insensitive full-name matches only', () => {
        expect(heldQuestItem(['Air talisman'])).toBe('talisman');
        expect(heldQuestItem(['research package'])).toBe('package');
        expect(heldQuestItem(['Notes'])).toBe('notes');
        // 'Notes' is generic — substring/partial names must NOT match
        expect(heldQuestItem(['Research notes'])).toBeNull();
        expect(heldQuestItem(['Bronze axe', null, 'Coins'])).toBeNull();
    });

    test('most-advanced item wins when several are present', () => {
        expect(heldQuestItem(['Air talisman', 'Notes'])).toBe('notes');
        expect(heldQuestItem(['Air talisman', 'Research package'])).toBe('package');
    });
});

describe('nextStep', () => {
    test('journal drives the ends', () => {
        expect(nextStep('complete', null)).toBe('DONE');
        expect(nextStep('complete', 'notes')).toBe('DONE');
        expect(nextStep('unknown', null)).toBe('WAIT'); // tab not loaded yet
        expect(nextStep('notStarted', null)).toBe('DUKE');
        expect(nextStep('notStarted', 'talisman')).toBe('DUKE'); // impossible server-side; Duke flow is safe
    });

    test('held item drives the deliveries', () => {
        expect(nextStep('inProgress', 'talisman')).toBe('SEDRIDOR');
        expect(nextStep('inProgress', 'package')).toBe('AUBURY');
        expect(nextStep('inProgress', 'notes')).toBe('SEDRIDOR');
    });

    test('inProgress empty-handed probes (covers the natural second Aubury talk and every lost item)', () => {
        expect(nextStep('inProgress', null)).toBe('RECOVER');
    });
});
