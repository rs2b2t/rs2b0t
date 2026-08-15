import { describe, expect, test } from 'bun:test';
import {
    BLASTS,
    SAFESPOT,
    teleportKitPlan,
    teleportKitTopUp,
    FC_ID,
    FC_STAGE,
    decide,
    familycrest,
    inPerfectGoldZone,
    mineRegion,
    parseFamilyCrestJournal
} from '#/bot/api/ai/quests/defs/familycrest/index.js';
import type { WorldTile } from '#/bot/adapter/ClientAdapter.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

const VARROCK: WorldTile = { x: 3253, z: 3420, level: 0 };
const MINE_MAIN: WorldTile = { x: 2700, z: 9683, level: 0 };
const MINE_GOLD: WorldTile = { x: 2737, z: 9689, level: 0 };
const RUNE_SCIM = 1333;
const STEEL_PICK = 1269;

function snap(options: {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    invIds?: [number, number][];
    inv?: [string, number][];
    bankIds?: [number, number][];
    bank?: [string, number][];
    bankKnown?: boolean;
    tile?: WorldTile | null;
    freeSlots?: number;
    wornIds?: number[];
    dropFragments?: boolean;
} = {}): QuestSnapshot {
    const stage = options.stage ?? FC_STAGE.NOT_STARTED;
    // Fragments already granted at this stage are carried unless a test is
    // deliberately exercising the lost-fragment recovery.
    const granted: [number, number][] = options.dropFragments === true ? [] : [
        ...(stage >= FC_STAGE.CALEB_WHERE ? [[FC_ID.CREST_FROM_CALEB, 1] as [number, number]] : []),
        ...(stage >= FC_STAGE.AVAN_PIECE ? [[FC_ID.CREST_FROM_AVAN, 1] as [number, number]] : [])
    ];
    const invIds = new Map(granted);
    for (const [id, qty] of options.invIds ?? []) {
        invIds.set(id, qty);
    }
    return {
        journal: options.journal ?? (stage === FC_STAGE.NOT_STARTED ? 'notStarted' : 'inProgress'),
        inv: new Map((options.inv ?? []).map(([n, q]) => [n.toLowerCase(), q])),
        invIds,
        worn: new Set(),
        wornIds: new Set(options.wornIds ?? []),
        noProgress: 0,
        bankCoins: 2_000_000,
        stage,
        progress: { stage, flags: new Set() },
        bank: new Map((options.bank ?? []).map(([n, q]) => [n.toLowerCase(), q])),
        bankIds: new Map(options.bankIds ?? []),
        bankKnown: options.bankKnown ?? true,
        tile: options.tile === undefined ? VARROCK : options.tile,
        freeSlots: options.freeSlots ?? 20
    };
}

const ALL_FISH: [number, number][] = [
    [FC_ID.SWORDFISH, 1], [FC_ID.BASS, 1], [FC_ID.TUNA, 1], [FC_ID.SALMON, 1], [FC_ID.SHRIMP, 1]
];

function talkTarget(step: QuestStep): string | null {
    return step.kind === 'talk' ? step.stop.npc : null;
}

function customName(step: QuestStep): string | null {
    return step.kind === 'custom' ? step.name : null;
}

/**
 * Journal lines copied verbatim out of `quest_crest/scripts/crest_journal.rs2`,
 * appended as the server appends them.
 */
const HEADER = "@str@I have agreed to restore Dimintheis' family crest to him.|";
const FOUND_CALEB = '@str@I found Caleb working as a Chef in Catherby and told him of|'
    + '@str@my Quest for his father to restore his Family Crest.|'
    + '@str@I discovered the Crest had been split into three with each|'
    + "@str@of Dimintheis' three sons taking a piece each.|";
const GAVE_FISH = '@str@I gave Caleb the Swordfish, Bass, Tuna, Salmon and Shrimp|'
    + '@str@he needed for his salad in return for his crest piece.|';
const FOUND_AVAN = '@str@I found Avan by some gold rocks North of Al-Kharid.|';
const AVAN_GAVE = '@str@Avan gave me his crest piece in return for a ruby ring and|'
    + "@str@ruby necklace made of high quality 'perfect gold'.|";
