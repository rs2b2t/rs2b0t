import { describe, expect, test } from 'bun:test';
import {
    WATERFALL_STAGE,
    decide,
    parseWaterfallJournal,
    readWaterfallStage,
    waterfall,
    waterfallDungeonEntryReadiness,
    waterfallArea
} from '#/bot/quests/defs/waterfall.js';
import type { QuestSnapshot, QuestStep } from '#/bot/quests/engine/types.js';

interface ItemSpec {
    id: number;
    name: string;
    stackable?: boolean;
}

const ITEM = {
    BOOK: { id: 292, name: 'Book on baxtorian' },
    GOLRIE_KEY: { id: 293, name: 'A key' },
    PEBBLE: { id: 294, name: "Glarial's pebble" },
    AMULET: { id: 295, name: "Glarial's amulet" },
    FULL_URN: { id: 296, name: "Glarial's urn" },
    EMPTY_URN: { id: 297, name: "Glarial's urn" },
    BAXTORIAN_KEY: { id: 298, name: 'A key' },
    WATER_RUNE: { id: 555, name: 'Water rune', stackable: true },
    AIR_RUNE: { id: 556, name: 'Air rune', stackable: true },
    EARTH_RUNE: { id: 557, name: 'Earth rune', stackable: true },
    COINS: { id: 995, name: 'Coins', stackable: true },
    ROPE: { id: 954, name: 'Rope' },
    SWORD: { id: 1277, name: 'Bronze sword' },
    TEA: { id: 1978, name: 'Cup of tea' },
    EMPTY_CUP: { id: 1980, name: 'Empty cup' },
    BREAD: { id: 2309, name: 'Bread' }
} as const satisfies Record<string, ItemSpec>;

type ItemQty = readonly [ItemSpec, number];
type TileTuple = readonly [number, number, number?];

interface SnapshotOptions {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    inv?: readonly ItemQty[];
    worn?: readonly ItemSpec[];
    bank?: readonly ItemQty[];
    bankKnown?: boolean;
    tile?: TileTuple | null;
    freeSlots?: number;
}

function countByName(entries: readonly ItemQty[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const [item, qty] of entries) {
        const key = item.name.toLowerCase();
        counts.set(key, (counts.get(key) ?? 0) + qty);
    }
    return counts;
}

function countById(entries: readonly ItemQty[]): Map<number, number> {
    const counts = new Map<number, number>();
    for (const [item, qty] of entries) {
        counts.set(item.id, (counts.get(item.id) ?? 0) + qty);
    }
    return counts;
}

function usedSlots(entries: readonly ItemQty[]): number {
    return entries.reduce((sum, [item, qty]) => sum + (item.stackable ? Number(qty > 0) : qty), 0);
}

function snapshot(options: SnapshotOptions = {}): QuestSnapshot {
    const inv = options.inv ?? [];
    const bank = options.bank ?? [];
    const worn = options.worn ?? [];
    const tile = options.tile === null
        ? null
        : {
            x: options.tile?.[0] ?? 2616,
            z: options.tile?.[1] ?? 3332,
            level: options.tile?.[2] ?? 0
        };
    return {
        journal: options.journal ?? 'inProgress',
        inv: countByName(inv),
        invIds: countById(inv),
        worn: new Set(worn.map(item => item.name.toLowerCase())),
        wornIds: new Set(worn.map(item => item.id)),
        noProgress: 0,
        bankCoins: countById(bank).get(ITEM.COINS.id) ?? 0,
        stage: options.stage,
        bank: countByName(bank),
        bankIds: countById(bank),
        bankKnown: options.bankKnown ?? true,
        tile,
        freeSlots: options.freeSlots ?? Math.max(0, 28 - usedSlots(inv))
    };
}

const START_PACK: readonly ItemQty[] = [
    [ITEM.ROPE, 1],
    [ITEM.BREAD, 15],
    [ITEM.COINS, 500]
];

const DUNGEON_PACK: readonly ItemQty[] = [
    [ITEM.ROPE, 1],
    [ITEM.BREAD, 15],
    [ITEM.AMULET, 1],
    [ITEM.FULL_URN, 1],
    [ITEM.AIR_RUNE, 6],
    [ITEM.EARTH_RUNE, 6],
    [ITEM.WATER_RUNE, 6],
    [ITEM.COINS, 500]
];

const FINAL_PACK: readonly ItemQty[] = [
    [ITEM.ROPE, 1],
    [ITEM.BREAD, 15],
    [ITEM.AMULET, 1],
    [ITEM.FULL_URN, 1],
    [ITEM.COINS, 500]
];

function customName(step: QuestStep): string | undefined {
    return step.kind === 'custom' ? step.name : undefined;
}

function withdrawal(step: QuestStep): Extract<QuestStep, { kind: 'withdraw' }> {
    expect(step.kind).toBe('withdraw');
    if (step.kind !== 'withdraw') throw new Error('expected withdraw step');
    return step;
}

