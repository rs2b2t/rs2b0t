import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { EC_ID, EC_STAGE } from '#/bot/api/ai/quests/defs/ernest/areas.js';
import { decide, ernest } from '#/bot/api/ai/quests/defs/ernest/index.js';
import { QUEST_DEFS } from '#/bot/api/ai/quests/defs/index.js';
import { QuestFood } from '#/bot/api/ai/quests/food.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

const originalFood = QuestFood.name;
beforeAll(() => { QuestFood.name = 'Lobster'; });
afterAll(() => { QuestFood.name = originalFood; });

/** Kitted out by default, so every case exercises the branch it names. */
function snap(options: {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    invIds?: [number, number][];
    tile?: QuestSnapshot['tile'];
} = {}): QuestSnapshot {
    const stage = options.stage ?? EC_STAGE.NOT_STARTED;
    return {
        journal: options.journal ?? (stage === EC_STAGE.NOT_STARTED ? 'notStarted' : 'inProgress'),
        inv: new Map([['lobster', 8]]),
        invIds: new Map([[EC_ID.SPADE, 1], ...(options.invIds ?? [])]),
        worn: new Set(),
        wornIds: new Set(),
        noProgress: 0,
        bankCoins: 2_000_000,
        stage,
        progress: { stage, flags: new Set() },
        bank: new Map(),
        bankIds: new Map(),
        bankKnown: true,
        tile: options.tile ?? { x: 3093, z: 3243, level: 0 },
        freeSlots: 20
    };
}

const step = (options: Parameters<typeof snap>[0] = {}): QuestStep => decide(snap(options));
const talkTo = (s: QuestStep): string | undefined => (s.kind === 'talk' ? s.stop.npc : undefined);
const customName = (s: QuestStep): string | undefined => (s.kind === 'custom' ? s.name : undefined);

const ALL_PARTS: [number, number][] = [
    [EC_ID.RUBBER_TUBE, 1], [EC_ID.PRESSURE_GAUGE, 1], [EC_ID.OIL_CAN, 1]
];

describe('Ernest the Chicken decide()', () => {
    test('waits while the journal is unknown', () => {
        // 'unknown' is not 'notStarted': restarting a finished quest is the worst outcome.
        expect(step({ journal: 'unknown' }).kind).toBe('wait');
    });

    test('is done once the journal reads complete', () => {
        expect(step({ journal: 'complete', stage: EC_STAGE.COMPLETE }).kind).toBe('done');
    });

    test('starts with Veronica', () => {
        expect(talkTo(step({ stage: EC_STAGE.NOT_STARTED }))).toBe('Veronica');
    });

    test('goes to Oddenstein once the quest has started', () => {
        expect(talkTo(step({ stage: EC_STAGE.STARTED }))).toBe('Professor Oddenstein');
    });

    test('collects the rubber tube first — it is the only leg inside the manor', () => {
        expect(customName(step({ stage: EC_STAGE.SPOKEN_ODDENSTEIN }))).toBe('fetch the rubber tube');
    });

    test('then the oil can, because the basement is entered from the same floor', () => {
        const s = step({ stage: EC_STAGE.SPOKEN_ODDENSTEIN, invIds: [[EC_ID.RUBBER_TUBE, 1]] });
        expect(customName(s)).toBe('fetch the oil can');
    });

    test('then the pressure gauge, which is the one leg that leaves the manor', () => {
        const s = step({
            stage: EC_STAGE.SPOKEN_ODDENSTEIN,
            invIds: [[EC_ID.RUBBER_TUBE, 1], [EC_ID.OIL_CAN, 1]]
        });
        expect(customName(s)).toBe('fetch the pressure gauge');
    });

    test('hands everything to Oddenstein once all three parts are held', () => {
        expect(talkTo(step({ stage: EC_STAGE.SPOKEN_ODDENSTEIN, invIds: ALL_PARTS }))).toBe('Professor Oddenstein');
    });

    test('keys its way out of the closet before doing anything else', () => {
        // The closet is a sealed ten-tile room; a bank trip from inside it spends
        // the step budget proving the world unreachable.
        const stuck = step({ stage: EC_STAGE.SPOKEN_ODDENSTEIN, tile: { x: 3111, z: 3367, level: 0 } });
        expect(customName(stuck)).toBe('leave the closet');
    });

    test('the closet escape outranks even the supply trip', () => {
        const bare = decide({
            ...snap({ stage: EC_STAGE.SPOKEN_ODDENSTEIN, tile: { x: 3111, z: 3367, level: 0 } }),
            invIds: new Map()
        });
        expect(customName(bare)).toBe('leave the closet');
    });

    test('escapes the basement once the can is held, ahead of the gauge leg', () => {
        // Observed live: the climb-out failed, and every later leg then spent its
        // budget planning a route out of a sealed pocket.
        const inBasement = step({
            stage: EC_STAGE.SPOKEN_ODDENSTEIN,
            invIds: [[EC_ID.RUBBER_TUBE, 1], [EC_ID.OIL_CAN, 1]],
            tile: { x: 3117, z: 9755, level: 0 }
        });
        expect(customName(inBasement)).toBe('leave the manor basement');
    });

    test('escapes the ladder alcove once the can is held', () => {
        const inAlcoveTile = step({
            stage: EC_STAGE.SPOKEN_ODDENSTEIN,
            invIds: [[EC_ID.RUBBER_TUBE, 1], [EC_ID.OIL_CAN, 1]],
            tile: { x: 3094, z: 3362, level: 0 }
        });
        expect(customName(inAlcoveTile)).toBe('leave the manor basement');
    });

    test('does not fight fetchOilCan for the pocket before the can is held', () => {
        // Without the can, being in the basement is where the leg belongs;
        // escaping would bounce the two against each other forever.
        const goingIn = step({
            stage: EC_STAGE.SPOKEN_ODDENSTEIN,
            invIds: [[EC_ID.RUBBER_TUBE, 1]],
            tile: { x: 3117, z: 9755, level: 0 }
        });
        expect(customName(goingIn)).toBe('fetch the oil can');
    });

    test('a tile just outside the closet is not treated as inside it', () => {
        const outside = step({ stage: EC_STAGE.SPOKEN_ODDENSTEIN, tile: { x: 3107, z: 3367, level: 0 } });
        expect(customName(outside)).toBe('fetch the rubber tube');
    });

    test('fetches a spade before anything that needs one', () => {
        const bare = decide({ ...snap({ stage: EC_STAGE.SPOKEN_ODDENSTEIN }), invIds: new Map() });
        expect(['grabGround', 'withdraw', 'scanBank']).toContain(bare.kind);
    });

    test('is registered in the queue and pins the Draynor bank', () => {
        expect(QUEST_DEFS.some(d => d.record.id === 'haunted')).toBe(true);
        // The engine calls a gather fn instead of decide() while a record item is
        // missing, which would fetch the oil can before Veronica was spoken to.
        expect(ernest.ownsInventory).toBe(true);
        expect(ernest.bank).not.toBe('nearest');
    });
});