const CURED = '@str@I found Johnathan looking very ill at the Jolly Boar Inn.|'
    + '@str@He soon recovered when I used an antipoison potion on|@str@him.|';

describe('Family Crest journal parsing', () => {
    test('not started', () => {
        expect(parseFamilyCrestJournal(
            '@dbl@I can start this quest by speaking to @dre@Dimintheis@dbl@ in @dre@East|@dre@Varrock|'
        )?.stage).toBe(FC_STAGE.NOT_STARTED);
    });

    test('spoken to Dimintheis', () => {
        expect(parseFamilyCrestJournal(
            HEADER + '@dbl@I need to find his son @dre@Caleb@dbl@. The last Dimintheis heard of|'
            + '@dbl@him he was a great @dre@chef@dbl@ beyond @dre@White Wolf Mountain'
        )?.stage).toBe(FC_STAGE.SPOKEN_DIMINTHEIS);
    });

    test('Caleb wants the fish', () => {
        expect(parseFamilyCrestJournal(
            HEADER + FOUND_CALEB + '@dre@Caleb@dbl@ will let me have @dre@his piece@dbl@ in return for:|'
            + '@dre@one cooked Tuna|@dre@one cooked Bass|@dre@one cooked Salmon|'
            + '@dre@one cooked Shrimp|@dre@one cooked Swordfish'
        )?.stage).toBe(FC_STAGE.SPOKEN_CALEB);
    });

    test('one crest piece', () => {
        expect(parseFamilyCrestJournal(
            HEADER + FOUND_CALEB + GAVE_FISH
            + '@dbl@I have @dre@one@dbl@ crest piece, I need to find the other @dre@two'
        )?.stage).toBe(FC_STAGE.CALEB_PIECE);
    });

    test('Caleb pointed at the desert', () => {
        expect(parseFamilyCrestJournal(
            HEADER + FOUND_CALEB + GAVE_FISH
            + '@dre@Caleb@dbl@ told me his brother @dre@Avan@dbl@ is on a treasure hunt in the|'
            + '@dre@desert@dbl@ somewhere - I should search for him there'
        )?.stage).toBe(FC_STAGE.CALEB_WHERE);
    });

    test('gem trader described the yellow cape', () => {
        expect(parseFamilyCrestJournal(
            HEADER + FOUND_CALEB + GAVE_FISH
            + '@dbl@The @dre@Al-Kharid Gem Trader@dbl@ told me that @dre@Avan@dbl@ is wearing a|'
            + '@dre@yellow cape@dbl@, and headed into the @dre@desert@dbl@ by the @dre@scorpions'
        )?.stage).toBe(FC_STAGE.SPOKEN_GEM_TRADER);
    });

    test('Avan sent us to Boot', () => {
        expect(parseFamilyCrestJournal(
            HEADER + FOUND_CALEB + GAVE_FISH
            + '@dbl@I should find a dwarf named @dre@Boot@dbl@ who lives somewhere in|'
            + "@dre@the mountains@dbl@ and knows where to find @dre@'Perfect Gold'"
        )?.stage).toBe(FC_STAGE.SPOKEN_AVAN);
    });

    test('Boot named the mine', () => {
        expect(parseFamilyCrestJournal(
            HEADER + FOUND_CALEB + GAVE_FISH + FOUND_AVAN
            + '@dre@Avan@dbl@ will give me his @dre@crest piece@dbl@ if I can bring him a @dre@ruby|'
            + "@dre@ring@dbl@ and @dre@ruby necklace@dbl@ made from @dre@'perfect gold'|"
            + "@dbl@I need to make a @dre@ruby ring@dbl@ made of @dre@'perfect gold'|"
        )?.stage).toBe(FC_STAGE.SPOKEN_BOOT);
    });

    test('two pieces, Johnathon next', () => {
        expect(parseFamilyCrestJournal(
            HEADER + FOUND_CALEB + GAVE_FISH + FOUND_AVAN + AVAN_GAVE
            + '@dbl@The @dre@final crest@dbl@ piece is with their brother @dre@Johnathon@dbl@ who is|'
            + '@dbl@a magical demon hunter at a @dre@tavern@dbl@ near the @dre@wilderness'
        )?.stage).toBe(FC_STAGE.AVAN_PIECE);
    });

    test('Johnathon is poisoned', () => {
        expect(parseFamilyCrestJournal(
            HEADER + FOUND_CALEB + GAVE_FISH + FOUND_AVAN + AVAN_GAVE
            + '@dbl@I found @dre@Johnathon@dbl@ looking very ill at the @dre@Jolly Boar Inn'
        )?.stage).toBe(FC_STAGE.SPOKEN_JOHNATHON);
    });

    test('cured — Chronozon is the last step', () => {
        expect(parseFamilyCrestJournal(
            HEADER + FOUND_CALEB + GAVE_FISH + FOUND_AVAN + AVAN_GAVE + CURED
            + '@dre@Johnathon@dbl@ lost his piece of the family crest to a demon|'
            + '@dbl@named @dre@Chronozon@dbl@ under the @dre@Air Obelisk@dbl@ in the @dre@Wilderness'
        )?.stage).toBe(FC_STAGE.CURED_JOHNATHON);
    });

    test('the cured line alone still reads as stage 10, not 9', () => {
        expect(parseFamilyCrestJournal(HEADER + FOUND_CALEB + GAVE_FISH + FOUND_AVAN + AVAN_GAVE + CURED)?.stage)
            .toBe(FC_STAGE.CURED_JOHNATHON);
    });

    test('quest complete', () => {
        expect(parseFamilyCrestJournal(
            HEADER + FOUND_CALEB + GAVE_FISH + FOUND_AVAN + AVAN_GAVE + CURED
            + '@str@I took all three pieces of the crest back to Dimintheis in|@red@QUEST COMPLETE!'
        )?.stage).toBe(FC_STAGE.COMPLETE);
    });

    test('an unparseable scroll yields nothing rather than stage 0', () => {
        expect(parseFamilyCrestJournal('')).toBeUndefined();
    });
});