describe('Waterfall journal stage parser', () => {
    const cases: readonly [number, readonly string[]][] = [
        [WATERFALL_STAGE.NOT_STARTED, ['@red@I can start this quest by speaking to Almera.']],
        [WATERFALL_STAGE.STARTED, ['I spoke to Almera in a house close to the Baxtorian waterfall.']],
        [WATERFALL_STAGE.SPOKEN_TO_HUDON, ['I found Hudon a short raft ride down the river.']],
        [WATERFALL_STAGE.READ_BOOK, ["The book also mentions Glarial's tomb. I should investigate it."]],
        [WATERFALL_STAGE.ENTERED_TOMB, ['I managed to enter the Tomb of Glarial.']],
        [WATERFALL_STAGE.ENTERED_WATERFALL, ['I used it to enter Baxtorian Falls.']],
        [WATERFALL_STAGE.ENTERED_PUZZLE, [
            "I found a Chalice within Baxtorian Falls. However, it is floating out of reach. I'll need to work out how to get to it."
        ]],
        [WATERFALL_STAGE.RAISED_FLOOR, ['I worked out how to raise the floor.']],
        [WATERFALL_STAGE.COMPLETE, ['@gre@Quest complete!']]
    ];

    for (const [stage, lines] of cases) {
        test(`recognizes exact stage ${stage}`, () => {
            expect(parseWaterfallJournal(lines)).toBe(stage);
        });
    }

    test('matches the newest retained journal entry before older history', () => {
        expect(parseWaterfallJournal([
            'I can start this quest by speaking to Almera.',
            'I spoke to Almera in a house close to the Baxtorian waterfall.',
            'I found Hudon a short raft ride down the river.',
            "The book also mentions Glarial's tomb.",
            'I managed to enter the Tomb of Glarial.',
            'I used it to enter Baxtorian Falls.',
            "I'll need to work out how to get to it.",
            'Now I just need to retrieve the treasure.'
        ])).toBe(WATERFALL_STAGE.RAISED_FLOOR);
    });

    test('normalizes color tags, pipes, whitespace, and a single rendered string', () => {
        expect(parseWaterfallJournal('@yel@I used it | to enter   Baxtorian Falls.')).toBe(WATERFALL_STAGE.ENTERED_WATERFALL);
    });

    test('fails closed on loading or unrecognized text', () => {
        expect(parseWaterfallJournal([])).toBeUndefined();
        expect(parseWaterfallJournal(['Please wait...'])).toBeUndefined();
        expect(parseWaterfallJournal(['A future server journal phrase.'])).toBeUndefined();
    });
});

describe('Waterfall area classifier', () => {
    const cases = [
        ['unknown', null],
        ['mainland', [3222, 3218, 0]],
        ['hudonMound', [2512, 3481, 0]],
        ['fallsTreeBank', [2512, 3470, 0]],
        ['fallsLedge', [2512, 3463, 0]],
        ['tgvDungeon', [2533, 9556, 0]],
        ['glarialTomb', [2554, 9844, 0]],
        ['waterfallDungeon', [2575, 9861, 0]],
        ['puzzleRoom', [2565, 9912, 0]],
        ['raisedRoom', [2603, 9910, 0]]
    ] as const;

    for (const [area, tile] of cases) {
        test(`classifies ${area}`, () => {
            const worldTile = tile ? { x: tile[0], z: tile[1], level: tile[2] } : null;
            expect(waterfallArea(worldTile)).toBe(area);
        });
    }

    test('specific raised and puzzle rooms win over the encompassing dungeon bounds', () => {
        expect(waterfallArea({ x: 2598, z: 9905, level: 0 })).toBe('raisedRoom');
        expect(waterfallArea({ x: 2558, z: 9907, level: 0 })).toBe('puzzleRoom');
    });
});

describe('Waterfall dungeon survival gate', () => {
    test('waits for the full hostile-route energy budget before healing or toggling run', () => {
        expect(waterfallDungeonEntryReadiness(39, 1, 10, false)).toBe('waitForEnergy');
        expect(waterfallDungeonEntryReadiness(40, 1, 10, false)).toBe('heal');
    });

    test('enters only at full health with run enabled', () => {
        expect(waterfallDungeonEntryReadiness(40, 10, 10, false)).toBe('enableRun');
        expect(waterfallDungeonEntryReadiness(40, 10, 10, true)).toBe('ready');
    });
});

