import { describe, expect, test } from 'bun:test';
import {
    COAL_NEED,
    EW_FLAG,
    EW_ITEM,
    EW_STAGE,
    decide,
    elementalworkshop,
    ewArea,
    hasHeldSlashTool,
    hasSlashTool,
    hasWeapon,
    parseElementalWorkshopJournal,
    surfaceLoadout
} from '#/bot/quests/defs/elementalworkshop/index.js';
import type { WorldTile } from '#/bot/adapter/ClientAdapter.js';
import type { QuestProgress, QuestSnapshot, QuestStep } from '#/bot/quests/engine/types.js';

const SEERS: WorldTile = { x: 2725, z: 3491, level: 0 };
const WORKSHOP: WorldTile = { x: 2716, z: 9888, level: 0 };
const BRONZE_PICK = 1265;
const STEEL_SCIM = 1325;

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
    bank?: [string, number][];
    bankKnown?: boolean;
    tile?: WorldTile | null;
    freeSlots?: number;
    worn?: string[];
    wornIds?: number[];
} = {}): QuestSnapshot {
    const stage = options.stage ?? EW_STAGE.NOT_STARTED;
    return {
        journal: options.journal ?? (stage === EW_STAGE.NOT_STARTED ? 'notStarted' : 'inProgress'),
        inv: invNames(...(options.inv ?? [])),
        invIds: invIds(...(options.invIds ?? [])),
        worn: new Set((options.worn ?? []).map(n => n.toLowerCase())),
        wornIds: new Set(options.wornIds ?? []),
        noProgress: 0,
        bankCoins: 2_000_000,
        stage,
        progress: progress(stage, options.flags ?? []),
        bank: new Map((options.bank ?? []).map(([n, q]) => [n.toLowerCase(), q])),
        bankIds: invIds(...(options.bankIds ?? [])),
        bankKnown: options.bankKnown ?? true,
        tile: options.tile === undefined ? SEERS : options.tile,
        freeSlots: options.freeSlots ?? 20
    };
}