describe('Family Crest mine geography', () => {
    test('the four lever-door regions are told apart by tile alone', () => {
        expect(mineRegion({ x: 2700, z: 9683, level: 0 })).toBe('main');
        expect(mineRegion({ x: 2723, z: 9670, level: 0 })).toBe('south');
        expect(mineRegion({ x: 2723, z: 9717, level: 0 })).toBe('northRoom');
        expect(mineRegion({ x: 2737, z: 9689, level: 0 })).toBe('gold');
        expect(mineRegion({ x: 2696, z: 3282, level: 0 })).toBe('outside');
        expect(mineRegion(null)).toBe('outside');
    });

    test('the perfect-gold zone is the players tile, not the rocks', () => {
        expect(inPerfectGoldZone({ x: 2737, z: 9689, level: 0 })).toBe(true);
        expect(inPerfectGoldZone({ x: 2740, z: 9684, level: 0 })).toBe(true);
        // One tile south of the boundary rock: mining from here yields plain gold.
        expect(inPerfectGoldZone({ x: 2737, z: 9683, level: 0 })).toBe(false);
        expect(inPerfectGoldZone({ x: 2735, z: 9689, level: 0 })).toBe(false);
    });
});

describe('Family Crest decide', () => {
    test('an unloaded journal waits rather than restarting the quest', () => {
        expect(decide(snap({ journal: 'unknown' })).kind).toBe('wait');
    });

    test('a complete journal is done', () => {
        expect(decide(snap({ journal: 'complete' })).kind).toBe('done');
    });

    test('not started → Dimintheis', () => {
        expect(talkTarget(decide(snap()))).toBe('Dimintheis');
    });

    test('started → Caleb', () => {
        expect(talkTarget(decide(snap({ stage: FC_STAGE.SPOKEN_DIMINTHEIS })))).toBe('Caleb');
    });

    test('Caleb waits on the fish and names exactly what is short', () => {
        const step = decide(snap({
            stage: FC_STAGE.SPOKEN_CALEB,
            invIds: [[FC_ID.SWORDFISH, 1], [FC_ID.BASS, 1]]
        }));
        expect(step.kind).toBe('wait');
        expect(step.kind === 'wait' && step.reason).toContain('Tuna');
        expect(step.kind === 'wait' && step.reason).toContain('Salmon');
        expect(step.kind === 'wait' && step.reason).toContain('Shrimps');
        expect(step.kind === 'wait' && step.reason).not.toContain('Swordfish');
    });

    test('Caleb withdraws the fish the bank does hold', () => {
        const step = decide(snap({
            stage: FC_STAGE.SPOKEN_CALEB,
            bankIds: [[FC_ID.TUNA, 3]],
            bank: [['tuna', 3]]
        }));
        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0]?.id).toBe(FC_ID.TUNA);
    });

    test('with all five fish held, Caleb is talked to', () => {
        expect(talkTarget(decide(snap({ stage: FC_STAGE.SPOKEN_CALEB, invIds: ALL_FISH })))).toBe('Caleb');
    });

    test('one piece → back to Caleb for his brother', () => {
        expect(talkTarget(decide(snap({ stage: FC_STAGE.CALEB_PIECE })))).toBe('Caleb');
    });

    test('desert lead → the Al Kharid gem trader', () => {
        expect(talkTarget(decide(snap({ stage: FC_STAGE.CALEB_WHERE })))).toBe('Gem trader');
    });

    test('after the gem trader, Avan is addressed by id rather than by name', () => {
        expect(customName(decide(snap({ stage: FC_STAGE.SPOKEN_GEM_TRADER })))).toContain('Avan');
    });

    test('after Avan → Boot', () => {
        expect(talkTarget(decide(snap({ stage: FC_STAGE.SPOKEN_AVAN })))).toBe('Boot');
    });
});