describe('journal and exact-stage gates', () => {
    test('coarse complete status is terminal without a stage', () => {
        expect(decide(snapshot({ journal: 'complete', bankKnown: false })).kind).toBe('done');
    });

    test('exact stage 10 is terminal while the coarse journal is still in progress', () => {
        expect(decide(snapshot({ stage: WATERFALL_STAGE.COMPLETE })).kind).toBe('done');
    });

    test('unknown journal waits instead of guessing from inventory', () => {
        const step = decide(snapshot({ journal: 'unknown', stage: WATERFALL_STAGE.ENTERED_PUZZLE, inv: DUNGEON_PACK }));
        expect(step).toEqual({ kind: 'wait', reason: 'quest journal not loaded' });
    });

    test('missing and unrecognized exact stages fail closed', () => {
        expect(decide(snapshot())).toEqual({ kind: 'wait', reason: 'Waterfall Quest journal stage unavailable' });
        expect(decide(snapshot({ stage: 7 }))).toEqual({ kind: 'wait', reason: 'unrecognized Waterfall Quest stage 7' });
    });

    test('dispatches every implemented exact stage independently of held-item phase guesses', () => {
        const cases: readonly [number, SnapshotOptions, QuestStep['kind'], string][] = [
            [WATERFALL_STAGE.NOT_STARTED, { inv: START_PACK }, 'talk', 'Almera'],
            [WATERFALL_STAGE.STARTED, { inv: START_PACK }, 'custom', 'board Almera raft and find Hudon'],
            [WATERFALL_STAGE.SPOKEN_TO_HUDON, { inv: START_PACK }, 'custom', 'find and read the Book on Baxtorian'],
            [WATERFALL_STAGE.READ_BOOK, { inv: [[ITEM.PEBBLE, 1], [ITEM.BREAD, 15]] }, 'custom', 'loot Glarial amulet and urn'],
            [WATERFALL_STAGE.ENTERED_TOMB, { inv: DUNGEON_PACK }, 'custom', 'enter Baxtorian Falls'],
            [WATERFALL_STAGE.ENTERED_WATERFALL, { inv: DUNGEON_PACK }, 'custom', 'cross into Baxtorian Falls'],
            [WATERFALL_STAGE.ENTERED_PUZZLE, { inv: DUNGEON_PACK }, 'custom', 'cross into Baxtorian Falls'],
            [WATERFALL_STAGE.RAISED_FLOOR, { inv: FINAL_PACK }, 'custom', 'return to the Waterfall dungeon']
        ];
        for (const [stage, options, kind, detail] of cases) {
            const step = decide(snapshot({ ...options, stage }));
            expect(step.kind).toBe(kind);
            if (kind === 'talk' && step.kind === 'talk') expect(step.stop.npc).toBe(detail);
            if (kind === 'custom') expect(customName(step)).toBe(detail);
        }
    });
});

describe('bank knowledge and one-way areas', () => {
    for (const stage of [
        WATERFALL_STAGE.NOT_STARTED,
        WATERFALL_STAGE.READ_BOOK,
        WATERFALL_STAGE.ENTERED_TOMB,
        WATERFALL_STAGE.ENTERED_WATERFALL,
        WATERFALL_STAGE.ENTERED_PUZZLE,
        WATERFALL_STAGE.RAISED_FLOOR
    ]) {
        test(`stage ${stage} scans the bank before mainland recovery`, () => {
            expect(decide(snapshot({ stage, bankKnown: false })).kind).toBe('scanBank');
        });
    }

    test('puzzle dispatch never tries to bank from inside the dungeon', () => {
        const step = decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_PUZZLE,
            bankKnown: false,
            tile: [2565, 9912]
        }));
        expect(customName(step)).toBe('solve the six rune pillars');
    });

    test('raised-room completion never tries to bank from inside the dungeon', () => {
        const step = decide(snapshot({
            stage: WATERFALL_STAGE.RAISED_FLOOR,
            bankKnown: false,
            inv: [[ITEM.FULL_URN, 1]],
            tile: [2603, 9910],
            freeSlots: 5
        }));
        expect(customName(step)).toBe("pour Glarial's ashes into the Chalice");
    });
});

