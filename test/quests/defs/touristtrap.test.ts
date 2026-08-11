import { afterEach, describe, expect, test } from 'bun:test';
import {
    decide,
    forgeBarWastedSince,
    observeTouristTrap,
    parseTouristTrapJournal,
    runSurfaceRescueCheckpoint,
    strictTouristTrapChoice,
    TOURIST_TRAP_STAGE,
    touristTrapArea,
    waterskinDoses,
    type SurfaceRescueOperations
} from '#/bot/quests/defs/touristtrap.js';
import type { WorldTile } from '#/bot/adapter/ClientAdapter.js';
import type { QuestSnapshot, QuestStep } from '#/bot/quests/engine/types.js';
import { QuestFood } from '#/bot/quests/food.js';
import { EventSignal } from '#/bot/api/EventSignal.js';
import { GameMessages } from '#/bot/events/gameMessages.js';

const tile = (x: number, z: number, level = 0): WorldTile => ({ x, z, level });

const IRENA = tile(3303, 3113);
const CAPTAIN = tile(3270, 3029);
const CAMP_SURFACE = tile(3280, 3020);
const CAMP_UPPER = tile(3280, 3020, 1);
const MINE_ENTRANCE = tile(3279, 9420);
const MINE_LOWER = tile(3303, 9415);
const MINE_DEEP = tile(3302, 9466);
const BEDABIN = tile(3171, 3025);
const MAINLAND = tile(3200, 3200);
const SURFACE_JAIL = tile(3285, 3034);
const UNDERGROUND_JAIL = tile(3288, 9437);

const DESERT_OUTFIT = ['Desert shirt', 'Desert robe', 'Desert boots'] as const;
const SLAVE_OUTFIT = ["Slaves' shirt", 'Slave robe', 'Slave boots'] as const;
const DESERT_WORN = [...DESERT_OUTFIT, 'Bronze pickaxe'];
const SLAVE_WORN = [...SLAVE_OUTFIT, 'Bronze pickaxe'];

type CountEntry = readonly [name: string, count: number];

interface SnapshotOptions {
    journal?: QuestSnapshot['journal'];
    stage?: number | null;
    inv?: readonly CountEntry[];
    worn?: readonly string[];
    bank?: readonly CountEntry[];
    bankKnown?: boolean;
    tile?: WorldTile | null;
    freeSlots?: number;
    /** Charged waterskins. Default 4 so desert decide fixtures model survival; set 0 for thirst paths. */
    skins?: number;
    /** Combat food. Default 8 kebabs so captain-fight fixtures model survival; set 0 for restock paths. */
    kebabs?: number;
    /** Configured Trout. Default 16 so non-survival fixtures exercise their intended decision. */
    food?: number;
    /** Rescue float. Default 200 so non-funding fixtures exercise their intended decision. */
    coins?: number;
}

function countMap(entries: readonly CountEntry[] = []): Map<string, number> {
    return new Map(entries.map(([name, count]) => [name.toLowerCase(), count]));
}

function snap(options: SnapshotOptions = {}): QuestSnapshot {
    const inv = countMap(options.inv);
    const hasChargedSkin = ['waterskin(4)', 'waterskin(3)', 'waterskin(2)', 'waterskin(1)']
        .some(name => (inv.get(name) ?? 0) > 0);
    const skins = options.skins ?? 4;
    if (!hasChargedSkin && skins > 0) {
        inv.set('waterskin(4)', skins);
    }
    const kebabs = options.kebabs ?? 8;
    if ((inv.get('kebab') ?? 0) === 0 && kebabs > 0) {
        inv.set('kebab', kebabs);
    }
    const food = options.food ?? 16;
    if ((inv.get('trout') ?? 0) === 0 && food > 0) {
        inv.set('trout', food);
    }
    const coins = options.coins ?? 200;
    if ((inv.get('coins') ?? 0) === 0 && coins > 0) {
        inv.set('coins', coins);
    }
    return {
        journal: options.journal ?? 'inProgress',
        inv,
        worn: new Set((options.worn ?? []).map(name => name.toLowerCase())),
        noProgress: 0,
        bankCoins: 0,
        stage: options.stage === null ? undefined : (options.stage ?? TOURIST_TRAP_STAGE.NOT_STARTED),
        bank: countMap(options.bank),
        bankKnown: options.bankKnown ?? true,
        tile: options.tile === undefined ? IRENA : options.tile,
        freeSlots: options.freeSlots ?? 8
    };
}

afterEach(() => {
    QuestFood.name = 'Trout';
    EventSignal.setInterrupt(null);
    GameMessages.reset();
});

function customName(step: QuestStep): string | null {
    return step.kind === 'custom' ? step.name : null;
}