describe('Family Crest perfect-gold leg', () => {
    const kitted = {
        invIds: [[STEEL_PICK, 1]] as [number, number][],
        inv: [['shark', 10]] as [string, number][],
        wornIds: [RUNE_SCIM]
    };

    test('a scimitar in the pack is wielded before the ladder, not carried down', () => {
        const step = decide(snap({
            stage: FC_STAGE.SPOKEN_BOOT,
            invIds: [[STEEL_PICK, 1], [RUNE_SCIM, 1]],
            inv: [['shark', 10]]
        }));
        expect(step.kind).toBe('equip');
        expect(step.kind === 'equip' && step.item).toBe('Rune scimitar');
    });


    test('a pickaxe is sourced before the ladder, never after it', () => {
        const step = decide(snap({ stage: FC_STAGE.SPOKEN_BOOT, bankIds: [[STEEL_PICK, 1]], bank: [['steel pickaxe', 1]] }));
        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0]?.id).toBe(STEEL_PICK);
    });

    test('kitted out and outside, the bot climbs down', () => {
        expect(customName(decide(snap({ stage: FC_STAGE.SPOKEN_BOOT, ...kitted })))).toContain('climb down');
    });

    test('inside the mine with no ore, it mines', () => {
        expect(customName(decide(snap({ stage: FC_STAGE.SPOKEN_BOOT, ...kitted, tile: MINE_MAIN }))))
            .toContain('mine perfect gold');
    });

    test('inside the mine holding both ores, it climbs back out', () => {
        expect(customName(decide(snap({
            stage: FC_STAGE.SPOKEN_BOOT,
            invIds: [...kitted.invIds, [FC_ID.PERFECT_GOLD_ORE, 2]],
            wornIds: kitted.wornIds,
            tile: MINE_GOLD
        })))).toContain('climb out');
    });

    test('a coin float is taken once so each purchase does not re-bank', () => {
        const step = decide(snap({
            stage: FC_STAGE.SPOKEN_BOOT,
            invIds: [...kitted.invIds, [FC_ID.PERFECT_GOLD_ORE, 2]],
            wornIds: kitted.wornIds,
            bank: [['coins', 2_000_000]]
        }));
        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0]?.name).toBe('Coins');
    });

    test('with ore but no moulds, the moulds come before the furnace trip', () => {
        const step = decide(snap({
            stage: FC_STAGE.SPOKEN_BOOT,
            invIds: [...kitted.invIds, [FC_ID.PERFECT_GOLD_ORE, 2]],
            wornIds: kitted.wornIds
        }));
        expect(step.kind).toBe('buy');
        expect(step.kind === 'buy' && step.item).toBe('Ring mould');
    });

    test('with ore and moulds but no rubies, it tries the gem merchant', () => {
        const step = decide(snap({
            stage: FC_STAGE.SPOKEN_BOOT,
            invIds: [...kitted.invIds, [FC_ID.PERFECT_GOLD_ORE, 2], [FC_ID.RING_MOULD, 1], [FC_ID.NECKLACE_MOULD, 1]],
            wornIds: kitted.wornIds
        }));
        expect(step.kind).toBe('buy');
        expect(step.kind === 'buy' && step.item).toBe('Ruby');
        expect(step.kind === 'buy' && step.shop.npc).toBe('Gem merchant');
    });

    test('fully supplied but still holding ore, it smelts first', () => {
        expect(customName(decide(snap({
            stage: FC_STAGE.SPOKEN_BOOT,
            invIds: [
                ...kitted.invIds,
                [FC_ID.PERFECT_GOLD_ORE, 2], [FC_ID.RING_MOULD, 1], [FC_ID.NECKLACE_MOULD, 1], [FC_ID.RUBY, 2]
            ],
            wornIds: kitted.wornIds
        })))).toContain('smelt');
    });

    test('fully supplied, it crafts', () => {
        expect(customName(decide(snap({
            stage: FC_STAGE.SPOKEN_BOOT,
            invIds: [
                ...kitted.invIds,
                [FC_ID.PERFECT_GOLD_BAR, 2], [FC_ID.RING_MOULD, 1], [FC_ID.NECKLACE_MOULD, 1], [FC_ID.RUBY, 2]
            ],
            wornIds: kitted.wornIds
        })))).toContain('craft');
    });

    test('with both pieces made, Avan gets them', () => {
        expect(customName(decide(snap({
            stage: FC_STAGE.SPOKEN_BOOT,
            invIds: [[FC_ID.PERFECT_RUBY_RING, 1], [FC_ID.PERFECT_RUBY_NECKLACE, 1]]
        })))).toContain('Avan');
    });
});

