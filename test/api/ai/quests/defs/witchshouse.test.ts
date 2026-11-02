import { beforeEach, describe, expect, test } from 'bun:test';
import type { WorldTile } from '#/bot/adapter/ClientAdapter.js';
import { WH_OBJ, inGarden, inShed } from '#/bot/api/ai/quests/defs/witchshouse/areas.js';
import { DiaryState, decide, resetDiaryState, witchshouse } from '#/bot/api/ai/quests/defs/witchshouse/index.js';
import { WH_STAGE } from '#/bot/api/ai/quests/defs/witchshouse/journal.js';
import { leaveGarden } from '#/bot/api/ai/quests/defs/witchshouse/garden.js';
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

describe('witchshouse recovers a banked shed key', () => {
    const garden = { x: 2911, z: 3469, level: 0 };
    const porch = { x: 2901, z: 3466, level: 0 };
    const base = () => snap({ stage: WH_STAGE.UNLOCKED_DOOR, ids: [WH_OBJ.DOOR_KEY] });

    test('withdraws the exact shed key instead of checking a fountain that counts the bank', () => {
        const state = { ...base(), bankIds: new Map([[2411, 1]]) };
        expect(decide(state)).toMatchObject({ kind: 'withdraw', items: [{ name: 'Key', id: 2411, qty: 1 }] });
    });

    test('scans an unread bank before concluding the shed key is missing', () => {
        expect(decide({ ...base(), bankKnown: false })).toMatchObject({ kind: 'scanBank' });
    });

    test('leaves the garden through its safe route before recovering the banked key', () => {
        const state = { ...base(), tile: garden, bankIds: new Map([[2411, 1]]) };
        const step = decide(state);
        expect(step.kind === 'custom' && step.run).toBe(leaveGarden);
        expect(decide({ ...state, tile: porch })).toMatchObject({ kind: 'withdraw', items: [{ id: 2411, qty: 1 }] });
    });

    test('leaves the garden safely before its first bank scan', () => {
        const state = { ...base(), tile: garden, bankKnown: false };
        const step = decide(state);
        expect(step.kind === 'custom' && step.run).toBe(leaveGarden);
        expect(decide({ ...state, tile: porch })).toMatchObject({ kind: 'scanBank' });
    });

    test('a held key and an unfinished fight outrank an unknown bank', () => {
        const state = { ...base(), tile: garden, bankKnown: false, invIds: new Map([[2409, 1], [2411, 1]]) };
        expect(named(decide(state))).toContain('kill the experiment');
        expect(named(decide({ ...base(), tile: { x: 2935, z: 3461, level: 0 }, bankKnown: false })))
            .toContain('kill the experiment');
    });

    test('a different banked Key does not suppress the fountain after a known bank scan', () => {
        DiaryState.read = true;
        const state = { ...base(), tile: garden, bank: new Map([['key', 1]]), bankIds: new Map([[1540, 1]]) };
        expect(named(decide(state))).toContain('fountain');
    });
});