describe('Tourist Trap journal stage parsing', () => {
    const fixtures = [
        ['@dbl@I can start this quest by speaking to @dre@Irena@dbl@ after I have|gone through the @dre@Shantay Pass, South of Al-Kharid.|', TOURIST_TRAP_STAGE.NOT_STARTED],
        ['@str@Irena was distraught that her daughter Ana had vanished|@str@somewhere in the desert, and I agreed to help find her.|@dbl@I need to head into @dre@the desert@dbl@ and search for @dre@Ana', TOURIST_TRAP_STAGE.STARTED],
        ["@str@I found some suspicious guards in the desert, who I think|@str@may know something about Ana's disappearance.|@dbl@I have a feeling @dre@Ana@dbl@ must be around here somewhere...", TOURIST_TRAP_STAGE.APPROACHED_CAPTAIN],
        ["@str@I've killed the Mercenary Captain, I found a metal key on his|@str@body.|@dbl@I believe that @dre@Ana@dbl@ may be inside a desert @dre@mining camp@dbl@. I|should try to find a way inside.", TOURIST_TRAP_STAGE.KILLED_CAPTAIN],
        [
            '@str@The key I took from the mercenary captain allowed me to|@str@gain access to the desert mining camp.|@dbl@I should look around this desert @dre@mining camp@dbl@ and see if I|can find @dre@Ana@dbl@. She could be anywhere.',
            TOURIST_TRAP_STAGE.ENTERED_CAMP
        ],
        [
            "@str@I've found a slave who says he's going to escape. I've made|@str@a deal with the salve. If I can crack the locks on his|@str@chains, he'll trade me his slaves clothes for the desert|@str@robes. Hopefully, whenn I'm dressed in slaves clothes I'll|@str@be able to get deeper in to the mining cave system.|@dbl@I should try to undo the @dre@locks@dbl@ on the @dre@slave@dbl@ in @dre@east@dbl@ end of|the desert @dre@mining camp@dbl@.",
            TOURIST_TRAP_STAGE.SPOKEN_SLAVE
        ],
        [
            '@str@I managed to pick the locks on the slaves chains. He|@str@seemed quite pleased.|@dbl@I need to trade my @dre@desert robes@dbl@ for the @dre@used slaves|clothes@dbl@. These will help me to move around clandestinely in|the underground mine area.',
            TOURIST_TRAP_STAGE.FREED_SLAVE
        ],
        ["@str@I've managed to swap the desert robes for slave robes.|@dbl@I think I should head into the @dre@mine@dbl@ and look for @dre@Ana.", TOURIST_TRAP_STAGE.TRADED_CLOTHES],
        ["@str@I've managed to into the underground mine area and the|@str@guards haven't stopped me yet.|@dbl@I think I should head deeper into the @dre@mine@dbl@ and look for @dre@Ana.", TOURIST_TRAP_STAGE.ENTERED_MINE],
        ["@str@I tried to enter the mines but my way was blocked by a|@str@guard. I was sure I had to get deeper into the mines.|@dbl@I need to get the mine guard a @dre@'Tenti' pineapple@dbl@ somehow.", TOURIST_TRAP_STAGE.FINDING_PINEAPPLE],
        [
            "@dbl@I need to get the mine guard a @dre@'Tenti' pineapple@dbl@ somehow.|Al Shabim@dbl@ will give me a @dre@'Tenti' pineapple@dbl@ if I can steal the|@dre@plans@dbl@ for a @dre@new secret weapon@dbl@ for him",
            TOURIST_TRAP_STAGE.BEDABIN_KEY
        ],
        [
            "|@str@I managed to distract captain Siad and have stolen the|@str@plans.|@dbl@I need to get the mine guard a @dre@'Tenti' pineapple@dbl@ somehow.|@dre@Al Shabim@dbl@ will give me a @dre@'Tenti' pineapple@dbl@ if I can steal the|@dre@plans@dbl@ for a @dre@new secret weapon@dbl@ for him",
            TOURIST_TRAP_STAGE.RETRIEVED_PLANS
        ],
        [
            "@dbl@I need to get the mine guard a @dre@'Tenti' pineapple@dbl@ somehow.|@dre@Al Shabim@dbl@ will give me a @dre@'Tenti' pineapple@dbl@ if I make him a|@dre@prototype@dbl@ of the @dre@new secret throwing weapon.|@dbl@To make the weapon, I will need the following:-|@dre@Hammer|@dre@Feathers|@dre@Bronze bar|",
            TOURIST_TRAP_STAGE.SHOWN_PLANS
        ],
        ["@dbl@I've made the prototype dart tip, I should now add|feathers to it.", TOURIST_TRAP_STAGE.MADE_DART_TIP],
        ["@dbl@I've made a @dre@prototype dart @dbl@, I should now take it to|@dre@Al Shabim@dbl@.", TOURIST_TRAP_STAGE.FINISHED_DART],
        ["@dbl@I need to get the mine guard a @dre@'Tenti' pineapple@dbl@ somehow.||@dbl@Now I have a @dre@pineapple@dbl@, I should take it to the @dre@guard@dbl@.", TOURIST_TRAP_STAGE.LEARNED_DARTS],
        ['@dre@Al Shabim@dbl@ gave me a @dre@Tenti pineapple@dbl@, but I seem to have|@dre@misplaced it@dbl@, perhaps I should get @dre@another one@dbl@?', TOURIST_TRAP_STAGE.LEARNED_DARTS],
        [
            '@str@After helping the Bedabin people get a new weapon, they|@str@gave me a pineapple which I used to bribe the mine guard|@str@into allowing me further access into the mines.|@dbl@I am sure @dre@Ana@dbl@ is down here somewhere...|I should find her.',
            TOURIST_TRAP_STAGE.GIVEN_PINEAPPLE
        ],
        ['@dbl@I have to find some way of getting @dre@Ana@dbl@ out of here...', TOURIST_TRAP_STAGE.USED_MINE_CART],
        ['@str@I found Ana working as a slave in the mine. Luckily I had a|@str@cunning plan to get her out, and stuck her in a barrel.|@dbl@I need to get @dre@Ana@dbl@ (and her barrel) out of this mine camp!', TOURIST_TRAP_STAGE.RESCUE],
        [
            '@str@I managed to smuggle her out from under the noses of the|@str@mine guards, secure her in a barrel, and take a cart ride to|@str@freedom outside the mining camp.|@dbl@I should talk to @dre@Irena@dbl@ at the @dre@shantay pass@dbl@ for my @dre@reward.',
            TOURIST_TRAP_STAGE.REWARD
        ],
        ['@str@I returned Ana to her mother Irena, who was so grateful|@str@for all of my help that she rewarded me with some training.||@dre@QUEST COMPLETE!', TOURIST_TRAP_STAGE.COMPLETE]
    ] as const;

    for (const [index, [text, expected]] of fixtures.entries()) {
        test(`maps exact source journal fixture ${index + 1} to stage ${expected}`, () => {
            expect(parseTouristTrapJournal(text)).toBe(expected);
        });
    }

    test('uses the newest milestone in a cumulative rendered journal', () => {
        const cumulative = [
            '@dbl@I need to head into @dre@the desert@dbl@ and search for @dre@Ana',
            "@str@I've killed the Mercenary Captain, I found a metal key on his|@str@body.",
            "@str@I've managed to swap the desert robes for slave robes.",
            "@dbl@I've made a @dre@prototype dart @dbl@, I should now take it to|@dre@Al Shabim@dbl@."
        ];
        expect(parseTouristTrapJournal(cumulative)).toBe(TOURIST_TRAP_STAGE.FINISHED_DART);
    });

    test('does not silently infer a stage from unknown or partially loaded text', () => {
        expect(parseTouristTrapJournal(['Tourist Trap', 'Loading…'])).toBeUndefined();
        expect(parseTouristTrapJournal('I spoke to Captain Siad about some plans.')).toBeUndefined();
    });
});

describe('Tourist Trap area classification', () => {
    const fixtures = [
        [tile(3284, 3032), 'surfaceJail'],
        [tile(3286, 3036), 'surfaceJail'],
        [tile(3283, 3032), 'surfaceJail'],
        [tile(3282, 3037), 'surfaceJail'],
        [tile(3279, 3038), 'surfaceJail'],
        [tile(3277, 3039), 'surfaceJail'],
        [tile(3275, 3040), 'surfaceJail'],
        [tile(3280, 3018), 'campSurface'], // source-map walkable approach beside the two-tile winch
        [tile(3287, 3036), 'campSurface'],
        [tile(3284, 3031), 'campSurface'],
        [tile(3284, 3037), 'campSurface'],
        [tile(3285, 9430), 'undergroundJail'],
        [tile(3295, 9443), 'mineDeep'],
        [tile(3288, 9431), 'undergroundJail'],
        [tile(3288, 9442), 'undergroundJail'],
        [tile(3282, 9437), 'mineEntrance'],
        [tile(3296, 9437), 'mineDeep'],
        [tile(3288, 9429), 'undergroundJail'],
        [tile(3288, 9444), 'undergroundJail'],
        [tile(3269, 9447), 'mineEntrance'], // live recovery tile in the entrance-side collision component
        [tile(3274, 3011), 'campSurface'],
        [tile(3306, 3043), 'campSurface'],
        [tile(3274, 3011, 1), 'campUpper'],
        [tile(3306, 3043, 1), 'campUpper'],
        [tile(3303, 9415), 'mineLower'],
        [tile(3279, 9420), 'mineEntrance'],
        [tile(3292, 9423), 'mineLower'],
        [tile(3313, 9416), 'mineLower'],
        [tile(3303, 9427), 'mineLower'],
        [tile(3307, 9447), 'mineDeep'],
        [tile(3308, 9447), 'mineDeep'],
        [tile(3307, 9448), 'mineDeep'],
        [tile(3315, 9427), 'mineDeep'],
        [tile(3293, 9434), 'mineDeep'],
        [tile(3299, 9447), 'mineDeep'],
        [tile(3318, 9430), 'mineDeep'],
        [tile(3302, 9466), 'mineDeep'],
        [tile(3287, 9429), 'undergroundJail'],
        [tile(3288, 9446), 'undergroundJail'],
        [tile(3292, 9435), 'undergroundJail'],
        [tile(3286, 9444), 'undergroundJail'],
        [tile(3171, 3048), 'bedabinTent'],
        // Outside the tent door — the walkable approach for forge (3169,3046 is interior/sealed).
        [tile(3169, 3045), 'bedabin'],
        [tile(3169, 3046), 'bedabinTent'],
        [tile(3150, 2990), 'bedabin'],
        [tile(3200, 3070), 'bedabin'],
        [tile(3300, 3109), 'irena'],
        [tile(3314, 3116), 'irena'],
        [tile(3288, 3117), 'shantayNorth'],
        [tile(3320, 3140), 'shantayNorth'],
        [tile(3250, 3050), 'desert'],
        [tile(3200, 3200), 'mainland'],
        [tile(3200, 3200, 1), 'unknown']
    ] as const;

    for (const [worldTile, expected] of fixtures) {
        test(`classifies (${worldTile.x}, ${worldTile.z}, level ${worldTile.level}) as ${expected}`, () => {
            expect(touristTrapArea(worldTile)).toBe(expected);
        });
    }

    test('returns unknown when the player tile is unavailable', () => {
        expect(touristTrapArea(null)).toBe('unknown');
    });
});