describe('Family Crest endgame', () => {
    /** What stage 8 now loads before it will walk anywhere. */
    const endgameKit: [number, number][] = [
        [FC_ID.AIR_RUNE, 600], [FC_ID.WATER_RUNE, 200], [FC_ID.EARTH_RUNE, 200],
        [FC_ID.FIRE_RUNE, 250], [FC_ID.DEATH_RUNE, 60],
        [FC_ID.ANTIPOISON_3, 1], [FC_ID.ANTIPOISON_2, 1]
    ];

    test('the endgame kit is loaded before the walk to Johnathon', () => {
        // Varrock East and Aubury both sit on that walk; sourcing each piece
        // where it is first needed cost three separate trips back to Varrock.
        const step = decide(snap({ stage: FC_STAGE.AVAN_PIECE, inv: [['coins', 200_000]] }));
        expect(step.kind).toBe('buy');
        expect(step.kind === 'buy' && step.shop.npc).toBe('Aubury');
    });

    test('two antipoison are carried — one cures him, one is for the spiders', () => {
        const step = decide(snap({
            stage: FC_STAGE.AVAN_PIECE,
            inv: [['coins', 200_000], ['shark', 16]],
            invIds: [[FC_ID.AIR_RUNE, 600], [FC_ID.WATER_RUNE, 200], [FC_ID.EARTH_RUNE, 200],
                [FC_ID.FIRE_RUNE, 250], [FC_ID.DEATH_RUNE, 60]],
            bankIds: [[FC_ID.ANTIPOISON_3, 2]],
            wornIds: [RUNE_SCIM]
        }));
        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0]?.qty).toBe(2);
    });

    test('two pieces and a full pack → Johnathon', () => {
        expect(talkTarget(decide(snap({
            stage: FC_STAGE.AVAN_PIECE,
            inv: [['coins', 200_000], ['shark', 16]],
            invIds: endgameKit,
            wornIds: [RUNE_SCIM]
        })))).toBe('Johnathon');
    });

    test('poisoned Johnathon with no antipoison anywhere → Jiminua', () => {
        const step = decide(snap({ stage: FC_STAGE.SPOKEN_JOHNATHON }));
        expect(step.kind).toBe('buy');
        expect(step.kind === 'buy' && step.shop.npc).toBe('Jiminua');
    });

    test('any dose of antipoison is enough to cure him', () => {
        expect(customName(decide(snap({
            stage: FC_STAGE.SPOKEN_JOHNATHON,
            invIds: [[FC_ID.ANTIPOISON_1, 1]]
        })))).toContain('cure Johnathon');
    });

    test('cured, with no runes, it buys them from Aubury', () => {
        const step = decide(snap({
            stage: FC_STAGE.CURED_JOHNATHON,
            inv: [['coins', 100_000]]
        }));
        expect(step.kind).toBe('buy');
        expect(step.kind === 'buy' && step.shop.npc).toBe('Aubury');
    });

    const stocked: [number, number][] = [
        [FC_ID.AIR_RUNE, 600], [FC_ID.WATER_RUNE, 200], [FC_ID.EARTH_RUNE, 200],
        [FC_ID.FIRE_RUNE, 250], [FC_ID.DEATH_RUNE, 60], [FC_ID.ANTIPOISON_3, 1]
    ];

    test('the teleport kit does not count as a fighting rune stock', () => {
        // The kit carries 30 fire — one cast of Fire Blast is 5, so the old
        // one-cast floor was satisfied and the fight went in unable to finish.
        const step = decide(snap({
            stage: FC_STAGE.CURED_JOHNATHON,
            inv: [['coins', 200_000], ['shark', 12]],
            invIds: [[FC_ID.AIR_RUNE, 150], [FC_ID.FIRE_RUNE, 30], [FC_ID.WATER_RUNE, 30]],
            wornIds: [RUNE_SCIM]
        }));
        expect(step.kind).toBe('buy');
        expect(step.kind === 'buy' && step.item).toBe('Air rune');
    });

    test('a spare antipoison is taken for the spiders on the gate tiles', () => {
        const step = decide(snap({
            stage: FC_STAGE.CURED_JOHNATHON,
            inv: [['shark', 12]],
            invIds: [[FC_ID.AIR_RUNE, 600], [FC_ID.WATER_RUNE, 200], [FC_ID.EARTH_RUNE, 200],
                [FC_ID.FIRE_RUNE, 250], [FC_ID.DEATH_RUNE, 60]],
            bankIds: [[FC_ID.ANTIPOISON_3, 1]],
            wornIds: [RUNE_SCIM]
        }));
        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0]?.id).toBe(FC_ID.ANTIPOISON_3);
    });

    test('the teleport kit is not re-fetched while the demon is still standing', () => {
        // The wilderness deposit banks it on purpose; re-fetching walked the law
        // runes and the ring back into the fight they were banked to avoid.
        const step = decide(snap({
            stage: FC_STAGE.CURED_JOHNATHON,
            inv: [['shark', 12]],
            invIds: stocked,
            bankIds: [[FC_ID.LAW_RUNE, 200], [2552, 1]],
            wornIds: [RUNE_SCIM]
        }));
        expect(step.kind).not.toBe('withdraw');
    });

    test('the coin float is banked before stepping into the wilderness', () => {
        const step = decide(snap({
            stage: FC_STAGE.CURED_JOHNATHON,
            inv: [['coins', 100_000], ['shark', 12]],
            invIds: stocked,
            wornIds: [RUNE_SCIM]
        }));
        expect(step.kind).toBe('deposit');
        expect(step.kind === 'deposit' && step.keep).not.toContain('coins');
        // Law runes stay: the lair is wilderness 3, so the walk home after the
        // last fragment becomes a Varrock teleport instead of a death march.
        expect(step.kind === 'deposit' && step.keep).toContain('law rune');
        // the fragments must survive that deposit
        expect(step.kind === 'deposit' && step.keepIds).toContain(FC_ID.CREST_FROM_CALEB);
    });

    test('inside the lair it fights rather than topping up mid-fight', () => {
        // Eating or drinking would otherwise drop the pack under a threshold and
        // walk the bot back to Varrock in the middle of the fight.
        expect(customName(decide(snap({
            stage: FC_STAGE.CURED_JOHNATHON,
            tile: { x: 3089, z: 9932, level: 0 },
            inv: [['coins', 100_000]]
        })))).toContain('Chronozon');
    });

    test('runes, food, a weapon and no coin → the fight', () => {
        expect(customName(decide(snap({
            stage: FC_STAGE.CURED_JOHNATHON,
            inv: [['shark', 12]],
            invIds: stocked,
            wornIds: [RUNE_SCIM]
        })))).toContain('Chronozon');
    });

    test('three fragments outrank the stage and are combined', () => {
        expect(customName(decide(snap({
            stage: FC_STAGE.CURED_JOHNATHON,
            invIds: [
                [FC_ID.CREST_FROM_CALEB, 1], [FC_ID.CREST_FROM_AVAN, 1], [FC_ID.CREST_FROM_CHRONOZON, 1]
            ]
        })))).toContain('combine');
    });

    test('a fragment lost after Caleb sends the bot back for a replacement', () => {
        expect(talkTarget(decide(snap({
            stage: FC_STAGE.SPOKEN_BOOT,
            dropFragments: true
        })))).toBe('Caleb');
    });

    test('a fragment lost after Avan sends the bot back to him', () => {
        expect(customName(decide(snap({
            stage: FC_STAGE.CURED_JOHNATHON,
            dropFragments: true,
            invIds: [[FC_ID.CREST_FROM_CALEB, 1]]
        })))).toContain('Avan');
    });

    test('at stage 8 exactly it goes to Johnathon rather than asking Avan', () => {
        // `crest_avan_piece` routes to `avan_where` — pure chat, no lost-fragment
        // branch. That only exists from stage 9, so asking here parks forever.
        expect(talkTarget(decide(snap({
            stage: FC_STAGE.AVAN_PIECE,
            dropFragments: true,
            inv: [['coins', 200_000], ['shark', 16]],
            invIds: [[FC_ID.CREST_FROM_CALEB, 1], [FC_ID.AIR_RUNE, 600], [FC_ID.WATER_RUNE, 200],
                [FC_ID.EARTH_RUNE, 200], [FC_ID.FIRE_RUNE, 250], [FC_ID.DEATH_RUNE, 60],
                [FC_ID.ANTIPOISON_3, 1], [FC_ID.ANTIPOISON_2, 1]],
            wornIds: [RUNE_SCIM]
        })))).toBe('Johnathon');
    });

    test('holding only Chronozons piece, the brothers are asked again', () => {
        expect(talkTarget(decide(snap({
            stage: FC_STAGE.CURED_JOHNATHON,
            dropFragments: true,
            invIds: [[FC_ID.CREST_FROM_CHRONOZON, 1]]
        })))).toBe('Caleb');
    });

    test('the restored crest goes back to Dimintheis', () => {
        expect(talkTarget(decide(snap({
            stage: FC_STAGE.CURED_JOHNATHON,
            invIds: [[FC_ID.FAMILY_CREST, 1]]
        })))).toBe('Dimintheis');
    });
});