describe('witchshouse uses a fire staff', () => {
    const base = (): QuestSnapshot => ({
        ...snap({ stage: WH_STAGE.UNLOCKED_DOOR, ids: [WH_OBJ.DOOR_KEY] }),
        magic: 50, attack: 50, inv: new Map([['mind rune', 150], ['air rune', 300], ['coins', 2000]])
    });

    test('equips a carried staff before checking the bank or buying runes', () => {
        const state = { ...base(), bankKnown: false, invIds: new Map([[2409, 1], [1387, 1]]) };
        expect(decide(state)).toEqual({ kind: 'equip', item: 'Staff of fire' });
    });

    test('withdraws the cheapest usable banked fire staff', () => {
        const state = { ...base(), bankIds: new Map([[1401, 1], [1393, 1], [1387, 1]]) };
        expect(decide(state)).toMatchObject({ kind: 'withdraw', items: [{ name: 'Staff of fire', id: 1387, qty: 1 }] });
        expect(decide({ ...state, bankIds: new Map([[1401, 1], [1393, 1]]) }))
            .toMatchObject({ kind: 'withdraw', items: [{ name: 'Fire battlestaff', id: 1393, qty: 1 }] });
    });

    test('scans before buying and buys a basic fire staff from Zaff when no usable one is owned', () => {
        expect(decide({ ...base(), bankKnown: false })).toMatchObject({ kind: 'scanBank' });
        expect(decide(base())).toMatchObject({ kind: 'buy', item: 'Staff of fire', qty: 1, shop: { npc: 'Zaff' } });
        expect(decide({ ...base(), attack: 1, bankIds: new Map([[1393, 1]]) }))
            .toMatchObject({ kind: 'buy', item: 'Staff of fire', shop: { npc: 'Zaff' } });
    });

    test('tops up the standard coin float before attempting the staff purchase', () => {
        const state = { ...base(), inv: new Map([['coins', 1000]]) };
        expect(decide(state)).toMatchObject({ kind: 'withdraw', items: [{ name: 'Coins', qty: 1000 }] });
    });

    test('a fully supplied fight proceeds without staff money or a bank detour', () => {
        const state = { ...base(), bankKnown: false, bankCoins: 0,
            inv: new Map([['mind rune', 150], ['air rune', 300], ['fire rune', 450]]),
            invIds: new Map([[2409, 1], [2411, 1]]) };
        expect(named(decide(state))).toContain('kill the experiment');
        expect(witchshouse.foodReady?.(state)).toBe(true);
    });

    test.each([[0, 450], [100, 350]])('uses held %i plus banked %i fire runes before buying a staff', (held, banked) => {
        const state = { ...base(), inv: new Map([...base().inv, ['fire rune', held]]), bank: new Map([['fire rune', banked]]) };
        expect(decide(state)).toMatchObject({ kind: 'withdraw', items: [{ name: 'Fire rune', qty: banked }] });
    });

    test('an unaffordable staff does not block buying a small rune shortfall', () => {
        const state = { ...base(), bankCoins: 0,
            inv: new Map([['mind rune', 150], ['air rune', 300], ['fire rune', 449], ['coins', 1000]]) };
        expect(decide(state)).toMatchObject({ kind: 'buy', item: 'Fire rune', qty: 1, shop: { npc: 'Betty' } });
    });

    test('an equipped staff removes fire rune purchases and still recovers the banked shed key', () => {
        const state = { ...base(), worn: new Set(['staff of fire']), wornIds: new Set([1387]), bankIds: new Map([[2411, 1]]) };
        expect(decide(state)).toMatchObject({ kind: 'withdraw', items: [{ name: 'Key', id: 2411, qty: 1 }] });
        expect(decide({ ...state, inv: new Map([['mind rune', 150], ['air rune', 100]]) }))
            .toMatchObject({ kind: 'buy', item: 'Air rune', qty: 200 });
    });

    test('does not leave a resumed garden fight to shop but equips an already carried staff', () => {
        const state = { ...base(), tile: { x: 2911, z: 3469, level: 0 }, invIds: new Map([[2409, 1], [2411, 1]]) };
        expect(named(decide(state))).toContain('kill the experiment');
        expect(decide({ ...state, invIds: new Map([...state.invIds, [1387, 1]]) }))
            .toEqual({ kind: 'equip', item: 'Staff of fire' });
    });

    test('rune inventory clearing keeps a carried fire staff and the shed key', () => {
        const state = { ...base(), worn: new Set(['staff of fire']), invIds: new Map([[2409, 1], [2411, 1]]),
            inv: new Map([['staff of fire', 1], ['key', 1], ['logs', 26]]), freeSlots: 0 };
        const step = decide(state);
        expect(step.kind).toBe('deposit');
        expect(step.kind === 'deposit' && step.keep).toContain('staff of fire');
        expect(step.kind === 'deposit' && step.keep).toContain('key');
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
