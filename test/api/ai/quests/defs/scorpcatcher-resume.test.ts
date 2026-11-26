import { describe, expect, test } from 'bun:test';

import { EVERY_CAGE, SC_STAGE } from '#/bot/api/ai/quests/defs/scorpcatcher/areas.js';
import { decide } from '#/bot/api/ai/quests/defs/scorpcatcher/index.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

import { snap as scorpionSnapshot } from './scorpcatcher-snapshot.fixture.js';

const STAGES = [SC_STAGE.STARTED, SC_STAGE.FIRST_HINT, SC_STAGE.SECOND_HINT];

/** Every place a cage can be sitting when a run resumes. */
const WHERE = ['pack', 'bank', 'lost'] as const;

function snap(stage: number, cage: number | null, where: (typeof WHERE)[number]): QuestSnapshot {
    return scorpionSnapshot({
        stage,
        invIds: where === 'pack' && cage !== null ? [cage] : [],
        bankIds: where === 'bank' && cage !== null ? [cage] : []
    });
}

// Why: the engine restarts a killed run by re-deciding from the snapshot, so a state that answers `wait` is a state the quest can never leave.

describe('Scorpion Catcher resumability', () => {
    test('every stage and cage position decides on work to do', () => {
        const parked: string[] = [];
        for (const stage of STAGES) {
            for (const where of WHERE) {
                for (const cage of where === 'lost' ? [null] : EVERY_CAGE) {
                    const step = decide(snap(stage, cage, where));
                    if (step.kind === 'wait' || step.kind === 'done') {
                        parked.push(`stage ${stage} · cage ${cage ?? 'none'} in the ${where} → ${step.kind}`);
                    }
                }
            }
        }
        expect(parked).toEqual([]);
    });

    test('a lost cage is replaced rather than waited on', () => {
        for (const stage of STAGES) {
            const step = decide(snap(stage, null, 'lost'));
            expect(step.kind === 'talk' && step.stop.npc).toBe('Thormac');
        }
    });

    // Why: a cage in the bank is the caught scorpions in the bank, and the journal cannot see them, so the withdraw has to name the exact obj.
    test('a banked cage is always withdrawn before anything else', () => {
        for (const stage of STAGES) {
            for (const cage of EVERY_CAGE) {
                const step = decide(snap(stage, cage, 'bank'));
                expect(step.kind).toBe('withdraw');
                expect(step.kind === 'withdraw' && step.items[0]?.id).toBe(cage);
            }
        }
    });
});