describe('Family Crest teleport kit', () => {
    const banked: [number, number][] = [[FC_ID.LAW_RUNE, 500], [FC_ID.AIR_RUNE, 500],
        [FC_ID.FIRE_RUNE, 500], [FC_ID.WATER_RUNE, 500]];

    test('nothing is fetched while nav teleports are off', () => {
        // The Global defaults off, and the nav layer reads the same setting —
        // fetching a kit it will never plan a hop with is a wasted bank trip.
        expect(teleportKitTopUp(snap({ stage: FC_STAGE.SPOKEN_DIMINTHEIS, bankIds: banked }))).toBeNull();
    });

    test('the whole kit is fetched, not just the law runes', () => {
        // Every spell hop needs air as well as law; a guard keyed on law alone
        // stopped after one withdraw and left the spells uncastable.
        const withLaws = snap({
            stage: FC_STAGE.SPOKEN_DIMINTHEIS,
            invIds: [[FC_ID.LAW_RUNE, 30]],
            bankIds: banked
        });
        const step = teleportKitPlan(withLaws);
        expect(step?.kind).toBe('withdraw');
        expect(step?.kind === 'withdraw' && step.items[0]?.id).toBe(FC_ID.AIR_RUNE);
    });

    test('spell runes are bought from Aubury when the bank has none', () => {
        // Why: only law has to be banked — Aubury stocks the rest, twenty tiles from the booth this trip already visits.
        const step = teleportKitPlan(snap({
            stage: FC_STAGE.SPOKEN_DIMINTHEIS,
            invIds: [[FC_ID.LAW_RUNE, 30]],
            bankIds: [[FC_ID.LAW_RUNE, 200]]
        }));
        expect(step?.kind).toBe('buy');
        expect(step?.kind === 'buy' && step.shop.npc).toBe('Aubury');
        expect(step?.kind === 'buy' && step.item).toBe('Air rune');
    });

    test('the ring is fetched even once every rune is already carried', () => {
        // Twice now a satisfied-runes check returned before reaching the ring.
        const step = teleportKitPlan(snap({
            stage: FC_STAGE.SPOKEN_DIMINTHEIS,
            invIds: [[FC_ID.LAW_RUNE, 30], [FC_ID.AIR_RUNE, 150],
                [FC_ID.FIRE_RUNE, 30], [FC_ID.WATER_RUNE, 30]],
            bankIds: [[2552, 1]]
        }));
        expect(step?.kind).toBe('withdraw');
        expect(step?.kind === 'withdraw' && step.items[0]?.id).toBe(2552);
    });

    test('a banked ring is fetched even with no law runes anywhere', () => {
        // The ring reaches Al Kharid, which no spell on this book can.
        const step = teleportKitPlan(snap({
            stage: FC_STAGE.SPOKEN_DIMINTHEIS,
            bankIds: [[2560, 1]]
        }));
        expect(step?.kind).toBe('withdraw');
        expect(step?.kind === 'withdraw' && step.items[0]?.id).toBe(2560);
    });

    test('an empty bank walks rather than blocking', () => {
        // Law runes are Magic Guild / Mage Arena stock only, so this is normal.
        expect(teleportKitPlan(snap({ stage: FC_STAGE.SPOKEN_DIMINTHEIS, bankKnown: true }))).toBeNull();
    });
});

describe('Family Crest module wiring', () => {
    test('the record is the one registered in data/quests', () => {
        expect(familycrest.record.id).toBe('crest');
        expect(familycrest.record.name).toBe('Family Crest');
    });

    test('it owns its own inventory — the legs need different loadouts', () => {
        expect(familycrest.ownsInventory).toBe(true);
    });

    test('sustain never eats one of Calebs five fish', () => {
        const caleb = ['swordfish', 'bass', 'tuna', 'salmon', 'shrimps'];
        for (const food of familycrest.sustain?.foods ?? []) {
            expect(caleb).not.toContain(food.toLowerCase());
        }
    });

    test('all four elemental blasts are cast, in the order the demon needs', () => {
        expect([...BLASTS]).toEqual(['Wind blast', 'Water blast', 'Earth blast', 'Fire blast']);
    });

    test('the safespot is the south end, out of the poison spiders roam', () => {
        // Two tiles clear of the demon's body, and eleven-plus from spider
        // spawns that wander ten — the east alcove sits three inside it.
        expect({ x: SAFESPOT.x, z: SAFESPOT.z, level: SAFESPOT.level })
            .toEqual({ x: 3089, z: 9932, level: 0 });
    });
});