describe('Tourist Trap strict dialogue selector', () => {
    test('matches only an explicitly allowed option while normalizing case and whitespace', () => {
        expect(strictTouristTrapChoice(['No thanks.', "  YES,   I'LL BEND THE BAR.  "], ["Yes, I'll bend the bar."])).toBe("  YES,   I'LL BEND THE BAR.  ");
    });

    test('returns no match for an unknown menu instead of guessing a plausible choice', () => {
        expect(strictTouristTrapChoice(['Yes, bend these bars for me.', 'No, leave the window alone.'], ["Yes, I'll bend the bar.", "Yes, I'll bend the bar again."])).toBeNull();
    });

    test('does not accept punctuation drift or a partial label', () => {
        expect(strictTouristTrapChoice(["Yes I'll bend the bar"], ["Yes, I'll bend the bar."])).toBeNull();
        expect(strictTouristTrapChoice(["Yes, I'll bend"], ["Yes, I'll bend the bar."])).toBeNull();
    });

    test('returns the displayed option when several allowed labels are present', () => {
        expect(strictTouristTrapChoice(["Yes, I'll trade.", "It's funny you should say that"], ["It's funny you should say that", "Yes, I'll trade."])).toBe("Yes, I'll trade.");
    });
});

describe('Tourist Trap visible-stage decision matrix', () => {
    const preparedInventory: readonly CountEntry[] = [
        ['Coins', 1000],
        ['Kebab', 8],
        ['Desert shirt', 1],
        ['Desert robe', 1],
        ['Desert boots', 1],
        ['Waterskin(4)', 4],
        ['Bronze bar', 3],
        ['Feather', 50],
        ['Hammer', 1],
        ['Shantay pass', 1]
    ];
    const spareDesertOutfit: readonly CountEntry[] = DESERT_OUTFIT.map(name => [name, 1] as const);

    const cases: Array<{ name: string; snapshot: QuestSnapshot; action: string }> = [
        {
            name: 'stage 0 starts with Irena only after the complete loadout is ready and worn',
            snapshot: snap({ stage: 0, tile: IRENA, inv: preparedInventory, worn: DESERT_WORN }),
            action: 'start Tourist Trap with Irena'
        },
        {
            name: 'stage 1 challenges the captain from the desert',
            snapshot: snap({ stage: 1, tile: CAPTAIN, worn: DESERT_WORN }),
            action: 'provoke the Mercenary Captain'
        },
        {
            name: 'stage 3 resumes through the dialogue-provoked solo fight',
            snapshot: snap({ stage: 3, tile: CAPTAIN, worn: DESERT_WORN }),
            action: 'provoke and defeat the Mercenary Captain'
        },
        {
            name: 'stage 4 enters camp with the recovered metal key',
            snapshot: snap({ stage: 4, tile: CAPTAIN, inv: [['Metal key', 1]], worn: DESERT_WORN }),
            action: 'unlock the desert mining camp'
        },
        ...[5, 6, 7].map(stage => ({
            name: `stage ${stage} resumes the slave unlock/trade transaction`,
            snapshot: snap({ stage, tile: CAMP_SURFACE, inv: [...spareDesertOutfit, ['Metal key', 1]], worn: DESERT_WORN }),
            action: 'free the slave and trade the spare desert outfit'
        })),
        {
            name: 'stage 8 enters the mine in the complete slave disguise',
            snapshot: snap({ stage: 8, tile: CAMP_SURFACE, inv: [['Metal key', 1]], worn: SLAVE_WORN }),
            action: 'open the slave-only mine doors'
        },
        {
            name: 'stage 9 asks the inner guard about the cave',
            snapshot: snap({ stage: 9, tile: MINE_ENTRANCE, worn: SLAVE_WORN }),
            action: 'learn the cave guard wants a Tenti pineapple'
        },
        {
            name: 'stage 10 accepts the pineapple deal from Al Shabim',
            snapshot: snap({ stage: 10, tile: BEDABIN }),
            action: "accept Al Shabim's pineapple deal"
        },
        {
            name: 'stage 11 uses the Bedobin key to recover the plans',
            snapshot: snap({ stage: 11, tile: CAMP_SURFACE, inv: [['Bedobin key', 1], ['Metal key', 1]], worn: DESERT_WORN }),
            action: 'distract Captain Siad and steal the plans'
        },
        {
            name: 'stage 12 shows held technical plans to Al Shabim',
            snapshot: snap({
                stage: 12,
                tile: BEDABIN,
                inv: [
                    ['Technical plans', 1],
                    ['Bronze bar', 1],
                    ['Feather', 10],
                    ['Hammer', 1]
                ]
            }),
            action: 'show the technical plans to Al Shabim'
        },
        {
            name: 'stage 13 forges a tip when the plans, hammer, and bar are held',
            snapshot: snap({
                stage: 13,
                tile: BEDABIN,
                inv: [
                    ['Technical plans', 1],
                    ['Hammer', 1],
                    ['Bronze bar', 1]
                ]
            }),
            action: 'forge the prototype dart tip'
        },
        {
            name: 'stage 14 attaches ten feathers to a held tip',
            snapshot: snap({
                stage: 14,
                tile: BEDABIN,
                inv: [
                    ['Prototype dart tip', 1],
                    ['Feather', 10]
                ]
            }),
            action: 'attach feathers to the prototype dart tip'
        },
        {
            name: 'stage 15 gives the completed prototype to Al Shabim',
            snapshot: snap({ stage: 15, tile: BEDABIN, inv: [['Prototype dart', 1]] }),
            action: 'give the prototype dart to Al Shabim'
        },
        {
            name: 'stage 16 gives the pineapple to the cave guard',
            snapshot: snap({ stage: 16, tile: MINE_ENTRANCE, inv: [['Tenti pineapple', 1]], worn: SLAVE_WORN }),
            action: 'give the cave guard his Tenti pineapple'
        },
        {
            name: 'stage 17 takes the empty mining barrel',
            snapshot: snap({ stage: 17, tile: MINE_LOWER, worn: SLAVE_WORN, freeSlots: 1 }),
            action: 'take an empty mining barrel'
        },
        {
            name: 'stage 18 catches Ana after arriving in the deep mine with a barrel',
            snapshot: snap({ stage: 18, tile: MINE_DEEP, inv: [['Barrel', 1]], worn: SLAVE_WORN }),
            action: 'put Ana safely in the barrel'
        },
        {
            name: 'collapsed stages 19-26 advance a visible deep-mine Ana barrel through the cart',
            snapshot: snap({ stage: 19, tile: MINE_DEEP, inv: [['Ana in a barrel', 1]], worn: SLAVE_WORN }),
            action: 'move Ana through the deep-to-lower cart checkpoint'
        },
        {
            name: 'collapsed stages 27-29 claim the two reward choices with Irena',
            snapshot: snap({ stage: 27, tile: IRENA }),
            action: 'claim both Tourist Trap skill rewards'
        }
    ];

    for (const fixture of cases) {
        test(fixture.name, () => {
            expect(customName(decide(fixture.snapshot))).toBe(fixture.action);
        });
    }

    test('stage 30 is complete', () => {
        expect(decide(snap({ stage: 30 })).kind).toBe('done');
    });

    test('stage 0 keeps the disclaimer received while crossing south instead of routing back to bank', () => {
        const afterCrossing = preparedInventory
            .filter(([name]) => name !== 'Coins' && name !== 'Shantay pass')
            .concat([['Coins', 990], ['Shantay disclaimer', 1]]);
        expect(customName(decide(snap({ stage: 0, tile: IRENA, inv: afterCrossing, worn: DESERT_WORN })))).toBe(
            'start Tourist Trap with Irena'
        );
    });

    test('an unsupported numeric stage and an unavailable journal both fail closed', () => {
        expect(decide(snap({ stage: 2 })).kind).toBe('wait');
        expect(decide(snap({ stage: null })).kind).toBe('wait');
        expect(decide(snap({ journal: 'unknown', stage: 19, tile: MINE_DEEP })).kind).toBe('wait');
    });
});