describe('fresh-account travel bootstrap', () => {
    test('scans the safe Varrock East bank from a fresh Lumbridge start', () => {
        const step = decide(snapshot({
            stage: WATERFALL_STAGE.NOT_STARTED,
            bankKnown: false,
            tile: [3222, 3218]
        }));
        expect(step.kind).toBe('scanBank');
        if (step.kind === 'scanBank') {
            expect({ x: step.bank?.x, z: step.bank?.z }).toEqual({ x: 3253, z: 3420 });
        }
    });

    test('withdraws 600 gp and buys ten teas before the dangerous westbound supply trip', () => {
        const coins = withdrawal(decide(snapshot({
            stage: WATERFALL_STAGE.NOT_STARTED,
            bank: [[ITEM.COINS, 2_000_000]],
            tile: [3253, 3420]
        })));
        expect(coins.items).toEqual([{ name: 'Coins', id: 995, qty: 600 }]);
        expect({ x: coins.bank?.x, z: coins.bank?.z }).toEqual({ x: 3253, z: 3420 });

        const tea = decide(snapshot({
            stage: WATERFALL_STAGE.NOT_STARTED,
            inv: [[ITEM.COINS, 600]],
            bank: [[ITEM.COINS, 1_999_400]],
            tile: [3253, 3420]
        }));
        expect(tea.kind).toBe('buy');
        if (tea.kind === 'buy') {
            expect({ item: tea.item, qty: tea.qty, npc: tea.shop.npc, x: tea.shop.anchor.x, z: tea.shop.anchor.z }).toEqual({
                item: 'Cup of tea',
                qty: 10,
                npc: 'Tea seller',
                x: 3271,
                z: 3411
            });
        }

        const bread = decide(snapshot({
            stage: WATERFALL_STAGE.NOT_STARTED,
            inv: [[ITEM.COINS, 500], [ITEM.TEA, 10]],
            bank: [[ITEM.COINS, 1_999_400]],
            tile: [3271, 3411]
        }));
        expect(bread.kind).toBe('buy');
        if (bread.kind === 'buy') {
            expect({ item: bread.item, qty: bread.qty, npc: bread.shop.npc }).toEqual({
                item: 'Bread',
                qty: 15,
                npc: 'Baker'
            });
        }
    });

    test('banks spent cups but retains unconsumed tea during startup', () => {
        expect(customName(decide(snapshot({
            stage: WATERFALL_STAGE.NOT_STARTED,
            inv: [[ITEM.COINS, 500], [ITEM.TEA, 4], [ITEM.EMPTY_CUP, 6], [ITEM.BREAD, 15], [ITEM.ROPE, 1]],
            tile: [2654, 3311]
        })))).toBe('bank everything except Waterfall supplies');
    });

    test('sources eastern travel tea even when all Bread is already held or banked', () => {
        for (const options of [
            { inv: [[ITEM.COINS, 600], [ITEM.BREAD, 15]] as ItemQty[] },
            { inv: [[ITEM.COINS, 600]] as ItemQty[], bank: [[ITEM.BREAD, 15]] as ItemQty[] }
        ]) {
            const step = decide(snapshot({
                ...options,
                stage: WATERFALL_STAGE.NOT_STARTED,
                tile: [3222, 3218]
            }));
            expect(step.kind).toBe('buy');
            if (step.kind === 'buy') expect(step.item).toBe('Cup of tea');
        }
    });

    test('clears a full arbitrary restart pack before stage 1 food or stage 2 book acquisition', () => {
        expect(customName(decide(snapshot({
            stage: WATERFALL_STAGE.STARTED,
            inv: [[ITEM.SWORD, 28]],
            tile: [3222, 3218]
        })))).toBe('prepare the Almera raft trip');

        expect(customName(decide(snapshot({
            stage: WATERFALL_STAGE.SPOKEN_TO_HUDON,
            inv: [[ITEM.SWORD, 28]],
            tile: [3222, 3218]
        })))).toBe('prepare the Book on Baxtorian trip');
    });
});

describe('exact object-ID collisions', () => {
    test('withdraws Baxtorian key 298, not same-name Golrie key 293', () => {
        const bax = withdrawal(decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_WATERFALL,
            inv: DUNGEON_PACK,
            bank: [[ITEM.BAXTORIAN_KEY, 1]]
        })));
        expect(bax.items).toEqual([{ name: 'A key', id: 298, qty: 1 }]);

        const golrie = decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_WATERFALL,
            inv: DUNGEON_PACK,
            bank: [[ITEM.GOLRIE_KEY, 1]]
        }));
        expect(customName(golrie)).toBe('cross into Baxtorian Falls');
    });

    test('keeps Baxtorian key 298 but strips same-name Golrie key 293 from the dungeon loadout', () => {
        expect(customName(decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_WATERFALL,
            inv: [...DUNGEON_PACK, [ITEM.BAXTORIAN_KEY, 1]]
        })))).toBe('cross into Baxtorian Falls');

        expect(customName(decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_WATERFALL,
            inv: [...DUNGEON_PACK, [ITEM.GOLRIE_KEY, 1]]
        })))).toBe('prepare a safe Waterfall dungeon trip');
    });

    test('withdraws full urn 296 and does not accept same-name empty urn 297', () => {
        const withoutUrn = DUNGEON_PACK.filter(([item]) => item.id !== ITEM.FULL_URN.id);
        const full = withdrawal(decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_WATERFALL,
            inv: withoutUrn,
            bank: [[ITEM.FULL_URN, 1]]
        })));
        expect(full.items).toEqual([{ name: "Glarial's urn", id: 296, qty: 1 }]);

        const empty = decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_WATERFALL,
            inv: [[ITEM.PEBBLE, 1], [ITEM.BREAD, 15]],
            bank: [[ITEM.EMPTY_URN, 1]]
        }));
        expect(customName(empty)).toBe('loot Glarial amulet and urn');
    });

    test('an empty urn in inventory is prohibited tomb baggage, not a recovered full urn', () => {
        const step = decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_WATERFALL,
            inv: [[ITEM.PEBBLE, 1], [ITEM.AMULET, 1], [ITEM.EMPTY_URN, 1], [ITEM.BREAD, 15]]
        }));
        expect(customName(step)).toBe('strip prohibited items before Glarial tomb');
    });
});

