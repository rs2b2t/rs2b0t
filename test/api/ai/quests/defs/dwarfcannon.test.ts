import { describe, expect, test } from 'bun:test';
import type { WorldTile } from '#/bot/adapter/ClientAdapter.js';
import { CANNON_PARTS, MC_OBJ, RAILINGS } from '#/bot/api/ai/quests/defs/dwarfcannon/areas.js';
import { decide, dwarfcannon } from '#/bot/api/ai/quests/defs/dwarfcannon/index.js';
import { MC_FLAG, MC_STAGE } from '#/bot/api/ai/quests/defs/dwarfcannon/journal.js';
import { CANNON_CYCLE, cannonOutcome, inCave } from '#/bot/api/ai/quests/defs/dwarfcannon/repair.js';
import { defById } from '#/bot/api/ai/quests/defs/index.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

interface Options {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    flags?: string[];
    invIds?: number[];
    tile?: WorldTile | null;
}

function snap(options: Options = {}): QuestSnapshot {
    const stage = options.stage ?? MC_STAGE.NOT_STARTED;
    const invIds = new Map<number, number>();
    for (const id of options.invIds ?? []) {
        invIds.set(id, (invIds.get(id) ?? 0) + 1);
    }
    return {
        journal: options.journal ?? (stage === MC_STAGE.NOT_STARTED ? 'notStarted' : 'inProgress'),
        inv: new Map(),
        invIds,
        worn: new Set(),
        noProgress: 0,
        bankCoins: 0,
        stage,
        progress: { stage, flags: new Set(options.flags ?? []) },
        bank: new Map(),
        bankIds: new Map(),
        bankKnown: true,
        tile: options.tile === undefined ? { x: 2571, z: 3463, level: 0 } : options.tile,
        freeSlots: 20
    };
}

describe('dwarfcannon decide', () => {
    test('an unloaded journal waits rather than restarting the quest', () => {
        expect(decide(snap({ journal: 'unknown' })).kind).toBe('wait');
    });

    test('a complete journal is done', () => {
        expect(decide(snap({ journal: 'complete', stage: MC_STAGE.COMPLETE })).kind).toBe('done');
    });

    test('not started talks to the Commander', () => {
        const step = decide(snap());
        expect(step.kind).toBe('talk');
        expect(step.kind === 'talk' && step.stop.npc).toBe('Dwarf Commander');
    });

    test('railings done reports back to the Commander', () => {
        const step = decide(snap({ stage: MC_STAGE.RAILINGS, flags: [MC_FLAG.RAILINGS_DONE] }));
        expect(step.kind).toBe('talk');
    });

    test('holding the remains reports back to the Commander', () => {
        const step = decide(
            snap({
                stage: MC_STAGE.GUARD_TOWER,
                flags: [MC_FLAG.HAS_REMAINS],
                invIds: [MC_OBJ.REMAINS.id]
            })
        );
        expect(step.kind).toBe('talk');
    });

    test('the child is rescued, so the Commander is next', () => {
        expect(decide(snap({ stage: MC_STAGE.CHILD_RESCUED })).kind).toBe('talk');
    });

    test('the cannon is fixed, so the Commander is next', () => {
        expect(decide(snap({ stage: MC_STAGE.CANNON_FIXED })).kind).toBe('talk');
    });

    test('stage 9 talks to Nulodion', () => {
        const step = decide(snap({ stage: MC_STAGE.SEE_NULODION }));
        expect(step.kind).toBe('talk');
        expect(step.kind === 'talk' && step.stop.npc).toBe('Nulodion');
    });

    test('stage 10 holding both hands them to the Commander', () => {
        const step = decide(
            snap({ stage: MC_STAGE.RETURN_NOTES, invIds: [MC_OBJ.NOTES.id, MC_OBJ.MOULD.id] })
        );
        expect(step.kind).toBe('talk');
        expect(step.kind === 'talk' && step.stop.npc).toBe('Dwarf Commander');
    });

    test('stage 10 missing the mould goes back to Nulodion for a replacement', () => {
        const step = decide(snap({ stage: MC_STAGE.RETURN_NOTES, invIds: [MC_OBJ.NOTES.id] }));
        expect(step.kind).toBe('talk');
        expect(step.kind === 'talk' && step.stop.npc).toBe('Nulodion');
    });
});