describe('Tourist Trap jail precedence', () => {
    const activeStages = [0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 27];

    for (const stage of activeStages) {
        test(`stage ${stage} escapes a surface jail before its ordinary route`, () => {
            expect(customName(decide(snap({ stage, tile: SURFACE_JAIL })))).toBe('escape the surface jail through the rocks');
        });

        test(`stage ${stage} escapes the punishment mine before its ordinary route`, () => {
            expect(customName(decide(snap({ stage, tile: UNDERGROUND_JAIL })))).toBe('mine 15 punishment rocks and escape');
        });
    }

    test('completion remains terminal even if the stale player tile points at a jail', () => {
        expect(decide(snap({ stage: 30, tile: UNDERGROUND_JAIL })).kind).toBe('done');
    });
});

describe('Tourist Trap held, banked, and missing critical-item recovery', () => {
    test('metal key recovery checks held, then bank, then safely re-fights the captain', () => {
        expect(customName(decide(snap({ stage: 4, tile: CAPTAIN, inv: [['Metal key', 1]], worn: DESERT_WORN })))).toBe('unlock the desert mining camp');

        expect(customName(decide(snap({ stage: 4, tile: CAPTAIN, bank: [['Metal key', 1]], worn: DESERT_WORN })))).toBe(
            'cross the Shantay Pass north for supplies'
        );
        const banked = decide(snap({ stage: 4, tile: MAINLAND, bank: [['Metal key', 1]], worn: DESERT_WORN }));
        expect(banked.kind === 'withdraw' && banked.items).toEqual([{ name: 'Metal key', qty: 1 }]);

        expect(customName(decide(snap({ stage: 4, tile: CAPTAIN, worn: DESERT_WORN })))).toBe('provoke and defeat the respawned Mercenary Captain');
        expect(customName(decide(snap({ stage: 4, tile: CAPTAIN, bankKnown: false })))).toBe('cross the Shantay Pass north for supplies');
        expect(decide(snap({ stage: 4, tile: MAINLAND, bankKnown: false })).kind).toBe('scanBank');
    });

    test('Bedobin key recovery distinguishes held, banked, missing, and an unknown bank', () => {
        expect(customName(decide(snap({ stage: 11, tile: CAMP_SURFACE, inv: [['Bedobin key', 1], ['Metal key', 1]], worn: DESERT_WORN })))).toBe('distract Captain Siad and steal the plans');

        expect(customName(decide(snap({ stage: 11, tile: BEDABIN, bank: [['Bedobin key', 1]] })))).toBe(
            'cross the Shantay Pass north for supplies'
        );
        const banked = decide(snap({ stage: 11, tile: MAINLAND, bank: [['Bedobin key', 1]] }));
        expect(banked.kind === 'withdraw' && banked.items).toEqual([{ name: 'Bedobin key', qty: 1 }]);

        expect(customName(decide(snap({ stage: 11, tile: BEDABIN })))).toBe('ask Al Shabim for a replacement key');
        expect(customName(decide(snap({ stage: 11, tile: BEDABIN, bankKnown: false })))).toBe('cross the Shantay Pass north for supplies');
        expect(decide(snap({ stage: 11, tile: MAINLAND, bankKnown: false })).kind).toBe('scanBank');
    });

    test('technical plans recovery uses held plans, banked plans, or the source-authored replacement path', () => {
        expect(
            customName(
                decide(
                    snap({
                        stage: 12,
                        tile: BEDABIN,
                        inv: [
                            ['Technical plans', 1],
                            ['Bronze bar', 1],
                            ['Feather', 10],
                            ['Hammer', 1]
                        ]
                    })
                )
            )
        ).toBe('show the technical plans to Al Shabim');

        expect(customName(decide(snap({ stage: 12, tile: BEDABIN, bank: [['Technical plans', 1]] })))).toBe(
            'cross the Shantay Pass north for supplies'
        );
        const banked = decide(snap({ stage: 12, tile: MAINLAND, bank: [['Technical plans', 1]] }));
        expect(banked.kind === 'withdraw' && banked.items).toEqual([{ name: 'Technical plans', qty: 1 }]);

        expect(customName(decide(snap({ stage: 12, tile: BEDABIN })))).toBe('ask Al Shabim to replace the plans key');
        expect(customName(decide(snap({ stage: 12, tile: BEDABIN, bankKnown: false })))).toBe('cross the Shantay Pass north for supplies');
        expect(decide(snap({ stage: 12, tile: MAINLAND, bankKnown: false })).kind).toBe('scanBank');
    });

    test('stage 12 sources every item required for Al Shabim to advance the journal', () => {
        const base: readonly CountEntry[] = [['Technical plans', 1]];
        expect(customName(decide(snap({ stage: 12, tile: BEDABIN, inv: base })))).toBe('cross the Shantay Pass north for supplies');

        const bar = decide(snap({ stage: 12, tile: MAINLAND, inv: base }));
        expect(bar.kind === 'buy' && bar.item).toBe('Bronze bar');

        const feathers = decide(snap({ stage: 12, tile: MAINLAND, inv: [...base, ['Bronze bar', 1]] }));
        expect(feathers.kind === 'buy' && feathers.item).toBe('Feather');

        const hammer = decide(snap({
            stage: 12,
            tile: MAINLAND,
            inv: [...base, ['Bronze bar', 1], ['Feather', 10]]
        }));
        expect(hammer.kind === 'buy' && hammer.item).toBe('Hammer');
    });

    test("a confiscated camp key is recovered locally from Captain Siad's desk", () => {
        expect(customName(decide(snap({ stage: 12, tile: CAMP_SURFACE, inv: [['Technical plans', 1]], freeSlots: 2 })))).toBe(
            "recover the mining-camp keys from Captain Siad's desk"
        );
        expect(customName(decide(snap({
            stage: 12,
            tile: CAMP_SURFACE,
            inv: [['Technical plans', 1]],
            freeSlots: 0
        })))).toBe('free a slot for mining-camp key recovery');
    });

    test('a held Bedobin key routes back to the chest when only the plans are missing', () => {
        expect(
            customName(
                decide(
                    snap({
                        stage: 12,
                        tile: CAPTAIN,
                        inv: [
                            ['Bedobin key', 1],
                            ['Metal key', 1]
                        ],
                        worn: DESERT_WORN
                    })
                )
            )
        ).toBe('unlock the desert mining camp');
    });

    test('Tenti pineapple recovery distinguishes held, banked, missing, and an unknown bank', () => {
        expect(customName(decide(snap({ stage: 16, tile: MINE_ENTRANCE, inv: [['Tenti pineapple', 1]], worn: SLAVE_WORN })))).toBe('give the cave guard his Tenti pineapple');

        expect(customName(decide(snap({ stage: 16, tile: BEDABIN, bank: [['Tenti pineapple', 1]] })))).toBe(
            'cross the Shantay Pass north for supplies'
        );
        const banked = decide(snap({ stage: 16, tile: MAINLAND, bank: [['Tenti pineapple', 1]] }));
        expect(banked.kind === 'withdraw' && banked.items).toEqual([{ name: 'Tenti pineapple', qty: 1 }]);

        expect(customName(decide(snap({ stage: 16, tile: BEDABIN })))).toBe('replace the Tenti pineapple at Al Shabim');
        expect(customName(decide(snap({ stage: 16, tile: BEDABIN, bankKnown: false })))).toBe('cross the Shantay Pass north for supplies');
        expect(decide(snap({ stage: 16, tile: MAINLAND, bankKnown: false })).kind).toBe('scanBank');
    });

    test('a consumed crafting input is withdrawn from bank or re-bought without losing the plans', () => {
        const banked = decide(
            snap({
                stage: 13,
                tile: MAINLAND,
                inv: [
                    ['Technical plans', 1],
                    ['Hammer', 1]
                ],
                bank: [['Bronze bar', 1]]
            })
        );
        expect(banked.kind === 'withdraw' && banked.items).toEqual([{ name: 'Bronze bar', qty: 1 }]);

        const missing = decide(
            snap({
                stage: 13,
                tile: MAINLAND,
                inv: [
                    ['Technical plans', 1],
                    ['Hammer', 1]
                ]
            })
        );
        expect(missing.kind === 'buy' && missing.item).toBe('Bronze bar');
    });

    test('banked prototype products are recovered before trying to forge a duplicate', () => {
        expect(customName(decide(snap({ stage: 15, tile: BEDABIN, bank: [['Prototype dart', 1]] })))).toBe(
            'cross the Shantay Pass north for supplies'
        );
        const dart = decide(snap({ stage: 15, tile: MAINLAND, bank: [['Prototype dart', 1]] }));
        expect(dart.kind === 'withdraw' && dart.items).toEqual([{ name: 'Prototype dart', qty: 1 }]);

        const tip = decide(snap({ stage: 14, tile: MAINLAND, bank: [['Prototype dart tip', 1]] }));
        expect(tip.kind === 'withdraw' && tip.items).toEqual([{ name: 'Prototype dart tip', qty: 1 }]);
    });

    for (const stage of [10, 11, 16]) {
        test(`stage ${stage} banks expendables before crossing south for a full-pack Al reward`, () => {
            const step = decide(
                snap({
                    stage,
                    tile: MAINLAND,
                    inv: [
                        ['Shantay pass', 1],
                        ['Kebab', 8]
                    ],
                    freeSlots: 0
                })
            );
            expect(step.kind).toBe('deposit');
        });
    }

    test('crafting recovery banks expendables instead of waiting with a full pack', () => {
        const step = decide(
            snap({
                stage: 13,
                tile: MAINLAND,
                inv: [
                    ['Technical plans', 1],
                    ['Hammer', 1],
                    ['Kebab', 8]
                ],
                bank: [['Bronze bar', 1]],
                freeSlots: 0
            })
        );
        expect(step.kind).toBe('deposit');
    });
});