describe('Glarial tomb stripping and recovery', () => {
    test('withdraws the exact pebble ID when it is banked', () => {
        const step = withdrawal(decide(snapshot({
            stage: WATERFALL_STAGE.READ_BOOK,
            inv: [[ITEM.BREAD, 15]],
            bank: [[ITEM.PEBBLE, 1]]
        })));
        expect(step.items).toEqual([{ name: "Glarial's pebble", id: 294, qty: 1 }]);
    });

    test('returns to Golrie when the pebble is absent from a known bank', () => {
        expect(customName(decide(snapshot({
            stage: WATERFALL_STAGE.READ_BOOK,
            inv: [[ITEM.BREAD, 15]]
        })))).toBe('recover Glarial pebble from Golrie');
    });

    test('strips forbidden inventory and all equipment before tomb entry', () => {
        const forbidden = decide(snapshot({
            stage: WATERFALL_STAGE.READ_BOOK,
            inv: [[ITEM.PEBBLE, 1], [ITEM.BREAD, 15], [ITEM.AIR_RUNE, 6]]
        }));
        expect(customName(forbidden)).toBe('strip prohibited items before Glarial tomb');

        const equipped = decide(snapshot({
            stage: WATERFALL_STAGE.READ_BOOK,
            inv: [[ITEM.PEBBLE, 1], [ITEM.BREAD, 15]],
            worn: [ITEM.SWORD]
        }));
        expect(customName(equipped)).toBe('strip prohibited items before Glarial tomb');
    });

    test('banks a full prohibited pack before trying to replenish tomb food', () => {
        expect(customName(decide(snapshot({
            stage: WATERFALL_STAGE.RAISED_FLOOR,
            inv: [[ITEM.PEBBLE, 1], [ITEM.BREAD, 1], [ITEM.SWORD, 26]],
            bank: [[ITEM.FULL_URN, 1], [ITEM.BAXTORIAN_KEY, 1]]
        })))).toBe('strip prohibited items before Glarial tomb');
    });

    test('retains only exact tomb-safe IDs and begins looting', () => {
        const step = decide(snapshot({
            stage: WATERFALL_STAGE.READ_BOOK,
            inv: [[ITEM.PEBBLE, 1], [ITEM.BREAD, 15], [ITEM.COINS, 500]]
        }));
        expect(customName(step)).toBe('loot Glarial amulet and urn');
    });

    test('finishes tomb recovery in place without trying to reach a bank', () => {
        for (const stage of [WATERFALL_STAGE.READ_BOOK, WATERFALL_STAGE.ENTERED_TOMB]) {
            expect(customName(decide(snapshot({
                stage,
                bankKnown: false,
                tile: [2554, 9844]
            })))).toBe('loot Glarial amulet and urn');
        }
    });

    test('withdraws both exact relics after a mainland death when they are banked', () => {
        const step = withdrawal(decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_TOMB,
            inv: [[ITEM.COINS, 500], [ITEM.BREAD, 15], [ITEM.ROPE, 1]],
            bank: [[ITEM.AMULET, 1], [ITEM.FULL_URN, 1]]
        })));
        expect(step.items).toEqual([
            { name: "Glarial's amulet", id: 295, qty: 1 },
            { name: "Glarial's urn", id: 296, qty: 1 }
        ]);
    });

    test('protects surviving relics during Golrie recovery, then carries them into the tomb', () => {
        const withdrawSurvivors = withdrawal(decide(snapshot({
            stage: WATERFALL_STAGE.RAISED_FLOOR,
            inv: [[ITEM.PEBBLE, 1], [ITEM.BREAD, 15]],
            bank: [[ITEM.FULL_URN, 1], [ITEM.BAXTORIAN_KEY, 1]]
        })));
        expect(withdrawSurvivors.items).toEqual([
            { name: "Glarial's urn", id: 296, qty: 1 },
            { name: 'A key', id: 298, qty: 1 }
        ]);

        expect(customName(decide(snapshot({
            stage: WATERFALL_STAGE.RAISED_FLOOR,
            inv: [[ITEM.PEBBLE, 1], [ITEM.BREAD, 15], [ITEM.FULL_URN, 1], [ITEM.BAXTORIAN_KEY, 1]]
        })))).toBe('loot Glarial amulet and urn');
    });
});

