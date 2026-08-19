import { describe, expect, test } from 'bun:test';

import { coordinateChoice } from '#/bot/api/ai/quests/defs/treegnome/stronghold.js';

const OPTIONS = ['0001', '0002', '0003', '0004', '0005'];

function asked(header: string): string[] {
    return [`@dbl@${header}`, ...OPTIONS];
}

describe('ballista coordinates', () => {
    // Why: the three prompts render the same five options, so the header text is the only thing that tells them apart.
    test('answers 4 for the height', () => {
        expect(coordinateChoice(asked('Enter the height-coordinate of the stronghold'), OPTIONS)).toBe('0004');
    });

    test('answers 3 for the x', () => {
        expect(coordinateChoice(asked('Enter the x-coordinate of the stronghold'), OPTIONS)).toBe('0003');
    });

    test('answers 5 for the y', () => {
        expect(coordinateChoice(asked('Enter the y-coordinate of the stronghold'), OPTIONS)).toBe('0005');
    });

    test('refuses to guess when no header names a coordinate', () => {
        expect(coordinateChoice(['Would you like to fire?'], ['Yes', 'No'])).toBeNull();
    });
});