describe('Tourist Trap disguise and rescue restart matrix', () => {
    test('all eight slave-outfit worn subsets either finish dressing or enter the mine', () => {
        for (let mask = 0; mask < 8; mask++) {
            const wornPieces = SLAVE_OUTFIT.filter((_, index) => (mask & (1 << index)) !== 0);
            const heldPieces: CountEntry[] = [
                ...SLAVE_OUTFIT.filter((_, index) => (mask & (1 << index)) === 0).map(name => [name, 1] as const),
                ['Metal key', 1]
            ];
            const step = decide(snap({ stage: 8, tile: CAMP_SURFACE, inv: heldPieces, worn: [...wornPieces, 'Bronze pickaxe'] }));
            expect(customName(step)).toBe(mask === 7 ? 'open the slave-only mine doors' : 'wear the slave disguise');
        }
    });

    test('all eight desert-outfit worn subsets either finish dressing or challenge the captain', () => {
        for (let mask = 0; mask < 8; mask++) {
            const wornPieces = DESERT_OUTFIT.filter((_, index) => (mask & (1 << index)) !== 0);
            const heldPieces = DESERT_OUTFIT.filter((_, index) => (mask & (1 << index)) === 0).map(name => [name, 1] as const);
            const step = decide(snap({ stage: 1, tile: CAPTAIN, inv: heldPieces, worn: [...wornPieces, 'Bronze pickaxe'] }));
            expect(customName(step)).toBe(mask === 7 ? 'provoke the Mercenary Captain' : 'wear the camp-safe desert loadout');
        }
    });

    test('mine transport direction follows the verified west/east cave components', () => {
        expect(customName(decide(snap({ stage: 9, tile: MINE_LOWER, worn: SLAVE_WORN })))).toBe('cross back to the cave guards');
        expect(customName(decide(snap({ stage: 17, tile: MINE_ENTRANCE, worn: SLAVE_WORN, freeSlots: 1 })))).toBe(
            'walk through the guarded mine cave'
        );
        expect(customName(decide(snap({ stage: 19, tile: MINE_ENTRANCE, worn: SLAVE_WORN })))).toBe(
            'leave the mine to resolve the surface checkpoint'
        );
    });

    test('a lost slave outfit deliberately returns to the punishment component for deterministic recovery', () => {
        for (const worldTile of [MINE_ENTRANCE, MINE_LOWER, MINE_DEEP]) {
            expect(customName(decide(snap({ stage: 17, tile: worldTile })))).toBe(
                'return to the punishment mine to recover the slave disguise'
            );
        }
    });

    test('a recovered backpack disguise is worn before traversing the guarded cave', () => {
        const heldOutfit = SLAVE_OUTFIT.map(name => [name, 1] as const);
        expect(customName(decide(snap({ stage: 9, tile: MINE_LOWER, inv: heldOutfit })))).toBe('wear the slave disguise');
        expect(customName(decide(snap({ stage: 17, tile: MINE_ENTRANCE, inv: heldOutfit, freeSlots: 1 })))).toBe('wear the slave disguise');
    });

    test('prototype recovery leaves the keyed camp before walking to the Bedabin anvil', () => {
        const supplies: readonly CountEntry[] = [
            ['Technical plans', 1],
            ['Hammer', 1],
            ['Bronze bar', 1],
            ['Metal key', 1]
        ];
        expect(customName(decide(snap({ stage: 13, tile: CAMP_UPPER, inv: supplies })))).toBe('climb down before item recovery');
        expect(customName(decide(snap({ stage: 13, tile: CAMP_SURFACE, inv: supplies, worn: DESERT_WORN })))).toBe(
            'leave the camp safely for item recovery'
        );
    });

    const rescueFixtures = [
        [17, MINE_LOWER, [], 0, 'free one slot for the rescue barrel'],
        [17, MINE_LOWER, [], 1, 'take an empty mining barrel'],
        [17, MINE_LOWER, [['Barrel', 1]], 0, 'ride the mine cart and catch Ana in the barrel'],
        [18, MINE_LOWER, [], 0, 'free one slot for the rescue barrel'],
        [18, MINE_LOWER, [], 1, 'take an empty mining barrel'],
        [18, MINE_LOWER, [['Barrel', 1]], 0, 'ride back to Ana with the empty barrel'],
        [18, MINE_DEEP, [['Barrel', 1]], 0, 'put Ana safely in the barrel'],
        [19, MINE_DEEP, [['Barrel', 1]], 0, 'reset the rescue state by catching original Ana'],
        [19, MINE_DEEP, [['Ana in a barrel', 1]], 0, 'move Ana through the deep-to-lower cart checkpoint'],
        [19, MINE_LOWER, [], 0, 'free one slot for the lower barrel probe'],
        [19, MINE_LOWER, [], 1, 'resolve the lower barrel/lift checkpoint'],
        [19, MINE_LOWER, [['Ana in a barrel', 1]], 0, 'lift Ana and retrieve her at the surface checkpoint'],
        [19, CAMP_SURFACE, [['Ana in a barrel', 1]], 0, 'resolve the surface winch/cart checkpoint'],
        [19, CAMP_UPPER, [], 1, 'climb down to the surface rescue machinery'],
        [19, CAPTAIN, [['Ana in a barrel', 1]], 0, 'return Ana to Irena'],
        [19, IRENA, [['Ana in a barrel', 1]], 0, 'return Ana to Irena']
    ] as const;

    for (const [index, [stage, worldTile, inventory, freeSlots, action]] of rescueFixtures.entries()) {
        test(`routes rescue checkpoint fixture ${index + 1}: stage ${stage} -> ${action}`, () => {
            expect(customName(decide(snap({ stage, tile: worldTile, inv: inventory, worn: SLAVE_WORN, freeSlots })))).toBe(action);
        });
    }

    test('retries the failed stage-19 lower cart in place with an ordinary barrel', () => {
        for (const freeSlots of [0, 1, 8]) {
            const failedCart = snap({
                stage: TOURIST_TRAP_STAGE.RESCUE,
                tile: MINE_LOWER,
                inv: [['Barrel', 1]],
                worn: SLAVE_WORN,
                freeSlots
            });
            const firstDecision = customName(decide(failedCart));
            const repeatedDecision = customName(decide(failedCart));
            expect(firstDecision).toBe('retry the lower mine cart with the empty barrel');
            expect(repeatedDecision).toBe(firstDecision);
        }
    });

    test('irrelevant screenshot inventory does not change failed-cart recovery', () => {
        const step = decide(snap({
            stage: TOURIST_TRAP_STAGE.RESCUE,
            tile: MINE_LOWER,
            inv: [
                ['Barrel', 1],
                ['Coins', 606],
                ['Metal key', 1],
                ['Desert shirt', 1],
                ['Desert robe', 1],
                ['Desert boots', 1]
            ],
            worn: SLAVE_WORN,
            freeSlots: 8
        }));
        expect(customName(step)).toBe('retry the lower mine cart with the empty barrel');
    });

    test('does not attempt the impossible deep-mine Ana interaction without an empty barrel', () => {
        const step = decide(snap({ stage: 18, tile: MINE_DEEP, worn: SLAVE_WORN, freeSlots: 1 }));
        expect(customName(step)?.toLowerCase()).toContain('lower');
    });

    test('a missing visible Ana barrel at the surface safely probes the collapsed transport stages first', () => {
        const step = decide(snap({ stage: 19, tile: CAMP_SURFACE, worn: SLAVE_WORN, freeSlots: 1 }));
        expect(customName(step)).toBe('resolve the surface winch/cart checkpoint');
    });

    test('surface rescue reacquires a lost slave garment before its cleared-state mine reset', () => {
        const spareDesert = DESERT_OUTFIT.map(name => [name, 1] as const);
        const recovery = decide(snap({
            stage: 19,
            tile: CAMP_SURFACE,
            inv: [...spareDesert, ['Metal key', 1]],
            worn: DESERT_WORN,
            freeSlots: 8
        }));
        expect(customName(recovery)).toBe('replace the slave disguise');

        const alreadySurface = decide(snap({
            stage: 19,
            tile: CAMP_SURFACE,
            inv: [['Ana in a barrel', 1]],
            freeSlots: 1
        }));
        expect(customName(alreadySurface)).toBe('resolve the surface winch/cart checkpoint');
    });

    test('surface rescue re-trades the worn desert outfit without sourcing a redundant copy', () => {
        const trade = decide(snap({
            stage: 19,
            tile: CAMP_SURFACE,
            inv: [['Metal key', 1]],
            worn: DESERT_WORN,
            freeSlots: 8
        }));
        expect(customName(trade)).toBe('replace the slave disguise');

        const enter = decide(snap({
            stage: 19,
            tile: CAPTAIN,
            inv: [['Metal key', 1]],
            worn: DESERT_WORN,
            freeSlots: 8
        }));
        expect(customName(enter)).toBe('unlock the desert mining camp');
    });

    test('the mine-entry composite re-sanitizes forbidden extra equipment before moving', () => {
        const step = decide(snap({ stage: 8, tile: CAMP_SURFACE, inv: [['Metal key', 1]], worn: [...SLAVE_WORN, 'Rune kiteshield'] }));
        expect(customName(step)).toBe('open the slave-only mine doors');
    });

    test('a full pack never starts a key-producing captain fight', () => {
        const step = decide(snap({ stage: 4, tile: CAPTAIN, worn: DESERT_WORN, freeSlots: 0 }));
        expect(customName(step)).not.toContain('defeat');
    });
});