describe('stage 5/6 dungeon loadout and dispatch', () => {
    test('a complete mainland loadout enters the falls at stages 5 and 6', () => {
        expect(customName(decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_WATERFALL,
            inv: DUNGEON_PACK
        })))).toBe('cross into Baxtorian Falls');
        expect(customName(decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_PUZZLE,
            inv: DUNGEON_PACK
        })))).toBe('cross into Baxtorian Falls');
    });

    test('banks relics before any capacity-bound Bread refill, then restores them after Tea is stripped', () => {
        const relics = [ITEM.AMULET, ITEM.FULL_URN, ITEM.BAXTORIAN_KEY] as const;
        expect(customName(decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_WATERFALL,
            inv: [[ITEM.COINS, 500], [ITEM.TEA, 10], ...relics.map(item => [item, 1] as ItemQty)],
            tile: [3222, 3218]
        })))).toBe('prepare a safe Waterfall dungeon trip');

        expect(customName(decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_WATERFALL,
            inv: [
                [ITEM.COINS, 500],
                [ITEM.ROPE, 1],
                [ITEM.TEA, 10],
                ...relics.map(item => [item, 1] as ItemQty),
                [ITEM.AIR_RUNE, 6],
                [ITEM.EARTH_RUNE, 6],
                [ITEM.WATER_RUNE, 6]
            ],
            tile: [2616, 3332]
        })))).toBe('prepare a safe Waterfall dungeon trip');

        const bread = decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_WATERFALL,
            inv: [[ITEM.COINS, 500], [ITEM.TEA, 10]],
            bank: relics.map(item => [item, 1] as ItemQty),
            tile: [3222, 3218]
        }));
        expect(bread.kind).toBe('buy');
        if (bread.kind === 'buy') expect({ item: bread.item, qty: bread.qty }).toEqual({ item: 'Bread', qty: 15 });

        expect(customName(decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_WATERFALL,
            inv: [[ITEM.COINS, 500], [ITEM.TEA, 10], [ITEM.BREAD, 15], [ITEM.ROPE, 1]],
            bank: relics.map(item => [item, 1] as ItemQty),
            tile: [3222, 3218]
        })))).toBe('assemble the Waterfall dungeon loadout');

        const restored = withdrawal(decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_WATERFALL,
            inv: [[ITEM.COINS, 500], [ITEM.BREAD, 15], [ITEM.ROPE, 1]],
            bank: relics.map(item => [item, 1] as ItemQty),
            tile: [2616, 3332]
        })));
        expect(restored.items.map(item => item.id)).toEqual([295, 296, 298]);
    });

    test('withdraws missing rope, Bread, and partial runes by exact ID', () => {
        const withoutRope = DUNGEON_PACK.filter(([item]) => item.id !== ITEM.ROPE.id);
        expect(withdrawal(decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_WATERFALL,
            inv: withoutRope,
            bank: [[ITEM.ROPE, 1]]
        }))).items).toEqual([{ name: 'Rope', id: 954, qty: 1 }]);

        expect(withdrawal(decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_WATERFALL,
            inv: [[ITEM.COINS, 500], [ITEM.ROPE, 1], [ITEM.BREAD, 7]],
            bank: [[ITEM.BREAD, 10], [ITEM.AMULET, 1], [ITEM.FULL_URN, 1]],
            tile: [2616, 3332]
        }))).items).toEqual([{ name: 'Bread', id: 2309, qty: 8 }]);

        const shortAir = DUNGEON_PACK.map(([item, qty]) => [item, item.id === ITEM.AIR_RUNE.id ? 2 : qty] as ItemQty);
        expect(withdrawal(decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_PUZZLE,
            inv: shortAir,
            bank: [[ITEM.AIR_RUNE, 3]]
        }))).items).toEqual([{ name: 'Air rune', id: 556, qty: 3 }]);
    });

    test('buys only the residual rune shortage after an interrupted trip', () => {
        const shortAir = DUNGEON_PACK.map(([item, qty]) => [
            item,
            item.id === ITEM.AIR_RUNE.id ? 5 : item.id === ITEM.COINS.id ? 600 : qty
        ] as ItemQty);
        const step = decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_PUZZLE,
            inv: shortAir,
            tile: [3012, 3259]
        }));
        expect(step.kind).toBe('buy');
        if (step.kind === 'buy') {
            expect({ item: step.item, qty: step.qty, npc: step.shop.npc }).toEqual({
                item: 'Air rune',
                qty: 1,
                npc: 'Betty'
            });
        }
    });

    test('budgets all remaining Betty runes without returning to bank between stacks', () => {
        const partialPack = DUNGEON_PACK
            .filter(([item]) => item.id !== ITEM.EARTH_RUNE.id && item.id !== ITEM.WATER_RUNE.id)
            .map(([item, qty]) => [item, item.id === ITEM.COINS.id ? 900 : qty] as ItemQty);
        const step = decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_TOMB,
            inv: partialPack,
            tile: [3012, 3259]
        }));
        expect(step.kind).toBe('buy');
        if (step.kind === 'buy') {
            expect({ item: step.item, qty: step.qty, npc: step.shop.npc, estGp: step.estGp }).toEqual({
                item: 'Earth rune',
                qty: 6,
                npc: 'Betty',
                estGp: 144
            });
        }

        const afterEarth = partialPack.map(([item, qty]) => [
            item,
            item.id === ITEM.COINS.id ? 756 : qty
        ] as ItemQty);
        const finalStack = decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_TOMB,
            inv: [...afterEarth, [ITEM.EARTH_RUNE, 6]],
            tile: [3012, 3259]
        }));
        expect(finalStack.kind).toBe('buy');
        if (finalStack.kind === 'buy') expect(finalStack.item).toBe('Water rune');
    });

    test('withdraws every useful banked rune before starting Betty purchases', () => {
        const runeIds = new Set<number>([
            ITEM.AIR_RUNE.id,
            ITEM.EARTH_RUNE.id,
            ITEM.WATER_RUNE.id
        ]);
        const withoutRunes = DUNGEON_PACK.filter(([item]) => !runeIds.has(item.id));
        expect(withdrawal(decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_TOMB,
            inv: withoutRunes,
            bank: [[ITEM.EARTH_RUNE, 6], [ITEM.WATER_RUNE, 6]]
        }))).items).toEqual([
            { name: 'Earth rune', id: 557, qty: 6 },
            { name: 'Water rune', id: 555, qty: 6 }
        ]);

        expect(withdrawal(decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_TOMB,
            inv: [...withoutRunes, [ITEM.EARTH_RUNE, 6]],
            bank: [[ITEM.WATER_RUNE, 6]]
        }))).items).toEqual([{ name: 'Water rune', id: 555, qty: 6 }]);
    });

    test('budgets only the unbanked residual and preserves the cash float before departure', () => {
        const oneAirShort = DUNGEON_PACK.map(([item, qty]) => [
            item,
            item.id === ITEM.AIR_RUNE.id ? 5 : item.id === ITEM.COINS.id ? 100 : qty
        ] as ItemQty);
        const topUp = withdrawal(decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_TOMB,
            inv: oneAirShort,
            bank: [[ITEM.COINS, 2_000_000]]
        })));
        expect(topUp.items).toEqual([{ name: 'Coins', id: 995, qty: 484 }]);

        const partialAir = DUNGEON_PACK
            .filter(([item]) => item.id !== ITEM.AIR_RUNE.id)
            .map(([item, qty]) => [item, item.id === ITEM.COINS.id ? 500 : qty] as ItemQty);
        expect(withdrawal(decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_TOMB,
            inv: [...partialAir, [ITEM.AIR_RUNE, 2]],
            bank: [[ITEM.AIR_RUNE, 3], [ITEM.COINS, 2_000_000]]
        }))).items).toEqual([{ name: 'Air rune', id: 556, qty: 3 }]);
    });

    test('dispatches stage 5 through the dungeon and stage 6 to the pillars', () => {
        expect(customName(decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_WATERFALL,
            tile: [2575, 9861],
            bankKnown: false
        })))).toBe('cross the Waterfall dungeon');
        expect(customName(decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_PUZZLE,
            tile: [2565, 9912],
            bankKnown: false
        })))).toBe('solve the six rune pillars');
    });

    test('handles one-way crossing recovery without impossible banking', () => {
        expect(customName(decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_WATERFALL,
            tile: [2512, 3481],
            inv: [[ITEM.AMULET, 1]]
        })))).toBe('swim back from Hudon mound');

        expect(decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_WATERFALL,
            tile: [2512, 3470],
            inv: [[ITEM.AMULET, 1]]
        }))).toEqual({ kind: 'wait', reason: 'Rope missing on the one-way Waterfall crossing' });

        expect(customName(decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_WATERFALL,
            tile: [2512, 3463],
            inv: [[ITEM.ROPE, 1]]
        })))).toBe('leave the ledge without risking the amulet door');
    });
});

