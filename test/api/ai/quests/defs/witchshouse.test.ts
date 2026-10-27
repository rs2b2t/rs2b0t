import { beforeEach, describe, expect, test } from 'bun:test';
import type { WorldTile } from '#/bot/adapter/ClientAdapter.js';
import { WH_OBJ, inGarden, inShed } from '#/bot/api/ai/quests/defs/witchshouse/areas.js';
import { DiaryState, decide, resetDiaryState, witchshouse } from '#/bot/api/ai/quests/defs/witchshouse/index.js';
import { WH_STAGE } from '#/bot/api/ai/quests/defs/witchshouse/journal.js';
import { defById } from '#/bot/api/ai/quests/defs/index.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

interface Options {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    ids?: number[];
    worn?: number[];
    tile?: WorldTile | null;
}

function snap(options: Options = {}): QuestSnapshot {
    const stage = options.stage ?? WH_STAGE.NOT_STARTED;
    const invIds = new Map<number, number>();
    for (const id of options.ids ?? []) {
        invIds.set(id, (invIds.get(id) ?? 0) + 1);
    }
    return {
        journal: options.journal ?? (stage === WH_STAGE.NOT_STARTED ? 'notStarted' : 'inProgress'),
        inv: new Map([['mind rune', 150], ['air rune', 150]]),
        invIds,
        worn: new Set(),
        wornIds: new Set(options.worn ?? []),
        noProgress: 0,
        bankCoins: 5000,
        stage,
        progress: { stage, flags: new Set() },
        bank: new Map(),
        bankIds: new Map(),
        bankKnown: true,
        tile: options.tile === undefined ? { x: 2928, z: 3456, level: 0 } : options.tile,
        freeSlots: 20
    };
}

const named = (step: QuestStep): string => (step.kind === 'custom' ? step.name : step.kind);

const DRESSED = { worn: [WH_OBJ.GLOVES], ids: [WH_OBJ.DOOR_KEY] };

beforeEach(() => resetDiaryState());

describe('witchshouse decide', () => {
    test('an unloaded journal waits rather than restarting the quest', () => {
        expect(decide(snap({ journal: 'unknown' })).kind).toBe('wait');
    });

    test('a complete journal is done', () => {
        expect(decide(snap({ journal: 'complete', stage: WH_STAGE.COMPLETE })).kind).toBe('done');
    });

    test('an in-progress journal nothing parses waits rather than guessing a stage', () => {
        const blank = { ...snap({ journal: 'inProgress' }), stage: undefined, progress: undefined };
        expect(decide(blank).kind).toBe('wait');
    });

    test('not started talks to the boy', () => {
        const step = decide(snap());
        expect(step.kind).toBe('talk');
        expect(step.kind === 'talk' && step.stop.npc).toBe('Boy');
    });
});

describe('witchshouse gets into the house before anything else', () => {
    test('started with no door key looks under the flower pot', () => {
        expect(named(decide(snap({ stage: WH_STAGE.STARTED })))).toContain('flower pot');
    });

    test('a door key lost at the shed stage is replaced before the garden', () => {
        const step = decide(snap({ stage: WH_STAGE.UNLOCKED_DOOR, ids: [] }));
        expect(named(step)).toContain('flower pot');
    });

    test('the gloves are withdrawn when neither worn nor held', () => {
        const step = decide(snap({ stage: WH_STAGE.STARTED, ids: [WH_OBJ.DOOR_KEY] }));
        expect(step.kind).toBe('withdraw');
        expect(step).toMatchObject({ items: [{ name: 'Leather gloves', qty: 1, id: WH_OBJ.GLOVES }] });
    });

    test('held gloves are equipped, because the iron gate reads the worn slot', () => {
        const step = decide(snap({ stage: WH_STAGE.STARTED, ids: [WH_OBJ.DOOR_KEY, WH_OBJ.GLOVES] }));
        expect(step).toMatchObject({ kind: 'equip', item: 'Leather gloves' });
    });

    test('dressed and started, the cellar cupboard is the step', () => {
        expect(named(decide(snap({ stage: WH_STAGE.STARTED, ...DRESSED })))).toContain('cellar cupboard');
    });
});