describe('Tourist Trap surface rescue orchestration', () => {
    interface HarnessOptions {
        ana?: boolean;
        lift?: boolean;
        cart?: readonly boolean[];
        recapture?: boolean;
        interruptAfterCart?: number;
    }

    function harness(options: HarnessOptions = {}) {
        let ana = options.ana ?? false;
        let cartIndex = 0;
        let upkeep = 0;
        const calls: string[] = [];
        const logs: string[] = [];
        const operations: SurfaceRescueOperations = {
            hasAnaBarrel: () => ana,
            retrieveLift: async () => {
                calls.push('lift');
                ana = options.lift ?? false;
                return ana;
            },
            escapeByCart: async () => {
                calls.push('cart');
                const result = options.cart?.[cartIndex++] ?? false;
                if (cartIndex === options.interruptAfterCart) EventSignal.setInterrupt(() => true);
                return result;
            },
            recaptureAna: async () => {
                calls.push('recapture');
                return options.recapture ?? false;
            },
            currentArea: () => 'campSurface',
            maintainSurvival: async () => {
                upkeep++;
            },
            waitBetweenAttempts: async () => {
                calls.push('wait');
            }
        };
        return { operations, calls, logs, upkeep: () => upkeep, log: (message: string) => logs.push(message) };
    }

    test('lift recovery short-circuits cart and recapture probes', async () => {
        const run = harness({ lift: true });
        expect(await runSurfaceRescueCheckpoint(run.operations, run.log)).toBe(true);
        expect(run.calls).toEqual(['lift']);
    });

    test('an existing Ana barrel skips the lift and escapes by cart', async () => {
        const run = harness({ ana: true, cart: [true] });
        expect(await runSurfaceRescueCheckpoint(run.operations, run.log)).toBe(true);
        expect(run.calls).toEqual(['cart']);
        expect(run.logs).toContain('surface cart attempt 1/3');
    });

    test('retries a bounded surface cart probe before succeeding', async () => {
        const run = harness({ cart: [false, true] });
        expect(await runSurfaceRescueCheckpoint(run.operations, run.log)).toBe(true);
        expect(run.calls).toEqual(['lift', 'cart', 'wait', 'cart']);
        expect(run.logs).toContain('surface cart attempt 2/3');
    });

    test('starts one canonical deep-mine replay only after all surface probes fail', async () => {
        const run = harness({ cart: [false, false, false], recapture: true });
        expect(await runSurfaceRescueCheckpoint(run.operations, run.log)).toBe(true);
        expect(run.calls).toEqual(['lift', 'cart', 'wait', 'cart', 'wait', 'cart', 'recapture']);
        expect(run.logs).toContain('surface lift/cart state is clear; starting the canonical deep-mine replay');
    });

    test('does not take Ana back underground after a transient surface-cart failure', async () => {
        const run = harness({ ana: true, cart: [false, false, false], recapture: true });
        expect(await runSurfaceRescueCheckpoint(run.operations, run.log)).toBe(false);
        expect(run.calls).toEqual(['cart', 'wait', 'cart', 'wait', 'cart']);
        expect(run.logs).toContain('surface cart unresolved while carrying Ana; retrying this checkpoint in place');
    });

    test('reports an unresolved deep-mine recapture', async () => {
        const run = harness({ cart: [false, false, false], recapture: false });
        expect(await runSurfaceRescueCheckpoint(run.operations, run.log)).toBe(false);
        expect(run.logs).toContain('deep-mine recapture did not complete; current area=campSurface');
    });

    test('runs survival upkeep around retries', async () => {
        const run = harness({ cart: [false, true] });
        expect(await runSurfaceRescueCheckpoint(run.operations, run.log)).toBe(true);
        expect(run.upkeep()).toBe(5);
    });

    test('an interrupt after a failed cart stops every later attempt and recapture', async () => {
        const run = harness({ cart: [false, true], recapture: true, interruptAfterCart: 1 });
        expect(await runSurfaceRescueCheckpoint(run.operations, run.log)).toBe(false);
        expect(run.calls).toEqual(['lift', 'cart']);
    });
});