describe('stage 4 Waterfall crossing', () => {
    test('continues the intended raft, tree, and ledge transit instead of escaping it', () => {
        for (const tile of [[2512, 3481], [2512, 3470], [2512, 3463]] as const) {
            expect(customName(decide(snapshot({
                stage: WATERFALL_STAGE.ENTERED_TOMB,
                tile,
                inv: DUNGEON_PACK
            })))).toBe('enter Baxtorian Falls');
        }
    });

    test('does not strand a missing-Rope trip or open the ledge door without the amulet', () => {
        expect(customName(decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_TOMB,
            tile: [2512, 3481],
            inv: [[ITEM.AMULET, 1]]
        })))).toBe('swim back from Hudon mound');

        expect(decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_TOMB,
            tile: [2512, 3470],
            inv: [[ITEM.AMULET, 1]]
        }))).toEqual({ kind: 'wait', reason: 'Rope missing on the one-way Waterfall crossing' });

        expect(customName(decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_TOMB,
            tile: [2512, 3463],
            inv: [[ITEM.ROPE, 1]]
        })))).toBe('leave the ledge without risking the amulet door');
    });
});

describe('stage 8 final recovery and completion', () => {
    test('uses the full urn at exactly five free slots', () => {
        expect(customName(decide(snapshot({
            stage: WATERFALL_STAGE.RAISED_FLOOR,
            tile: [2603, 9910],
            inv: [[ITEM.FULL_URN, 1]],
            freeSlots: 5
        })))).toBe("pour Glarial's ashes into the Chalice");
    });

    test('washes out with four free slots or only the empty urn', () => {
        expect(customName(decide(snapshot({
            stage: WATERFALL_STAGE.RAISED_FLOOR,
            tile: [2603, 9910],
            inv: [[ITEM.FULL_URN, 1]],
            freeSlots: 4
        })))).toBe('wash out to recover the final loadout');
        expect(customName(decide(snapshot({
            stage: WATERFALL_STAGE.RAISED_FLOOR,
            tile: [2603, 9910],
            inv: [[ITEM.EMPTY_URN, 1]],
            freeSlots: 5
        })))).toBe('wash out to recover the final loadout');
    });

    test('uses the keyed direct route from either dungeon side', () => {
        for (const tile of [[2575, 9861], [2565, 9912]] as const) {
            expect(customName(decide(snapshot({
                stage: WATERFALL_STAGE.RAISED_FLOOR,
                tile,
                bankKnown: false
            })))).toBe('return directly to the raised Chalice room');
        }
    });

    test('final mainland loadout does not source puzzle runes again', () => {
        expect(customName(decide(snapshot({
            stage: WATERFALL_STAGE.RAISED_FLOOR,
            inv: FINAL_PACK
        })))).toBe('return to the Waterfall dungeon');
    });

    test('banks puzzle leftovers before the final trip', () => {
        expect(customName(decide(snapshot({
            stage: WATERFALL_STAGE.RAISED_FLOOR,
            inv: [...FINAL_PACK, [ITEM.AIR_RUNE, 1]]
        })))).toBe('prepare a safe final Waterfall trip');
    });

    test('rebuilds overfilled allowed-item packs instead of looping below five reward slots', () => {
        expect(customName(decide(snapshot({
            stage: WATERFALL_STAGE.RAISED_FLOOR,
            inv: FINAL_PACK.map(([item, qty]) => [item, item.id === ITEM.BREAD.id ? 20 : qty] as ItemQty)
        })))).toBe('prepare a safe final Waterfall trip');

        expect(customName(decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_WATERFALL,
            inv: [...DUNGEON_PACK, [ITEM.ROPE, 1]]
        })))).toBe('prepare a safe Waterfall dungeon trip');
    });

    test('withdraws exact banked final relics and key after a death', () => {
        const step = withdrawal(decide(snapshot({
            stage: WATERFALL_STAGE.RAISED_FLOOR,
            inv: [[ITEM.COINS, 500], [ITEM.BREAD, 15], [ITEM.ROPE, 1]],
            bank: [[ITEM.AMULET, 1], [ITEM.FULL_URN, 1], [ITEM.BAXTORIAN_KEY, 1]]
        })));
        expect(step.items).toEqual([
            { name: "Glarial's amulet", id: 295, qty: 1 },
            { name: "Glarial's urn", id: 296, qty: 1 },
            { name: 'A key', id: 298, qty: 1 }
        ]);
    });
});