/** Full bank kit for a realistic low-level EW account (tools not held). */
function realisticBank(): { bankIds: [number, number][]; bank: [string, number][] } {
    return {
        bankIds: [
            [EW_ITEM.KNIFE.id, 1],
            [EW_ITEM.HAMMER.id, 1],
            [BRONZE_PICK, 1],
            [EW_ITEM.THREAD.id, 2],
            [EW_ITEM.LEATHER.id, 1],
            [EW_ITEM.NEEDLE.id, 1],
            [EW_ITEM.COAL.id, 8],
            [STEEL_SCIM, 1],
            [EW_ITEM.COINS.id, 50_000]
        ],
        bank: [
            ['knife', 1],
            ['hammer', 1],
            ['bronze pickaxe', 1],
            ['thread', 2],
            ['leather', 1],
            ['needle', 1],
            ['coal', 8],
            ['lobster', 20],
            ['steel scimitar', 1],
            ['coins', 50_000]
        ]
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
        const kit = realisticBank();
        const step = decide(snap({
            stage: EW_STAGE.SLASHED,
            invIds: [[EW_ITEM.BATTERED_KEY.id, 1], [EW_ITEM.BATTERED_BOOK.id, 1]],
            bankIds: kit.bankIds,
            bank: kit.bank
        }));
        // Hammer/thread/coal/pickaxe/food/weapon withdrawals come before enter.
        expect(step.kind).toBe('withdraw');
    });

    test('empty pack + bank kit scans bank when bank is unknown', () => {
        const step = decide(snap({
            stage: EW_STAGE.SLASHED,
            invIds: [[EW_ITEM.BATTERED_KEY.id, 1], [EW_ITEM.BATTERED_BOOK.id, 1]],
            bankKnown: false
        }));
        expect(step.kind).toBe('scanBank');
    });

    test('waits when bank is known empty of a pickaxe', () => {
        const step = decide(snap({
            stage: EW_STAGE.SLASHED,
            invIds: [
                [EW_ITEM.BATTERED_KEY.id, 1],
                [EW_ITEM.BATTERED_BOOK.id, 1],
                [EW_ITEM.KNIFE.id, 1],
                [EW_ITEM.HAMMER.id, 1],
                [EW_ITEM.THREAD.id, 1],
                [EW_ITEM.COAL.id, COAL_NEED],
                [STEEL_SCIM, 1]
            ],
            bankKnown: true,
            bankIds: [],
            bank: []
        }));
        expect(step.kind).toBe('wait');
        expect(step.kind === 'wait' && step.reason).toMatch(/pickaxe/i);
    });

    test('after death (ENTERED, no key on surface) still re-enters via Push when loadout is ready', () => {
        // Journal already entered: odd wall Push works without the Battered key.
        const step = decide(snap({
            stage: EW_STAGE.ENTERED,
            flags: [],
            invIds: [
                [EW_ITEM.BATTERED_BOOK.id, 1],
                [EW_ITEM.KNIFE.id, 1],
                [EW_ITEM.HAMMER.id, 1],
                [EW_ITEM.THREAD.id, 1],
                [EW_ITEM.LEATHER.id, 1],
                [EW_ITEM.NEEDLE.id, 1],
                [EW_ITEM.COAL.id, COAL_NEED],
                [BRONZE_PICK, 1],
                [STEEL_SCIM, 1]
            ],
            inv: ['lobster', 'lobster', 'lobster'],
            bankKnown: true,
            bankIds: [],
            bank: []
        }));
        expect(customName(step)).toBe('enter the Elemental Workshop');
    });

    test('before ENTERED, missing key re-slashes the book when a knife is held', () => {
        // Journal can already be SLASHED while the key was lost before first entry —
        // re-cut the spine rather than hard-wait (Push only works after ENTERED).
        const step = decide(snap({
            stage: EW_STAGE.SLASHED,
            invIds: [[EW_ITEM.BATTERED_BOOK.id, 1], [EW_ITEM.KNIFE.id, 1]],
            bankKnown: true,
            bankIds: [],
            bank: []
        }));
        expect(customName(step)).toBe('slash the Battered book for the key');
    });

    test('after reading, withdraws steel scimitar from bank when knife is missing', () => {
        const step = decide(snap({
            stage: EW_STAGE.READ_BOOK,
            invIds: [[EW_ITEM.BATTERED_BOOK.id, 1]],
            bankIds: [[STEEL_SCIM, 1]],
            bank: [['steel scimitar', 1]]
        }));
        expect(step.kind).toBe('withdraw');
        if (step.kind === 'withdraw') {
            expect(step.items.some(i => i.id === STEEL_SCIM || /scimitar/i.test(i.name))).toBe(true);
        }
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

describe('Elemental Workshop supplies helpers', () => {
    test('knife counts as slash tool but not as combat weapon', () => {
        const s = snap({ invIds: [[EW_ITEM.KNIFE.id, 1]], inv: ['Knife'] });
        expect(hasHeldSlashTool(s)).toBe(true);
        expect(hasSlashTool(s)).toBe(true);
        expect(hasWeapon(s)).toBe(false);
    });

    test('worn scimitar counts as slash/weapon but not held slash for book useOn', () => {
        const s = snap({ worn: ['Steel scimitar'], wornIds: [STEEL_SCIM] });
        expect(hasHeldSlashTool(s)).toBe(false);
        expect(hasSlashTool(s)).toBe(true);
        expect(hasWeapon(s)).toBe(true);
    });

    test('surfaceLoadout withdraws a full entry kit from a realistic bank seed', () => {
        const kit = realisticBank();
        const step = surfaceLoadout(snap({
            stage: EW_STAGE.SLASHED,
            invIds: [[EW_ITEM.BATTERED_KEY.id, 1], [EW_ITEM.BATTERED_BOOK.id, 1]],
            bankIds: kit.bankIds,
            bank: kit.bank,
            freeSlots: 28
        }), true, true);
        expect(step?.kind).toBe('withdraw');
        if (step?.kind === 'withdraw') {
            const names = step.items.map(i => i.name.toLowerCase());
            expect(names.some(n => n.includes('hammer'))).toBe(true);
            expect(names.some(n => n.includes('pickaxe'))).toBe(true);
            expect(names.some(n => n.includes('coal'))).toBe(true);
            expect(names.some(n => n.includes('lobster'))).toBe(true);
            expect(names.some(n => n.includes('scimitar') || n === 'knife')).toBe(true);
        }
    });

    test('surfaceLoadout deposits junk when free slots cannot fit the kit', () => {
        const kit = realisticBank();
        const step = surfaceLoadout(snap({
            stage: EW_STAGE.SLASHED,
            invIds: [[EW_ITEM.BATTERED_KEY.id, 1]],
            inv: ['Bones', 'Bones', 'Bones'],
            bankIds: kit.bankIds,
            bank: kit.bank,
            freeSlots: 2
        }), true, true);
        expect(step?.kind).toBe('deposit');
    });
});