describe('Tourist Trap observe (logging pilot)', () => {
    test('dumps stage, area, skins, and decide step', () => {
        const s = snap({
            stage: TOURIST_TRAP_STAGE.STARTED,
            tile: CAPTAIN,
            inv: [
                ['Waterskin(4)', 2],
                ['Shantay pass', 1],
                ['Coins', 900]
            ],
            worn: [...DESERT_WORN]
        });
        const step = decide(s);
        const lines = observeTouristTrap(s, step);
        expect(lines.some(l => l.includes('stage=1'))).toBe(true);
        expect(lines.some(l => l.includes('area=desert') || l.includes('area='))).toBe(true);
        expect(lines.some(l => l.includes('water=8 doses across 2 skins'))).toBe(true);
        expect(lines.some(l => l.startsWith('tt: decide→'))).toBe(true);
        expect(lines.some(l => l.includes('WARN') && l.includes('waterskin'))).toBe(false);
    });

    test('warns when in desert with zero charged waterskins', () => {
        const s = snap({
            stage: TOURIST_TRAP_STAGE.STARTED,
            tile: CAPTAIN,
            inv: [['Coins', 100]],
            worn: [...DESERT_WORN],
            skins: 0
        });
        const lines = observeTouristTrap(s, { kind: 'wait', reason: 'death' });
        expect(lines.some(l => l.includes('WARN') && l.includes('0 waterskin doses'))).toBe(true);
        expect(lines.some(l => l.includes('death dump'))).toBe(true);
    });

    test('refuses to re-enter the desert without charged waterskins after death recovery', () => {
        const s = snap({
            stage: TOURIST_TRAP_STAGE.LEARNED_DARTS,
            tile: MAINLAND,
            inv: [['Coins', 200]],
            skins: 0
        });
        const step = decide(s);
        expect(step.kind).toBe('buy');
        if (step.kind === 'buy') {
            expect(step.item).toBe('Waterskin(4)');
            expect(step.qty).toBe(4);
        }
    });

    test('already south with zero skins routes north for restock before pineapple recovery', () => {
        const s = snap({
            stage: TOURIST_TRAP_STAGE.LEARNED_DARTS,
            tile: IRENA,
            inv: [['Coins', 50]],
            skins: 0
        });
        expect(customName(decide(s))).toBe('cross the Shantay Pass north for supplies');
    });

    test('configured food permits captain recovery without kebabs', () => {
        expect(customName(decide(snap({
            stage: TOURIST_TRAP_STAGE.KILLED_CAPTAIN,
            tile: CAPTAIN,
            inv: [['Coins', 50], ['Bronze pickaxe', 1], ['Trout', 16]],
            worn: [...DESERT_WORN],
            kebabs: 0,
            food: 0
        })))).toBe('provoke and defeat the respawned Mercenary Captain');
    });
});