describe('railings', () => {
    test('stage 1 without the flag runs the railing loop', () => {
        const step = decide(snap({ stage: MC_STAGE.RAILINGS }));
        expect(step.kind).toBe('custom');
        expect(step.kind === 'custom' && step.name).toContain('railing');
    });

    test('six railings, each a distinct loc id and tile', () => {
        expect(RAILINGS).toHaveLength(6);
        expect(new Set(RAILINGS.map(r => r.id)).size).toBe(6);
        expect(new Set(RAILINGS.map(r => `${r.at.x},${r.at.z}`)).size).toBe(6);
    });

    test('the loc ids are the contiguous content block 15..20', () => {
        expect(RAILINGS.map(r => r.id)).toEqual([15, 16, 17, 18, 19, 20]);
    });
});

describe('watchtower', () => {
    test('stage 2 without the remains climbs the tower', () => {
        const step = decide(snap({ stage: MC_STAGE.GUARD_TOWER }));
        expect(step.kind).toBe('custom');
        expect(step.kind === 'custom' && step.name).toContain('watchtower');
    });

    test('the remains outrank a journal that has not caught up', () => {
        const step = decide(snap({ stage: MC_STAGE.GUARD_TOWER, invIds: [MC_OBJ.REMAINS.id] }));
        expect(step.kind).toBe('talk');
    });
});

describe('goblin cave', () => {
    test('stage 3 enters the cave', () => {
        const step = decide(snap({ stage: MC_STAGE.GOBLIN_CAVE }));
        expect(step.kind).toBe('custom');
    });

    test('stage 4 searches the crate', () => {
        const step = decide(snap({ stage: MC_STAGE.FIND_CHILD, tile: { x: 2620, z: 9797, level: 0 } }));
        expect(step.kind).toBe('custom');
        expect(step.kind === 'custom' && step.name).toContain('crate');
    });

    test('the rescued child is walked out of the cave before the Commander', () => {
        const step = decide(
            snap({ stage: MC_STAGE.CHILD_RESCUED, tile: { x: 2571, z: 9850, level: 0 } })
        );
        expect(step.kind).toBe('custom');
        expect(step.kind === 'custom' && step.name).toContain('mud pile');
    });

    test('the cave is recognised by the underground z band', () => {
        expect(inCave({ z: 9797 })).toBe(true);
        expect(inCave({ z: 3463 })).toBe(false);
        expect(inCave(null)).toBe(false);
    });
});

describe('cannon repair', () => {
    test('stage 6 runs the repair loop', () => {
        const step = decide(snap({ stage: MC_STAGE.FIX_CANNON, invIds: [MC_OBJ.TOOLKIT.id] }));
        expect(step.kind).toBe('custom');
        expect(step.kind === 'custom' && step.name).toContain('cannon');
    });

    test('a lost toolkit sends the bot back to the Commander, who re-issues one', () => {
        const step = decide(snap({ stage: MC_STAGE.FIX_CANNON }));
        expect(step.kind).toBe('talk');
        expect(step.kind === 'talk' && step.stop.npc).toBe('Dwarf Commander');
    });

    test('four damaged components, in menu order', () => {
        expect(CANNON_PARTS).toEqual(['Pipe', 'Barrel', 'Axle', 'Shaft']);
    });

    test('the contraption line ends the loop, because the stage has moved past the repair', () => {
        expect(cannonOutcome("It's a strange dwarf contraption.")).toBe('done');
    });

    test('the repair outcomes still read off their own messages', () => {
        expect(cannonOutcome('After some tinkering you manage to fix it.')).toBe('fixed');
        expect(cannonOutcome("You've already fixed this part of the cannon.")).toBe('already');
        expect(cannonOutcome("You try, but can't quite find the problem.")).toBe('retry');
        expect(cannonOutcome("It's too hard you fail to fix it.")).toBe('retry');
    });

    test('every outcome message also ends the drive, or the step waits out its timeout', () => {
        for (const line of [
            "It's a strange dwarf contraption.",
            'After some tinkering you manage to fix it.',
            "You've already fixed this part of the cannon.",
            "You try, but can't quite find the problem.",
            "It's too hard you fail to fix it."
        ]) {
            expect(CANNON_CYCLE.test(line)).toBe(true);
        }
    });
});

describe('dwarfcannon module', () => {
    test('is registered', () => {
        expect(defById('mcannon')).toBe(dwarfcannon);
    });

    test('requires no items, so nothing is provisioned up front', () => {
        expect(dwarfcannon.record.items).toEqual([]);
    });

    test('keeps every carried quest item off the spillover deposit', () => {
        for (const name of ['tool kit', 'dwarf remains', "nulodion's notes", 'ammo mould', 'railing']) {
            expect(dwarfcannon.tools).toContain(name);
        }
    });
});
