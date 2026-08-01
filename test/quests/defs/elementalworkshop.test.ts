import { describe, expect, test } from 'bun:test';
import {
    COAL_NEED,
    EW_FLAG,
    EW_ITEM,
    EW_STAGE,
    decide,
    elementalworkshop,
    ewArea,
    parseElementalWorkshopJournal
} from '#/bot/quests/defs/elementalworkshop/index.js';
import type { WorldTile } from '#/bot/adapter/ClientAdapter.js';
import type { QuestProgress, QuestSnapshot, QuestStep } from '#/bot/quests/engine/types.js';

const SEERS: WorldTile = { x: 2725, z: 3491, level: 0 };
const WORKSHOP: WorldTile = { x: 2716, z: 9888, level: 0 };

function invIds(...entries: [number, number][]): Map<number, number> {
    return new Map(entries);
}

function invNames(...names: string[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const name of names) {
        const key = name.toLowerCase();
        map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
}

function progress(stage: number, flags: string[] = []): QuestProgress {
    return { stage, flags: new Set(flags) };
}

function snap(options: {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    flags?: string[];
    invIds?: [number, number][];
    inv?: string[];
    bankIds?: [number, number][];
    bankKnown?: boolean;
    tile?: WorldTile | null;
} = {}): QuestSnapshot {
    const stage = options.stage ?? EW_STAGE.NOT_STARTED;
    return {
        journal: options.journal ?? (stage === EW_STAGE.NOT_STARTED ? 'notStarted' : 'inProgress'),
        inv: invNames(...(options.inv ?? [])),
        invIds: invIds(...(options.invIds ?? [])),
        worn: new Set(),
        wornIds: new Set(),
        noProgress: 0,
        bankCoins: 2_000_000,
        stage,
        progress: progress(stage, options.flags ?? []),
        bank: new Map(),
        bankIds: invIds(...(options.bankIds ?? [])),
        bankKnown: options.bankKnown ?? true,
        tile: options.tile === undefined ? SEERS : options.tile,
        freeSlots: 20
    };
}

function customName(step: QuestStep): string | null {
    return step.kind === 'custom' ? step.name : null;
}

describe('Elemental Workshop journal parsing', () => {
    test('maps not-started journal text', () => {
        expect(parseElementalWorkshopJournal(
            '@dbl@I can start this quest by reading a|@dre@book@dbl@ found in @dre@Seers village@dbl@.'
        )?.stage).toBe(EW_STAGE.NOT_STARTED);
    });

    test('maps read-book journal text', () => {
        expect(parseElementalWorkshopJournal(
            '@str@I have found a battered book in a house in Seers Village.|@str@It tells of magic ore and a workshop created to fashion it.||@dbl@Where is this workshop and how do I get in?'
        )?.stage).toBe(EW_STAGE.READ_BOOK);
    });

    test('maps slashed-book journal text', () => {
        expect(parseElementalWorkshopJournal(
            '@str@I have found a battered book in a house in Seers Village.|@str@Cutting open the spine of the book with a blade,|@str@I found a key hidden under the leather binding.||@dbl@Where is this workshop and how do I get in?'
        )?.stage).toBe(EW_STAGE.SLASHED);
    });

    test('maps entered-workshop journal text', () => {
        expect(parseElementalWorkshopJournal(
            '@str@I have found a secret door in the Seers Village smithy.||@str@Where is this workshop and how do I get in?||@dbl@There is obviously lots to do here.'
        )?.stage).toBe(EW_STAGE.ENTERED);
    });

    test('maps quest complete journal text', () => {
        expect(parseElementalWorkshopJournal('@red@QUEST COMPLETE!')?.stage).toBe(EW_STAGE.COMPLETE);
    });

    test('parses machinery flags while inside the entered branch', () => {
        const text = [
            'I have found a secret door in the Seers Village smithy.',
            'I managed to get the waterwheel in the northern water area going by turning some valves and pulling a lever.',
            'The bellows in the eastern air area are now fixed, I just needed to stitch some leather over that hole.',
            'I lit the furnace with lava taken from the trough, using the stone bowl I found.',
            'I have made a bar from the elemental ore.',
            'Now I just need to make something from it.'
        ].join('|');
        const p = parseElementalWorkshopJournal(text);
        expect(p?.stage).toBe(EW_STAGE.ENTERED);
        expect(p?.flags.has(EW_FLAG.WATER)).toBe(true);
        expect(p?.flags.has(EW_FLAG.BELLOWS)).toBe(true);
        expect(p?.flags.has(EW_FLAG.FURNACE)).toBe(true);
        expect(p?.flags.has(EW_FLAG.MADE_BAR)).toBe(true);
    });

    test('does not invent a stage from unrecognized text', () => {
        expect(parseElementalWorkshopJournal(['Elemental Workshop', 'Loading…'])).toBeUndefined();
    });
});

describe('Elemental Workshop area classification', () => {
    test('classifies seers, workshop, and unknown tiles', () => {
        expect(ewArea(SEERS)).toBe('seers');
        expect(ewArea(WORKSHOP)).toBe('workshop');
        expect(ewArea({ x: 3200, z: 3200, level: 0 })).toBe('elsewhere');
        expect(ewArea(null)).toBe('unknown');
    });
});

describe('Elemental Workshop decide()', () => {
    test('module is registered with the AIO record', () => {
        expect(elementalworkshop.record.id).toBe('elemental_workshop');
        expect(elementalworkshop.ownsInventory).toBe(true);
    });

    test('complete and unknown short-circuit', () => {
        expect(decide(snap({ journal: 'complete', stage: EW_STAGE.COMPLETE })).kind).toBe('done');
        expect(decide(snap({ journal: 'unknown' })).kind).toBe('wait');
    });

    test('not started searches the bookcase when the book is missing', () => {
        expect(customName(decide(snap({ stage: EW_STAGE.NOT_STARTED })))).toBe(
            'search Seers bookcase for the Battered book'
        );
    });

    test('not started reads a held battered book', () => {
        expect(customName(decide(snap({
            stage: EW_STAGE.NOT_STARTED,
            invIds: [[EW_ITEM.BATTERED_BOOK.id, 1]]
        })))).toBe('read the Battered book');
    });

    test('after reading, sources a knife then slashes the book', () => {
        const needKnife = decide(snap({
            stage: EW_STAGE.READ_BOOK,
            invIds: [[EW_ITEM.BATTERED_BOOK.id, 1]]
        }));
        expect(needKnife.kind === 'grabGround' || needKnife.kind === 'withdraw' || needKnife.kind === 'wait').toBe(true);

        expect(customName(decide(snap({
            stage: EW_STAGE.READ_BOOK,
            invIds: [[EW_ITEM.BATTERED_BOOK.id, 1], [EW_ITEM.KNIFE.id, 1]]
        })))).toBe('slash the Battered book for the key');
    });

    test('with key, provisions tools from the bank before entering', () => {
        const step = decide(snap({
            stage: EW_STAGE.SLASHED,
            invIds: [[EW_ITEM.BATTERED_KEY.id, 1], [EW_ITEM.BATTERED_BOOK.id, 1]],
            bankIds: [
                [EW_ITEM.HAMMER.id, 1],
                [EW_ITEM.THREAD.id, 1],
                [EW_ITEM.COAL.id, COAL_NEED],
                [1265, 1]
            ]
        }));
        // Hammer/thread/coal/pickaxe withdrawals come before enter.
        expect(step.kind === 'withdraw' || customName(step) === 'enter the Elemental Workshop').toBe(true);
    });

    test('inside workshop without water flag starts the water wheel', () => {
        expect(customName(decide(snap({
            stage: EW_STAGE.ENTERED,
            flags: [],
            tile: WORKSHOP,
            invIds: [[EW_ITEM.BATTERED_KEY.id, 1], [EW_ITEM.BATTERED_BOOK.id, 1], [EW_ITEM.HAMMER.id, 1], [EW_ITEM.COAL.id, 4], [1265, 1]]
        })))).toBe('start the water wheel');
    });

    test('after water, searches crates when leather/needle are missing for bellows', () => {
        expect(customName(decide(snap({
            stage: EW_STAGE.ENTERED,
            flags: [EW_FLAG.WATER],
            tile: WORKSHOP,
            invIds: [[EW_ITEM.THREAD.id, 1]]
        })))).toBe('search crates for leather/needle');
    });

    test('fixes bellows when leather, needle, and thread are held', () => {
        expect(customName(decide(snap({
            stage: EW_STAGE.ENTERED,
            flags: [EW_FLAG.WATER],
            tile: WORKSHOP,
            invIds: [
                [EW_ITEM.LEATHER.id, 1],
                [EW_ITEM.NEEDLE.id, 1],
                [EW_ITEM.THREAD.id, 1]
            ]
        })))).toBe('fix the bellows');
    });

    test('lights the furnace after bellows when a bowl is held', () => {
        expect(customName(decide(snap({
            stage: EW_STAGE.ENTERED,
            flags: [EW_FLAG.WATER, EW_FLAG.BELLOWS],
            tile: WORKSHOP,
            invIds: [[EW_ITEM.STONE_BOWL.id, 1]]
        })))).toBe('light the furnace with lava');
    });

    test('mines ore once the furnace is lit', () => {
        expect(customName(decide(snap({
            stage: EW_STAGE.ENTERED,
            flags: [EW_FLAG.WATER, EW_FLAG.BELLOWS, EW_FLAG.FURNACE],
            tile: WORKSHOP,
            invIds: [[1265, 1], [EW_ITEM.COAL.id, 4]]
        })))).toBe('mine Elemental ore from the Earth elemental');
    });

    test('smelts once ore and coal are held', () => {
        expect(customName(decide(snap({
            stage: EW_STAGE.ENTERED,
            flags: [EW_FLAG.WATER, EW_FLAG.BELLOWS, EW_FLAG.FURNACE],
            tile: WORKSHOP,
            invIds: [[EW_ITEM.ELEMENTAL_ORE.id, 1], [EW_ITEM.COAL.id, 4]]
        })))).toBe('smelt Elemental metal at the furnace');
    });

    test('smiths the shield when elemental metal is held with book and hammer', () => {
        expect(customName(decide(snap({
            stage: EW_STAGE.ENTERED,
            flags: [EW_FLAG.WATER, EW_FLAG.BELLOWS, EW_FLAG.FURNACE],
            tile: WORKSHOP,
            invIds: [
                [EW_ITEM.ELEMENTAL_METAL.id, 1],
                [EW_ITEM.BATTERED_BOOK.id, 1],
                [EW_ITEM.HAMMER.id, 1]
            ]
        })))).toBe('smith the Elemental shield');
    });

    test('empty and full stone bowls share a display name, so ids must differ', () => {
        expect(EW_ITEM.STONE_BOWL.name).toBe(EW_ITEM.STONE_BOWL_FULL.name);
        expect(EW_ITEM.STONE_BOWL.id).not.toBe(EW_ITEM.STONE_BOWL_FULL.id);
    });
});