describe('Tourist Trap survival accounting', () => {
    test('counts doses rather than charged containers', () => {
        expect(waterskinDoses(snap({ inv: [['Waterskin(1)', 4]], skins: 0 }))).toBe(4);
        expect(waterskinDoses(snap({
            inv: [['Waterskin(4)', 1], ['Waterskin(3)', 1], ['Waterskin(2)', 1], ['Waterskin(1)', 1]],
            skins: 0
        }))).toBe(10);
    });

    test('withdraws only the configured food', () => {
        const step = decide(snap({
            stage: TOURIST_TRAP_STAGE.STARTED,
            tile: MAINLAND,
            bank: [['Trout', 16], ['Kebab', 50]],
            food: 0,
            kebabs: 0,
            freeSlots: 20
        }));
        expect(step.kind === 'withdraw' && step.items).toEqual([{ name: 'Trout', qty: 16 }]);
    });

    test('tops up a partial configured loadout while already on the mainland', () => {
        const step = decide(snap({
            stage: TOURIST_TRAP_STAGE.RESCUE,
            tile: MAINLAND,
            bank: [['Trout', 8]],
            food: 8,
            kebabs: 0,
            freeSlots: 20
        }));
        expect(step.kind === 'withdraw' && step.items).toEqual([{ name: 'Trout', qty: 8 }]);
    });

    test('fails explicitly when the configured food target is unavailable', () => {
        const step = decide(snap({
            stage: TOURIST_TRAP_STAGE.STARTED,
            tile: MAINLAND,
            bank: [['Trout', 15], ['Kebab', 50]],
            food: 0,
            kebabs: 0,
            freeSlots: 20
        }));
        expect(step).toEqual({
            kind: 'wait',
            reason: "configured Tourist Trap food 'Trout' unavailable: need 16, carried 0, banked 15"
        });
    });

    test('recognizes every configured Cake form', () => {
        QuestFood.name = 'Cake';
        const step = decide(snap({
            stage: TOURIST_TRAP_STAGE.STARTED,
            tile: CAPTAIN,
            inv: [['Cake', 1], ['2/3 cake', 2], ['Slice of cake', 1], ['Bronze pickaxe', 1]],
            worn: [...DESERT_WORN],
            food: 0,
            kebabs: 0
        }));
        expect(customName(step)).toBe('provoke the Mercenary Captain');
    });

    test('quest-ration mode tops up to sixteen on the mainland but accepts eight in the desert', () => {
        QuestFood.name = null;
        expect(customName(decide(snap({
            stage: TOURIST_TRAP_STAGE.RESCUE,
            tile: MAINLAND,
            kebabs: 8,
            food: 0
        })))).toBe('buy 8 Kebabs');

        expect(customName(decide(snap({
            stage: TOURIST_TRAP_STAGE.KILLED_CAPTAIN,
            tile: CAPTAIN,
            inv: [['Bronze pickaxe', 1]],
            worn: [...DESERT_WORN],
            kebabs: 8,
            food: 0
        })))).toBe('provoke and defeat the respawned Mercenary Captain');
    });

    test('entry hysteresis does not detour for one consumed food or water dose', () => {
        QuestFood.name = null;
        const step = decide(snap({
            stage: TOURIST_TRAP_STAGE.RESCUE,
            tile: tile(3302, 3118),
            inv: [
                ...SLAVE_OUTFIT.map(name => [name, 1] as const),
                ['Waterskin(4)', 3],
                ['Waterskin(3)', 1],
                ['Metal key', 1]
            ],
            worn: DESERT_WORN,
            kebabs: 15,
            food: 0,
            skins: 0,
            coins: 200,
            freeSlots: 4
        }));
        expect(step).toMatchObject({ kind: 'buy', item: 'Shantay pass', qty: 1 });
    });

    test('does not refill the rescue float after buying a pass while at the 100-coin cart floor', () => {
        QuestFood.name = null;
        const rescuePack: CountEntry[] = [
            ...SLAVE_OUTFIT.map(name => [name, 1] as const),
            ['Waterskin(4)', 3],
            ['Waterskin(3)', 1],
            ['Metal key', 1],
            ['Shantay pass', 1]
        ];
        const step = decide(snap({
            stage: TOURIST_TRAP_STAGE.RESCUE,
            tile: tile(3308, 3120),
            inv: rescuePack,
            worn: DESERT_WORN,
            kebabs: 16,
            food: 0,
            skins: 0,
            coins: 195,
            freeSlots: 0
        }));
        expect(customName(step)).toBe('cross the Shantay Pass');
    });

    test('refills to the rescue target below the 100-coin cart floor', () => {
        QuestFood.name = null;
        const step = decide(snap({
            stage: TOURIST_TRAP_STAGE.RESCUE,
            tile: MAINLAND,
            inv: SLAVE_OUTFIT.map(name => [name, 1] as const),
            worn: DESERT_WORN,
            bank: [['Coins', 500]],
            kebabs: 16,
            food: 0,
            coins: 99,
            freeSlots: 8
        }));
        expect(step.kind === 'withdraw' && step.items).toEqual([{ name: 'Coins', qty: 40 }]);
    });

    test('rebuilds a two-copy desert outfit through a one-slot recovery pack', () => {
        QuestFood.name = null;
        const sharedInventory: CountEntry[] = [
            ['Desert shirt', 2],
            ['Desert robe', 2],
            ["Slaves' shirt", 1],
            ['Bronze pickaxe', 1]
        ];
        const firstBoot = decide(snap({
            stage: TOURIST_TRAP_STAGE.ENTERED_CAMP,
            tile: MAINLAND,
            inv: sharedInventory,
            kebabs: 16,
            food: 0,
            coins: 160,
            freeSlots: 1
        }));
        expect(firstBoot).toMatchObject({ kind: 'buy', item: 'Desert boots', qty: 1, estGp: 25 });

        const makeSpace = decide(snap({
            stage: TOURIST_TRAP_STAGE.ENTERED_CAMP,
            tile: MAINLAND,
            inv: [...sharedInventory, ['Desert boots', 1]],
            kebabs: 16,
            food: 0,
            coins: 135,
            freeSlots: 0
        }));
        expect(customName(makeSpace)).toBe('wear the first desert outfit to free recovery slots');
    });

    test('normalizes partial skins before adding full containers', () => {
        const step = decide(snap({
            stage: TOURIST_TRAP_STAGE.LEARNED_DARTS,
            tile: MAINLAND,
            inv: [['Waterskin(1)', 4], ['Tenti pineapple', 1]],
            bank: [['Waterskin(4)', 4]],
            skins: 0
        }));
        expect(step.kind).toBe('deposit');
        if (step.kind === 'deposit') {
            expect(step.keep).not.toContain('waterskin(1)');
            expect(step.keep).toContain('waterskin(4)');
        }
    });

    test('withdraws only the full skins needed to reach the entry-dose target', () => {
        const step = decide(snap({
            stage: TOURIST_TRAP_STAGE.LEARNED_DARTS,
            tile: MAINLAND,
            inv: [['Waterskin(4)', 1], ['Tenti pineapple', 1]],
            bank: [['Waterskin(4)', 3]],
            skins: 0
        }));
        expect(step.kind === 'withdraw' && step.items).toEqual([{ name: 'Waterskin(4)', qty: 3 }]);
    });

    test('recovers a missing slave garment locally before trying to restock', () => {
        const step = decide(snap({
            stage: TOURIST_TRAP_STAGE.RESCUE,
            tile: MINE_ENTRANCE,
            inv: [["Slaves' shirt", 1]],
            food: 0,
            skins: 0,
            coins: 0
        }));
        expect(customName(step)).toBe('return to the punishment mine to recover the slave disguise');
    });

    test('funds only the exact cost of a missing trade outfit purchase', () => {
        const step = decide(snap({
            stage: TOURIST_TRAP_STAGE.ENTERED_CAMP,
            tile: MAINLAND,
            coins: 0
        }));
        expect(customName(step)).toBe('earn 90 gp (Al Kharid Man + Kebabs)');
    });

    test('funds only the exact cost of a missing crafting consumable', () => {
        const step = decide(snap({
            stage: TOURIST_TRAP_STAGE.RETRIEVED_PLANS,
            tile: MAINLAND,
            inv: [['Technical plans', 1]],
            coins: 0
        }));
        expect(customName(step)).toBe('earn 8 gp (Al Kharid Man + Kebabs)');
    });
});

describe('Tourist Trap prototype forge attempts', () => {
    test('ignores an old wasted-bar message and recognizes only the current attempt', () => {
        GameMessages.record('You have an unlucky accident and waste the bronze bar.');
        const currentAttempt = GameMessages.mark();
        expect(forgeBarWastedSince(currentAttempt)).toBe(false);
        GameMessages.record('You have an unlucky accident and waste the bronze bar.');
        expect(forgeBarWastedSince(currentAttempt)).toBe(true);
    });
});