describe('mainland death and restart states', () => {
    test('sources travel tea and Bread before sending an empty 10-HP recovery account to Golrie', () => {
        const coins = withdrawal(decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_PUZZLE,
            bank: [[ITEM.COINS, 2_000_000]],
            tile: [3222, 3218]
        })));
        expect(coins.items).toEqual([{ name: 'Coins', id: 995, qty: 600 }]);

        const tea = decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_PUZZLE,
            inv: [[ITEM.COINS, 600]],
            bank: [[ITEM.COINS, 1_999_400]],
            tile: [3253, 3420]
        }));
        expect(tea.kind).toBe('buy');
        if (tea.kind === 'buy') expect(tea.item).toBe('Cup of tea');

        const bread = decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_PUZZLE,
            inv: [[ITEM.COINS, 500], [ITEM.TEA, 10]],
            bank: [[ITEM.COINS, 1_999_400]],
            tile: [3271, 3411]
        }));
        expect(bread.kind).toBe('buy');
        if (bread.kind === 'buy') expect(bread.item).toBe('Bread');

        expect(customName(decide(snapshot({
            stage: WATERFALL_STAGE.ENTERED_PUZZLE,
            inv: [[ITEM.BREAD, 15]],
            tile: [2654, 3311]
        })))).toBe('recover Glarial pebble from Golrie');
    });

    for (const stage of [
        WATERFALL_STAGE.ENTERED_TOMB,
        WATERFALL_STAGE.ENTERED_WATERFALL,
        WATERFALL_STAGE.ENTERED_PUZZLE,
        WATERFALL_STAGE.RAISED_FLOOR
    ]) {
        test(`stage ${stage} scans an unknown post-death bank`, () => {
            expect(decide(snapshot({ stage, bankKnown: false })).kind).toBe('scanBank');
        });

        test(`stage ${stage} reacquires the pebble when all dropped relics are absent`, () => {
            expect(customName(decide(snapshot({ stage, inv: [[ITEM.BREAD, 15]] })))).toBe('recover Glarial pebble from Golrie');
        });

        test(`stage ${stage} resumes the Golrie leg after acquiring its key`, () => {
            expect(customName(decide(snapshot({
                stage,
                inv: [[ITEM.BREAD, 15], [ITEM.GOLRIE_KEY, 1]],
                bankKnown: false,
                tile: [2515, 9570]
            })))).toBe('recover Glarial pebble from Golrie');
        });

        test(`stage ${stage} withdraws exact relics from a known post-death bank`, () => {
            const step = withdrawal(decide(snapshot({
                stage,
                inv: [[ITEM.COINS, 500], [ITEM.BREAD, 15], [ITEM.ROPE, 1]],
                bank: [[ITEM.AMULET, 1], [ITEM.FULL_URN, 1]]
            })));
            expect(step.items).toEqual([
                { name: "Glarial's amulet", id: 295, qty: 1 },
                { name: "Glarial's urn", id: 296, qty: 1 }
            ]);
        });
    }
});

describe('Waterfall module wiring', () => {
    test('owns its exact loadout and stage oracle', () => {
        expect(waterfall.ownsInventory).toBe(true);
        expect(waterfall.readStage).toBe(readWaterfallStage);
        expect(waterfall.decide).toBe(decide);
        expect(waterfall.food).toBeUndefined();
    });

    test('declares Bread and bootstrap tea sustain through the full-health entry threshold', () => {
        expect(waterfall.sustain).toEqual({ foods: ['Bread', 'Cup of tea'], eatBelowHp: 1 });
    });
});