describe('witchshouse unlocks the back door', () => {
    test('a magnet carried into stage 1 is dropped so the cupboard will hand one out', () => {
        const step = decide(snap({ stage: WH_STAGE.STARTED, worn: [WH_OBJ.GLOVES], ids: [WH_OBJ.DOOR_KEY, WH_OBJ.MAGNET] }));
        expect(named(step)).toContain('drop the magnet');
    });

    test('stage 2 with no magnet goes back to the cupboard', () => {
        expect(named(decide(snap({ stage: WH_STAGE.FOUND_MAGNET, ...DRESSED })))).toContain('cellar cupboard');
    });

    test('holding the magnet with no cheese buys another before the mouse hole', () => {
        const step = decide(snap({
            stage: WH_STAGE.FOUND_MAGNET,
            worn: [WH_OBJ.GLOVES],
            ids: [WH_OBJ.DOOR_KEY, WH_OBJ.MAGNET]
        }));
        expect(step.kind).toBe('buy');
        expect(step).toMatchObject({ item: 'Cheese', shop: { npc: 'Wydin' } });
    });

    test('holding both goes to the mouse, not the shop', () => {
        const step = decide(snap({
            stage: WH_STAGE.FOUND_MAGNET,
            worn: [WH_OBJ.GLOVES],
            ids: [WH_OBJ.DOOR_KEY, WH_OBJ.MAGNET, WH_OBJ.CHEESE]
        }));
        expect(named(step)).toContain('lure the mouse');
    });
});

describe('witchshouse reads the diary before it enters the garden', () => {
    test('stage 3 with no diary fetches one', () => {
        expect(named(decide(snap({ stage: WH_STAGE.UNLOCKED_DOOR, ids: [WH_OBJ.DOOR_KEY] })))).toContain('take the witch');
    });

    test('holding the diary reads it', () => {
        const step = decide(snap({ stage: WH_STAGE.UNLOCKED_DOOR, ids: [WH_OBJ.DOOR_KEY, WH_OBJ.DIARY] }));
        expect(named(step)).toContain('read the witch');
    });

    test('once read, the fountain is the step', () => {
        DiaryState.read = true;
        const step = decide(snap({ stage: WH_STAGE.UNLOCKED_DOOR, ids: [WH_OBJ.DOOR_KEY, WH_OBJ.DIARY] }));
        expect(named(step)).toContain('fountain');
    });

    test('a diary that cannot be fetched stops blocking the quest', () => {
        DiaryState.tries = 3;
        expect(named(decide(snap({ stage: WH_STAGE.UNLOCKED_DOOR, ids: [WH_OBJ.DOOR_KEY] })))).toContain('fountain');
    });

    // Why: the walk out of the garden is where `witch.rs2` deletes the key, so a diary detour with one
    // in the pack throws away the leg that earned it.
    test('a shed key already held outranks the diary', () => {
        const step = decide(snap({ stage: WH_STAGE.UNLOCKED_DOOR, ids: [WH_OBJ.DOOR_KEY, WH_OBJ.SHED_KEY] }));
        expect(named(step)).toContain('kill the experiment');
    });
});

describe('witchshouse finishes at the shed', () => {
    test('the experiment dead and no ball goes back for it', () => {
        expect(named(decide(snap({ stage: WH_STAGE.DEFEATED, ids: [WH_OBJ.DOOR_KEY] })))).toContain('take the ball');
    });

    test('the ball in the pack goes to the boy', () => {
        const step = decide(snap({ stage: WH_STAGE.DEFEATED, ids: [WH_OBJ.BALL] }));
        expect(step.kind).toBe('talk');
    });

    // Why: `witch.rs2` deletes the ball as well as the key, and the boy is where she drops you.
    test('a ball taken back by the witch is fetched again rather than handed in', () => {
        const step = decide(snap({
            stage: WH_STAGE.DEFEATED,
            ids: [WH_OBJ.DOOR_KEY],
            tile: { x: 2929, z: 3456, level: 0 }
        }));
        expect(named(step)).toContain('take the ball');
    });
});

describe('witchshouse areas', () => {
    test('the porch is not the garden, though they share a row', () => {
        expect(inGarden({ x: 2901, z: 3466, level: 0 })).toBe(false);
        expect(inGarden({ x: 2901, z: 3465, level: 0 })).toBe(true);
    });

    test('the fountain yard and the ring corridor are both the garden', () => {
        expect(inGarden({ x: 2911, z: 3470, level: 0 })).toBe(true);
        expect(inGarden({ x: 2933, z: 3463, level: 0 })).toBe(true);
    });

    test('the shed is its own room, not the garden', () => {
        expect(inShed({ x: 2935, z: 3461, level: 0 })).toBe(true);
        expect(inGarden({ x: 2935, z: 3461, level: 0 })).toBe(false);
    });

    test('nothing upstairs counts as the garden', () => {
        expect(inGarden({ x: 2911, z: 3470, level: 1 })).toBe(false);
    });
});

describe('witchshouse module wiring', () => {
    test("the def is registered under the record's id", () => {
        expect(defById('ball')).toBe(witchshouse);
    });

    test('a journal reader is declared, so decide runs off a stage and not the pack', () => {
        expect(witchshouse.readProgress).toBeDefined();
    });

    test('the fight declares the melee protection it needs', () => {
        expect(witchshouse.pray).toMatchObject({ protect: 'melee' });
    });
});
