import { describe, expect, test } from 'bun:test';

import { CLUE_GATES, clueGate } from '#/bot/api/ai/clues/data/clueGates.js';
import type { QuestStatus } from '#/bot/api/ui/questlog/Quests.js';

const always = (status: QuestStatus) => (): QuestStatus => status;

/** The three Isafdar / elf-camp clues, all gated on Regicide. */
const TIRANNWN = [3560, 3562, 3564];

describe('clueGate', () => {
    test('an ungated clue is open whatever the journal says', () => {
        expect(clueGate(2677, always('notStarted'))).toBeNull();
    });

    test('a Tirannwn clue is open once Regicide reads complete', () => {
        for (const id of TIRANNWN) {
            expect(clueGate(id, always('complete')), `clue ${id}`).toBeNull();
        }
    });

    test('a Tirannwn clue is blocked while Regicide is unfinished', () => {
        for (const id of TIRANNWN) {
            expect(clueGate(id, always('notStarted')), `clue ${id}`).toContain('Regicide');
            expect(clueGate(id, always('inProgress')), `clue ${id}`).toContain('Regicide');
        }
    });

    // Why: `unknown` is the quest tab not loaded yet, not a finished quest, so it must not open the gate.
    test('an unloaded quest tab keeps the gate shut', () => {
        expect(clueGate(3564, always('unknown'))).toContain('Regicide');
    });

    test('the block names the quest and the observed status', () => {
        expect(clueGate(3564, always('inProgress'))).toBe(
            'Lord Iorwerth is in the elf camp (Regicide reads inProgress)'
        );
    });

    test('every gate asks about the quest it names', () => {
        const asked: string[] = [];
        for (const id of Object.keys(CLUE_GATES).map(Number)) {
            clueGate(id, name => {
                asked.push(name);
                return 'complete';
            });
        }
        expect(asked.length).toBe(Object.keys(CLUE_GATES).length);
        expect(asked).toEqual(Object.values(CLUE_GATES).map(g => g.quest));
    });
});
