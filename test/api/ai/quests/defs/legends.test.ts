import { itemCounts } from '../../../../lib/questSteps.js';
import { describe, expect, test } from 'bun:test';

import { LQ_ID, LQ_STAGE, LQ_TILE, inJungleBand, inOctagram, jungleSection, legendsArea } from '#/bot/api/ai/quests/defs/legends/areas.js';
import { decide, legends } from '#/bot/api/ai/quests/defs/legends/index.js';
import { legendsPocket } from '#/bot/api/ai/quests/defs/legends/pockets.js';

import { FOOD_FOR_SLOT, KEEP_IDS, LQ_FOODS, PRAYER_POTIONS, SHOP_GP, coinTopUp } from '#/bot/api/ai/quests/defs/legends/supplies.js';
import { QUEST_DEFS } from '#/bot/api/ai/quests/defs/index.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

interface SnapOpts {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    inv?: string[];
    invIds?: number[];
    worn?: string[];
    wornIds?: number[];
    bank?: string[];
    bankIds?: number[];
    bankKnown?: boolean;
    tile?: { x: number; z: number; level: number } | null;
}

function counts(names: string[]): Map<string, number> {
    const out = new Map<string, number>();
    for (const name of names) {
        const key = name.toLowerCase();
        out.set(key, (out.get(key) ?? 0) + (key === 'coins' ? 20_000 : 1));
    }
    return out;
}

/** Karamja's open ground, where every bank and shop leg is allowed to start. */
const KARAMJA = { x: 2850, z: 2960, level: 0 };

/** Everything the module asks a booth for, so the kit branches fall through. */
const FULL_KIT = [
    LQ_ID.MAP_COMPLETE, LQ_ID.BULLROARER,
    LQ_ID.RUNE_AXE, LQ_ID.MACHETE, LQ_ID.LOCKPICK, LQ_ID.UNPOWERED_ORB, LQ_ID.RUNE_PICKAXE,
    LQ_ID.HAMMER, LQ_ID.KNIFE, LQ_ID.ROPE, LQ_ID.CHISEL, LQ_ID.VIAL_WATER,
    LQ_ID.SOUL_RUNE, LQ_ID.MIND_RUNE, LQ_ID.EARTH_RUNE, LQ_ID.LAW_RUNE, LQ_ID.LAW_RUNE,
    LQ_ID.OPAL, LQ_ID.JADE, LQ_ID.RED_TOPAZ, LQ_ID.SAPPHIRE, LQ_ID.EMERALD, LQ_ID.RUBY, LQ_ID.DIAMOND,
    LQ_ID.COSMIC_RUNE, LQ_ID.COSMIC_RUNE, LQ_ID.COSMIC_RUNE,
    ...Array.from({ length: 30 }, () => LQ_ID.WATER_RUNE),
    LQ_ID.GOLD_BAR, LQ_ID.GOLD_BAR, LQ_ID.PAPYRUS, LQ_ID.PAPYRUS, LQ_ID.PAPYRUS, LQ_ID.PAPYRUS, LQ_ID.PAPYRUS, LQ_ID.PAPYRUS,
    LQ_ID.CHARCOAL, LQ_ID.CHARCOAL, LQ_ID.CHARCOAL, LQ_ID.CHARCOAL, LQ_ID.CHARCOAL, LQ_ID.CHARCOAL
];

const WORN_KIT = [LQ_ID.RUNE_SCIMITAR, 1113, 1079, 1163, 1201, 1704];

function snap(o: SnapOpts = {}): QuestSnapshot {
    return {
        journal: o.journal ?? 'inProgress',
        inv: counts(o.inv ?? []),
        invIds: itemCounts(o.invIds ?? []),
        worn: new Set((o.worn ?? []).map(n => n.toLowerCase())),
        wornIds: new Set(o.wornIds ?? WORN_KIT),
        noProgress: 0,
        bankCoins: 0,
        stage: o.stage,
        bank: counts(o.bank ?? []),
        bankIds: itemCounts(o.bankIds ?? []),
        bankKnown: o.bankKnown ?? true,
        tile: (o.tile ?? KARAMJA) as QuestSnapshot['tile'],
        freeSlots: 8
    };
}

/** Kitted out on Karamja: coins, food and every sourceable item already in the pack. */
function kitted(o: SnapOpts = {}): QuestSnapshot {
    return snap({
        ...o,
        inv: [...(o.inv ?? []), ...Array.from({ length: 60_000 }, () => 'Coins').slice(0, 1), ...Array.from({ length: 14 }, () => 'Lobster')],
        invIds: [...(o.invIds ?? []), ...FULL_KIT, ...Array.from({ length: 60_000 }, () => LQ_ID.COINS).slice(0, 1)]
    });
}

const name = (step: QuestStep): string => (step.kind === 'custom' ? `custom:${step.name}` : step.kind);

/** The same pack minus what a death dropped. */
function without(base: QuestSnapshot, shed: number[]): QuestSnapshot {
    const invIds = new Map<number, number>();
    base.invIds?.forEach((qty, id) => {
        if (!shed.includes(id)) {
            invIds.set(id, qty);
        }
    });
    return { ...base, invIds };
}

/** Re-mining the seven gems after a death: the trials kit is intact, the map supplies are long gone. */
function atTheGemRocks(gems: number[]): QuestSnapshot {
    const shed: number[] = [LQ_ID.PAPYRUS, LQ_ID.CHARCOAL, ...GEM_IDS];
    const kit = FULL_KIT.filter(id => !shed.includes(id));
    return snap({
        stage: LQ_STAGE.SUMMONED_NEZI_FIRE,
        invIds: [...kit, ...gems, LQ_ID.LOBSTER, LQ_ID.LOBSTER, LQ_ID.COINS],
        inv: ['Coins', 'Lobster', 'Lobster'],
        tile: { x: 2825, z: 2997, level: 0 }
    });
}

const GEM_IDS = [LQ_ID.OPAL, LQ_ID.JADE, LQ_ID.RED_TOPAZ, LQ_ID.SAPPHIRE, LQ_ID.EMERALD, LQ_ID.RUBY, LQ_ID.DIAMOND];

describe('legendsArea', () => {
    test('the Kharazi Jungle is its own world', () => {
        expect(legendsArea({ x: 2790, z: 2910, level: 0 })).toBe('jungle');
        expect(legendsArea({ x: 2790, z: 2960, level: 0 })).toBe('mainland');
    });

    test('the shaman caves and the Viyeldi caves are separate complexes', () => {
        expect(legendsArea({ x: 2773, z: 9341, level: 0 })).toBe('shamanCaves');
        expect(legendsArea({ x: 2400, z: 4710, level: 0 })).toBe('viyeldiCaves');
    });

    test('a missing tile is unknown rather than mainland', () => {
        expect(legendsArea(null)).toBe('unknown');
    });

    test('the jungle splits into the three thirds the map is drawn in', () => {
        expect(jungleSection({ x: 2790, z: 2910, level: 0 })).toBe('west');
        expect(jungleSection({ x: 2840, z: 2910, level: 0 })).toBe('middle');
        expect(jungleSection({ x: 2900, z: 2910, level: 0 })).toBe('east');
        expect(jungleSection({ x: 2790, z: 2960, level: 0 })).toBeNull();
    });
});

describe('inJungleBand', () => {
    test('covers the three blocked rows and neither open tile', () => {
        expect(inJungleBand({ x: 2816, z: 2936, level: 0 })).toBe(false);
        expect(inJungleBand({ x: 2816, z: 2937, level: 0 })).toBe(true);
        expect(inJungleBand({ x: 2816, z: 2939, level: 0 })).toBe(true);
        expect(inJungleBand({ x: 2816, z: 2940, level: 0 })).toBe(false);
    });
});

describe('inOctagram', () => {
    test('the wall tile is outside and the tile past it is inside', () => {
        expect(inOctagram(LQ_TILE.OCTAGRAM_OUTSIDE)).toBe(false);
        expect(inOctagram(LQ_TILE.OCTAGRAM_INSIDE)).toBe(true);
    });

    test("Ungadulu's own tile is inside", () => {
        expect(inOctagram({ x: 2792, z: 9327, level: 0 })).toBe(true);
    });
});

describe('legendsPocket', () => {
    // Why: every one of these is a crossing the module drives, so a tile that lands in the wrong pocket runs the wrong leg.
    const CASES: readonly [string, number, number, string | null][] = [
        ['the cave landing', 2773, 9341, 'shamanCave'],
        ['inside the flames', 2792, 9328, 'octagram'],
        ['past the bookcase crevice', 2800, 9340, 'crevice'],
        ['north of the outer gate', 2809, 9333, 'crevice'],
        ['south of the outer gate', 2809, 9331, 'outerGate'],
        ['between the first two boulders', 2809, 9325, 'boulderOne'],
        ['between the last two boulders', 2809, 9321, 'boulderTwo'],
        ['north of the inner gate', 2809, 9315, 'innerGate'],
        ['south of the inner gate', 2809, 9313, 'trials'],
        ['south of the jagged wall', 2790, 9295, 'trials'],
        ['north of the jagged wall', 2789, 9296, 'wallRoom'],
        ['the gem room', 2774, 9301, 'gemRoom'],
        ['the winch room', 2760, 9328, 'winchRoom'],
        ['the rope landing', 2377, 4712, 'viyeldiLedge'],
        ['the Viyeldi cave floor', 2400, 4710, 'viyeldiMain'],
        ['past the barrier', 2387, 4689, 'viyeldiSource'],
        ['open jungle', 2790, 2910, null]
    ];
    for (const [label, x, z, want] of CASES) {
        test(`${label} is ${want ?? 'open ground'}`, () => {
            expect(legendsPocket({ x, z, level: 0 })).toBe(want as never);
        });
    }
});

// Why: both counters are a sea crossing from everything the quest then does, and sourcing per leg alternated between them and the bank across the length of stage 8, Ardougne bank, Jiminua's on Karamja, then a gold rock back on the mainland, three regions in three consecutive steps.
// Why: `estGp` is what the buy step tops the pack up to before it opens a counter, so a padded estimate is money carried through three demon fights rather than headroom.
describe('what the counters cost', () => {
    test('the guild estimate is headroom over the list, not a round number', () => {
        // two soul at 1250, four law at 40, two mind at 3, two earth at 4, 150 water at 4, about 3.8k with depletion.
        expect(SHOP_GP.MAGIC_GUILD).toBeLessThan(20_000);
        expect(SHOP_GP.MAGIC_GUILD).toBeGreaterThan(5_000);
    });

    test('the coin float is restored from a floor, not from half of itself', () => {
        const bank = ['Coins'];
        const low = snap({ stage: LQ_STAGE.STARTED, inv: [], invIds: [], bank, bankIds: [LQ_ID.COINS] });
        expect(coinTopUp(low)?.kind).toBe('withdraw');
        const floored = snap({ stage: LQ_STAGE.STARTED, inv: ['Coins'], invIds: [LQ_ID.COINS], bank, bankIds: [LQ_ID.COINS] });
        expect(coinTopUp(floored)).toBeNull();
    });
});

describe('provisioning before the quest starts', () => {
    // Why: the coin and food floats run ahead of the stage switch, so a fixture under either of them never reaches the provisioning branch at all.
    const FLOAT = { inv: ['Coins', ...Array.from({ length: 4 }, () => 'Lobster')], bank: ['Coins'] };
    const bare = (o: SnapOpts = {}): QuestSnapshot =>
        snap({
            stage: LQ_STAGE.NOT_STARTED,
            journal: 'notStarted',
            ...FLOAT,
            invIds: [LQ_ID.COINS, ...Array.from({ length: 4 }, () => LQ_ID.LOBSTER)],
            bankIds: [LQ_ID.COINS],
            ...o
        });

    test('the first errand is the Magic Guild counter, not Radimus', () => {
        const step = decide(bare());
        expect(step.kind).toBe('buy');
        expect(step.kind === 'buy' && step.shop.npc).toBe('Magic Store owner');
    });

    test('the guild list is banked before the walk to Jiminua', () => {
        const bought = bare({
            invIds: [
                LQ_ID.COINS, ...Array.from({ length: 4 }, () => LQ_ID.LOBSTER),
                LQ_ID.SOUL_RUNE, LQ_ID.MIND_RUNE, LQ_ID.EARTH_RUNE, LQ_ID.LAW_RUNE, LQ_ID.LAW_RUNE,
                ...Array.from({ length: 30 }, () => LQ_ID.WATER_RUNE)
            ]
        });
        const step = decide(bought);
        expect(step.kind).toBe('deposit');
        expect(step.kind === 'deposit' && step.bank?.x).toBe(2612);
    });

    test('a stocked bank walks straight to Radimus', () => {
        const stocked = bare({
            bankIds: [
                LQ_ID.COINS, LQ_ID.SOUL_RUNE, LQ_ID.MIND_RUNE, LQ_ID.EARTH_RUNE, LQ_ID.LAW_RUNE, LQ_ID.LAW_RUNE,
                ...Array.from({ length: 30 }, () => LQ_ID.WATER_RUNE),
                LQ_ID.MACHETE, ...Array.from({ length: 8 }, () => LQ_ID.PAPYRUS), ...Array.from({ length: 8 }, () => LQ_ID.CHARCOAL),
                LQ_ID.KNIFE, LQ_ID.ROPE, LQ_ID.HAMMER, LQ_ID.CHISEL, LQ_ID.VIAL_WATER
            ]
        });
        expect(name(decide(stocked))).toBe('custom:ask Radimus Erkle for the quest');
    });

    // Why: Jiminua's is a shared counter with `allstock=no`, and a shopping list that parks on one empty shelf blocks a run the per-leg sourcing could still finish.
    test('a counter that will not sell falls through to the quest rather than parking', () => {
        expect(name(decide({ ...bare(), noProgress: 3 }))).toBe('custom:ask Radimus Erkle for the quest');
    });

    // Why: the Magic Guild stocks no cosmic rune at all, the only counter in the game that sells one is the Mage Arena's, which is deep Wilderness and behind a setting.
    test('cosmic runes are never asked of a counter', () => {
        const asked: string[] = [];
        let cur = bare();
        for (let i = 0; i < 20; i++) {
            const step = decide(cur);
            if (step.kind !== 'buy') break;
            asked.push(step.item);
            const ids = new Map(cur.invIds);
            const id = BUY_ID[step.item];
            if (id === undefined) break;
            ids.set(id, (ids.get(id) ?? 0) + step.qty);
            cur = { ...cur, invIds: ids };
        }
        expect(asked).not.toContain('Cosmic rune');
        expect(asked.length).toBeGreaterThan(0);
    });
});

const BUY_ID: Record<string, number> = {
    'Soul rune': LQ_ID.SOUL_RUNE, 'Mind rune': LQ_ID.MIND_RUNE, 'Earth rune': LQ_ID.EARTH_RUNE,
    'Law rune': LQ_ID.LAW_RUNE, 'Water rune': LQ_ID.WATER_RUNE, Machete: LQ_ID.MACHETE,
    Papyrus: LQ_ID.PAPYRUS, Charcoal: LQ_ID.CHARCOAL, Knife: LQ_ID.KNIFE, Rope: LQ_ID.ROPE,
    Hammer: LQ_ID.HAMMER, Chisel: LQ_ID.CHISEL, 'Vial of water': LQ_ID.VIAL_WATER
};

describe('Legends Quest decide', () => {
    test('a complete journal is done', () => {
        expect(decide(snap({ journal: 'complete' })).kind).toBe('done');
    });

    test('an unloaded journal waits rather than restarting the quest', () => {
        expect(decide(snap({ journal: 'unknown' })).kind).toBe('wait');
    });

    test('an unreadable stage waits', () => {
        expect(decide(snap({ stage: undefined })).kind).toBe('wait');
    });

    test('a complete quest still climbs out of the caves before it stops', () => {
        const step = decide(snap({ journal: 'complete', tile: { x: 2774, z: 9301, level: 0 } }));
        expect(name(step)).toBe('custom:climb back out of the caves');
    });

    // Why: the shopping now runs ahead of Radimus, so an empty bank shops first, the walk to him is what happens once both counters have been emptied into it.
    test('not started shops before it asks Radimus for the quest', () => {
        const step = decide(snap({ journal: 'notStarted', stage: LQ_STAGE.NOT_STARTED }));
        expect(step.kind).toBe('buy');
    });

    // Why: `quest_legends.rs2` counts the bank as well as the pack, "I hear that you have enough machetes in your bank to start your own store" and it hands over nothing, so the cupboard step failed for ever against a banked one.
    test('a banked machete is withdrawn rather than asked of the cupboard', () => {
        const step = decide(snap({ stage: LQ_STAGE.STARTED, bankIds: [LQ_ID.MACHETE], bank: ['Machete'] }));
        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0]?.name).toBe('Machete');
    });

    test('started with no machete takes one from the cupboard', () => {
        const step = decide(snap({ stage: LQ_STAGE.STARTED }));
        expect(name(step)).toBe("custom:take the machete from Radimus' cupboard");
    });

    // Why: the kit fixture carries the finished copy, which is the one thing that means the mapping is over, so a snapshot about to map holds the blank notes instead.
    test('started with the kit and blank notes maps the jungle', () => {
        const blank = kitted({ stage: LQ_STAGE.STARTED });
        const invIds = new Map(blank.invIds);
        invIds.delete(LQ_ID.MAP_COMPLETE);
        invIds.set(LQ_ID.MAP, 1);
        expect(name(decide({ ...blank, invIds }))).toBe('custom:map all three thirds of the Kharazi Jungle');
    });

    // Why: `radimus_notes.rs2` swaps the notes for the copy and only then advances the stage, and it clears the three section bits as it goes, so the copy in the pack with the stage still at one is a state the loop can reach, and `mapJungle` answers true in no time at all from there, which the engine hands straight back for ever.
    test('the finished copy ends the mapping whatever the stage says', () => {
        const done = kitted({ stage: LQ_STAGE.STARTED });
        expect(name(decide(done))).not.toBe('custom:map all three thirds of the Kharazi Jungle');
    });

    test('a mapped jungle trades the copy for the bull roarer', () => {
        const mapped = snap({
            stage: LQ_STAGE.MAPPED_JUNGLE,
            invIds: [LQ_ID.MAP_COMPLETE, LQ_ID.MACHETE, LQ_ID.RUNE_AXE, LQ_ID.COINS],
            inv: [...Array.from({ length: 14 }, () => 'Lobster'), 'Coins']
        });
        expect(name(decide(mapped))).toBe('custom:trade a copy of the map for the bull roarer');
    });

    // Why: a death drops the roarer and the map together, at a stage where the trade branch is long behind the run.
    test('a roarer lost after the trade is replaced wherever the run has got to', () => {
        const bare = without(kitted({ stage: LQ_STAGE.POOL_DRIED }), [LQ_ID.BULLROARER]);
        expect(name(decide(bare))).toBe('custom:trade a copy of the map for the bull roarer');
    });

    // Why: the forester wants a map to copy, and Radimus only offers a replacement while neither map is held.
    test('a roarer and a map both lost buy the map back first', () => {
        const bare = without(kitted({ stage: LQ_STAGE.POOL_DRIED }), [LQ_ID.BULLROARER, LQ_ID.MAP_COMPLETE, LQ_ID.MAP]);
        expect(name(decide(bare))).toBe('custom:buy a replacement map from Radimus');
    });

    test('with the roarer in hand the next step is Gujuo', () => {
        const step = decide(kitted({ stage: LQ_STAGE.GOT_BULLROARER, invIds: [LQ_ID.BULLROARER] }));
        expect(name(step)).toBe('custom:swing the bull roarer and befriend Gujuo');
    });

    test('the rescue stage goes to the shaman cave', () => {
        const step = decide(kitted({ stage: LQ_STAGE.ACCEPTED_RESCUE, invIds: [LQ_ID.BULLROARER] }));
        expect(name(step)).toBe('custom:find Ungadulu and talk through the flames');
    });

    test('after Ungadulu the quest asks Gujuo about the water', () => {
        const step = decide(kitted({ stage: LQ_STAGE.SPOKE_UNGADULU, invIds: [LQ_ID.BULLROARER] }));
        expect(name(step)).toBe('custom:ask Gujuo where the sacred water is');
    });

    test('with the sketch and two bars the bowl is forged', () => {
        const step = decide(kitted({ stage: LQ_STAGE.ASKED_GUJUO_WATER, invIds: [LQ_ID.GOLD_BOWL_SKETCH] }));
        expect(name(step)).toBe('custom:hammer two gold bars into a golden bowl');
    });

    test('an unblessed bowl goes to Gujuo', () => {
        const step = decide(kitted({ stage: LQ_STAGE.ASKED_GUJUO_WATER, invIds: [LQ_ID.GOLD_BOWL] }));
        expect(name(step)).toBe('custom:have Gujuo bless the golden bowl');
    });

    test('a blessed bowl and no reed cuts one', () => {
        const step = decide(kitted({ stage: LQ_STAGE.ASKED_GUJUO_WATER, invIds: [LQ_ID.GOLD_BOWL_BLESSED] }));
        expect(name(step)).toBe('custom:cut a hollow reed at the sacred pool');
    });

    test('a reed and a blessed bowl fill it at the pool', () => {
        const step = decide(kitted({ stage: LQ_STAGE.ASKED_GUJUO_WATER, invIds: [LQ_ID.GOLD_BOWL_BLESSED, LQ_ID.HOLLOW_REED] }));
        expect(name(step)).toBe('custom:syphon the sacred pool into the blessed bowl');
    });

    test('a full bowl and no book goes down the trials', () => {
        const step = decide(kitted({ stage: LQ_STAGE.FILLED_BOWL, invIds: [LQ_ID.GOLD_BOWL_BLESSED_PURE] }));
        expect(name(step)).toBe('custom:fetch the Book of Binding from the gem room');
    });

    test('book plus water opens it on Ungadulu', () => {
        const step = decide(kitted({
            stage: LQ_STAGE.FILLED_BOWL,
            invIds: [LQ_ID.GOLD_BOWL_BLESSED_PURE, LQ_ID.BOOK_OF_BINDING, PRAYER_POTIONS[0]!.id]
        }));
        expect(name(step)).toBe('custom:open the Book of Binding on Ungadulu');
    });

    test('the freed shaman is asked for seeds', () => {
        const step = decide(kitted({ stage: LQ_STAGE.DEFEATED_NEZI_FIRE }));
        expect(name(step)).toBe('custom:ask Ungadulu for the Yommi tree seeds');
    });

    test('raw seeds and a full bowl germinate', () => {
        const step = decide(kitted({
            stage: LQ_STAGE.DEFEATED_NEZI_FIRE,
            invIds: [LQ_ID.YOMMI_SEEDS, LQ_ID.GOLD_BOWL_BLESSED_PURE]
        }));
        expect(name(step)).toBe('custom:germinate the seeds in the bowl of sacred water');
    });

    test('germinated seeds go looking for the fouled pool', () => {
        const step = decide(kitted({ stage: LQ_STAGE.GERMINATED_SEEDS, invIds: [LQ_ID.YOMMI_SEEDS_GERM] }));
        expect(name(step)).toBe('custom:find the sacred pool fouled');
    });

    test('a dried pool asks Gujuo for the potion recipe', () => {
        const step = decide(kitted({ stage: LQ_STAGE.POOL_DRIED }));
        expect(name(step)).toBe('custom:ask Gujuo for the bravery potion recipe');
    });

    test('the potion stage picks the first herb it is missing', () => {
        const step = decide(kitted({ stage: LQ_STAGE.TALK_GUJUO_POOL }));
        expect(name(step)).toBe('custom:pick the Snake weed');
    });

    test('an unidentified herb is identified before the next one is picked', () => {
        const step = decide(kitted({ stage: LQ_STAGE.TALK_GUJUO_POOL, invIds: [LQ_ID.UNID_SNAKE_WEED] }));
        expect(name(step)).toBe('custom:identify the Snake weed');
    });

    test('both herbs and a vial mix the snakeweed first', () => {
        const step = decide(kitted({
            stage: LQ_STAGE.TALK_GUJUO_POOL,
            invIds: [LQ_ID.SNAKE_WEED, LQ_ID.ARDRIGAL]
        }));
        expect(step.kind).toBe('useOn');
    });

    test('a mixture and ardrigal finish the potion', () => {
        const step = decide(kitted({
            stage: LQ_STAGE.TALK_GUJUO_POOL,
            invIds: [LQ_ID.SNAKEWEED_MIXTURE, LQ_ID.ARDRIGAL]
        }));
        expect(step.kind).toBe('useOn');
        expect(step.kind === 'useOn' && step.product).toBe('Bravery potion');
    });

    test('the potion in the pack climbs down the winch', () => {
        const step = decide(kitted({ stage: LQ_STAGE.TALK_GUJUO_POOL, invIds: [LQ_ID.BRAVERY_POTION] }));
        expect(name(step)).toBe('custom:climb down the winch into the Viyeldi caves');
    });

    test('the lower dungeon fights the three guardians', () => {
        const step = decide(kitted({ stage: LQ_STAGE.ENTER_LOWER_DUNGEON, tile: { x: 2400, z: 4710, level: 0 } }));
        expect(name(step)).toBe('custom:take the dragon heart off the three guardians');
    });

    test('a fused heart is charged on the dragon eye', () => {
        const step = decide(kitted({
            stage: LQ_STAGE.CRYSTAL_SMELTED,
            invIds: [LQ_ID.HEART_CRYSTAL],
            tile: { x: 2400, z: 4710, level: 0 }
        }));
        expect(name(step)).toBe("custom:charge the heart on the dragon's eye");
    });

    test('a glowing heart goes into the recess', () => {
        const step = decide(kitted({
            stage: LQ_STAGE.CRYSTAL_SMELTED,
            invIds: [LQ_ID.HEART_CRYSTAL_GLOW],
            tile: { x: 2400, z: 4710, level: 0 }
        }));
        expect(name(step)).toBe('custom:slot the glowing heart into the recess');
    });

    test('the black dagger goes up to Ungadulu rather than into Viyeldi', () => {
        const step = decide(kitted({
            stage: LQ_STAGE.RECEIVED_DAGGER,
            invIds: [LQ_ID.DEATH_DAGGER],
            tile: { x: 2387, z: 4689, level: 0 }
        }));
        expect(name(step)).toBe('custom:take the black dagger to Ungadulu');
    });

    test('the Holy Force is read at the spirit', () => {
        const step = decide(kitted({
            stage: LQ_STAGE.RECEIVED_DAGGER,
            invIds: [LQ_ID.HOLY_FORCE],
            tile: { x: 2387, z: 4689, level: 0 }
        }));
        expect(name(step)).toBe('custom:read the Holy Force at the spirit and kill it');
    });

    test('the source is bottled once the demon is down', () => {
        const step = decide(kitted({
            stage: LQ_STAGE.DEFEATED_NEZI_WATER,
            invIds: [LQ_ID.GOLD_BOWL_BLESSED],
            tile: { x: 2387, z: 4689, level: 0 }
        }));
        expect(name(step)).toBe('custom:shift the boulder and fill the bowl at the source');
    });

    test('sacred water and germinated seeds grow the tree', () => {
        const step = decide(kitted({
            stage: LQ_STAGE.SACRED_WATER,
            invIds: [LQ_ID.GOLD_BOWL_BLESSED_PURE, LQ_ID.YOMMI_SEEDS_GERM]
        }));
        expect(name(step)).toBe('custom:grow a Yommi tree and carve a totem pole');
    });

    test('a carved pole is taken to an evil totem', () => {
        const step = decide(kitted({ stage: LQ_STAGE.COLLECTED_TOTEM, invIds: [PRAYER_POTIONS[0]!.id, LQ_ID.TOTEM_POLE] }));
        expect(name(step)).toBe('custom:replace the evil totem and kill what comes out');
    });

    test('with the pole gone the gift comes from Gujuo', () => {
        const step = decide(kitted({ stage: LQ_STAGE.DEFEATED_NEZI_FINAL }));
        expect(name(step)).toBe('custom:collect the gilded totem from Gujuo');
    });

    test('the gilded totem goes back to Radimus', () => {
        const step = decide(kitted({ stage: LQ_STAGE.GOT_GILDED_TOTEM, invIds: [LQ_ID.GILDED_TOTEM] }));
        expect(name(step)).toBe('custom:take the gilded totem to Radimus');
    });

    test('the last stages take the four training sessions', () => {
        for (const stage of [LQ_STAGE.RETURNED_TO_RADIMUS, LQ_STAGE.TRAINING_1, LQ_STAGE.TRAINING_2, LQ_STAGE.TRAINING_3, LQ_STAGE.TRAINING_4]) {
            expect(name(decide(kitted({ stage })))).toBe("custom:take Radimus' four training sessions");
        }
    });

    // Why: `jungle_tree` boils a filled bowl dry on every chop, so the last errand off the island runs before the pool.
    test('the trials kit is fetched before the bowl is filled', () => {
        const jungle = { x: 2820, z: 2915, level: 0 };
        const bare = snap({ stage: LQ_STAGE.FILLED_BOWL, invIds: [LQ_ID.GOLD_BOWL_BLESSED], tile: jungle });
        expect(name(decide(bare))).toBe('custom:cut back out of the Kharazi Jungle');
        const ready = kitted({ stage: LQ_STAGE.FILLED_BOWL, invIds: [LQ_ID.GOLD_BOWL_BLESSED, LQ_ID.BOOK_OF_BINDING, PRAYER_POTIONS[0]!.id], tile: jungle });
        expect(name(decide(ready))).toBe('custom:cut a hollow reed at the sacred pool');
    });

    // Why: `potsFor` answers zero the moment the bowl is blessed, which is stage 8, and the spent list is a DROP, so a live run threw the flask on the floor at a booth with three demon fights still ahead.
    test('a prayer flask is not spent while a demon is still alive', () => {
        const midQuest = kitted({
            stage: LQ_STAGE.ASKED_GUJUO_WATER,
            invIds: [LQ_ID.GOLD_BOWL_BLESSED, PRAYER_POTIONS[0]!.id]
        });
        const step = decide({ ...midQuest, freeSlots: 1 });
        const dropped = step.kind === 'custom' && step.name.includes('finished with');
        expect(dropped && JSON.stringify(step)).not.toContain(String(PRAYER_POTIONS[0]!.id));
    });

    // Why: once the last demon is dead the flask is a slot and nothing else.
    test('a prayer flask is spent once the last demon is dead', () => {
        const done = kitted({
            stage: LQ_STAGE.DEFEATED_NEZI_FINAL,
            invIds: [PRAYER_POTIONS[0]!.id, LQ_ID.SWAMP_ROCK]
        });
        const step = decide({ ...done, freeSlots: 1 });
        expect(name(step)).toBe('custom:drop what the quest has finished with');
    });

    // Why: `stageBowl` fetches the fight kit while the bowl is empty, so a run arriving here with it already filled never went through that, and the octagram is in the caves, where `choose` never reaches its upkeep.
    test('a filled bowl and no flask goes for the flask before the book', () => {
        const dry = kitted({
            stage: LQ_STAGE.FILLED_BOWL,
            invIds: [LQ_ID.GOLD_BOWL_BLESSED_PURE, LQ_ID.BOOK_OF_BINDING],
            bankIds: [PRAYER_POTIONS[0]!.id, PRAYER_POTIONS[0]!.id, PRAYER_POTIONS[0]!.id],
            bank: ['Prayer potion(4)', 'Coins']
        });
        expect(name(decide(dry))).not.toBe('custom:open the Book of Binding on Ungadulu');
    });

    // Why: `stat_sub(prayer, 0, 90)` runs as the book opens, and `potionTopUp` answers null when the bank is empty, which walked a filled bowl and an empty prayer book into the demon and said nothing.
    test('no flask in the pack or the bank parks before the book is opened', () => {
        const jungle = { x: 2820, z: 2915, level: 0 };
        const dry = kitted({ stage: LQ_STAGE.FILLED_BOWL, invIds: [LQ_ID.GOLD_BOWL_BLESSED, LQ_ID.BOOK_OF_BINDING], tile: jungle });
        const step = decide(dry);
        expect(step.kind).toBe('wait');
        expect(step.kind === 'wait' && step.reason).toContain('prayer potion');
    });

    test('a filled bowl on the mainland is never sent back to a booth', () => {
        const step = decide(kitted({ stage: LQ_STAGE.FILLED_BOWL, invIds: [LQ_ID.GOLD_BOWL_BLESSED_PURE] }));
        expect(name(step)).toBe('custom:fetch the Book of Binding from the gem room');
    });

    // Why: three aggressive guardians wait at the bottom of the winch and the trials float of five lobsters is what died to them.
    test('the winch stages take the fight float, not the trials one', () => {
        const lean = snap({
            stage: LQ_STAGE.ENTER_LOWER_DUNGEON,
            invIds: [LQ_ID.RUNE_AXE],
            bank: Array.from({ length: 30 }, () => 'Lobster')
        });
        const step = decide({ ...lean, freeSlots: 12 });
        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0]?.qty).toBe(9);
    });

    // Why: a death drops the machete and the axe, and every leg past the map has to cross the band to get anywhere.
    test('a lost machete is replaced like food', () => {
        const lean = snap({
            stage: LQ_STAGE.DEFEATED_NEZI_FIRE,
            invIds: [LQ_ID.RUNE_AXE],
            inv: [...Array.from({ length: 14 }, () => 'Lobster')],
            bankIds: [LQ_ID.MACHETE]
        });
        const step = decide(lean);
        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0]?.name).toBe('Machete');
    });

    // Why: the octagram demon is level 187 with 150 hitpoints and the trials float of five lobsters is what died to him.
    test('the book in the pack raises the float to the fight numbers', () => {
        const lean = snap({
            stage: LQ_STAGE.FILLED_BOWL,
            invIds: [LQ_ID.GOLD_BOWL_BLESSED, LQ_ID.BOOK_OF_BINDING],
            bank: Array.from({ length: 30 }, () => 'Lobster')
        });
        const step = decide({ ...lean, freeSlots: 12 });
        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0]?.qty).toBe(9);
        // Why: the ask is what the pack can take rather than what the leg wanted, after a death the kit comes back at once and nine lobsters have nowhere to go.
        const tight = decide({ ...lean, freeSlots: 3 });
        expect(tight.kind === 'withdraw' && tight.items[0]?.qty).toBe(3);
    });

    // Why: `stat_sub(prayer, 0, 90)` runs as Nezikchened is summoned, so the fight opens on a tenth of the bar and Protect from Melee is only armour if there is a dose to put it back. A pack topped up on lobsters first has no slot to put one in.
    test('a banked prayer flask is fetched before the fight food', () => {
        const lean = snap({
            stage: LQ_STAGE.FILLED_BOWL,
            invIds: [LQ_ID.GOLD_BOWL_BLESSED, LQ_ID.BOOK_OF_BINDING],
            bankIds: [PRAYER_POTIONS[0]!.id, PRAYER_POTIONS[0]!.id, PRAYER_POTIONS[0]!.id],
            bank: Array.from({ length: 30 }, () => 'Lobster')
        });
        const step = decide({ ...lean, freeSlots: 12 });
        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0]?.name).toBe(PRAYER_POTIONS[0]!.name);
    });

    // Why: replacing the totem spawns Nezikchened on the spot, and the totems stand in the jungle where the upkeep branch never runs, so the kit is asked for at the step or the demon gets what the fight before it left.
    test('the last demon is kitted for before the totem is replaced', () => {
        const bare = snap({
            stage: LQ_STAGE.COLLECTED_TOTEM,
            invIds: [LQ_ID.TOTEM_POLE, LQ_ID.COINS],
            inv: ['Coins'],
            bankIds: [LQ_ID.COINS, PRAYER_POTIONS[0]!.id, ...Array.from({ length: 20 }, () => LQ_ID.SHARK)],
            bank: ['Coins', 'Prayer potion(4)', 'Shark']
        });
        expect(name(decide(bare))).not.toBe('custom:replace the evil totem and kill what comes out');
    });

    // Why: nothing after the last demon is a fight, so a flask fetched on the way to hand the totem in is a bank trip for something the quest will never drink.
    test('the gilded totem is walked to Radimus, not taken shopping', () => {
        const done = kitted({
            stage: LQ_STAGE.GOT_GILDED_TOTEM,
            invIds: [LQ_ID.GILDED_TOTEM],
            bankIds: [PRAYER_POTIONS[0]!.id],
            bank: ['Prayer potion(4)', 'Coins']
        });
        expect(name(decide(done))).toBe('custom:take the gilded totem to Radimus');
    });

    // Why: the outer gate shuts behind whoever picked it and the boulders drop back down, so a second descent is paid for in full.
    test('a re-descent fetches the lockpick and pickaxe again', () => {
        const kit = [LQ_ID.RUNE_AXE, LQ_ID.MACHETE, LQ_ID.BULLROARER, LQ_ID.YOMMI_SEEDS_GERM, LQ_ID.UNPOWERED_ORB, LQ_ID.COSMIC_RUNE, LQ_ID.COSMIC_RUNE, LQ_ID.COSMIC_RUNE];
        const lean = snap({
            stage: LQ_STAGE.SACRED_WATER,
            invIds: [...kit, ...Array.from({ length: 30 }, () => LQ_ID.WATER_RUNE)],
            inv: [...Array.from({ length: 14 }, () => 'Lobster')],
            bankIds: [LQ_ID.LOCKPICK, LQ_ID.RUNE_PICKAXE]
        });
        const step = decide(lean);
        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0]?.name).toBe('Lockpick');
    });

    // Why: the Holy Force trade happens inside the octagram, and the descent it is followed by has not been paid for yet.
    test('a leg that starts beside Ungadulu still fetches the descent kit', () => {
        const octagram = { x: 2792, z: 9327, level: 0 };
        const lean = snap({
            stage: LQ_STAGE.DEFEATED_NEZI_WATER,
            invIds: [LQ_ID.RUNE_AXE, LQ_ID.MACHETE, LQ_ID.GOLD_BOWL_BLESSED],
            inv: [...Array.from({ length: 14 }, () => 'Lobster')],
            bankIds: [LQ_ID.LOCKPICK, LQ_ID.UNPOWERED_ORB],
            tile: octagram
        });
        expect(name(decide(lean))).toBe('custom:climb back out of the caves');
    });

    // Why: the magic gate eats the orb as it lets you through, so the same check made from the winch room turns a finished descent back round.
    test('a spent orb below the gate does not send the run back up for another', () => {
        const winchRoom = { x: 2763, z: 9320, level: 0 };
        const lean = snap({
            stage: LQ_STAGE.SACRED_WATER,
            invIds: [LQ_ID.RUNE_AXE, LQ_ID.MACHETE, LQ_ID.YOMMI_SEEDS_GERM, LQ_ID.LOCKPICK, LQ_ID.RUNE_PICKAXE],
            inv: [...Array.from({ length: 14 }, () => 'Lobster')],
            bankIds: [LQ_ID.UNPOWERED_ORB],
            tile: winchRoom
        });
        expect(name(decide(lean))).toBe('custom:climb back down to the Viyeldi caves');
    });

    // Why: a full pack is the normal state of this quest, so only a pending withdraw is a reason to walk to a booth.
    test('a full pack alone does not send the run to a booth', () => {
        const pool = { x: 2836, z: 2917, level: 0 };
        const full = kitted({
            stage: LQ_STAGE.FILLED_BOWL,
            invIds: [LQ_ID.GOLD_BOWL_BLESSED, LQ_ID.BOOK_OF_BINDING, 2434, 2434],
            tile: pool
        });
        const step = decide({ ...full, freeSlots: 0 });
        expect(step.kind).toBe('custom');
        expect(step.kind).not.toBe('deposit');
    });

    // Why: a sketch, a spell and a set of seeds are all handed over into a pack that has to have room for them.
    test('a full pack drops the spent supplies rather than banking them', () => {
        const cave = { x: 2791, z: 9334, level: 0 };
        const full = kitted({
            stage: LQ_STAGE.RECEIVED_DAGGER,
            invIds: [LQ_ID.DEATH_DAGGER, 594, 594, 594],
            tile: cave
        });
        expect(name(decide({ ...full, freeSlots: 0 }))).toBe('custom:drop what the quest has finished with');
    });

    // Why: the sketch and the flask are both spent the moment the bowl is blessed, and the trials kit is one rune stack short of the pack without their slots.
    test('the sketch and the used flask are spent once the bowl is blessed', () => {
        const spent = kitted({
            stage: LQ_STAGE.ASKED_GUJUO_WATER,
            invIds: [LQ_ID.GOLD_BOWL_BLESSED, LQ_ID.GOLD_BOWL_SKETCH, 2434]
        });
        expect(name(decide({ ...spent, freeSlots: 0 }))).toBe('custom:drop what the quest has finished with');
    });

    // Why: the flask is the blessing's until the blessing happens, and dropping it there is a bank trip and a re-buy for nothing.
    test('the flask is not spent while the bowl is still plain', () => {
        const plain = snap({
            stage: LQ_STAGE.ASKED_GUJUO_WATER,
            invIds: [LQ_ID.GOLD_BOWL, 2434, LQ_ID.MACHETE, LQ_ID.RUNE_AXE, LQ_ID.COINS],
            inv: [...Array.from({ length: 14 }, () => 'Lobster'), 'Coins']
        });
        expect(name(decide({ ...plain, freeSlots: 0 }))).not.toBe('custom:drop what the quest has finished with');
    });

    // Why: a shop counter is not a booth, so a full pack at one has nothing to deposit and the buy failed a hundred and thirty times in a row.
    test('a full pack at a counter with nothing bankable still makes room', () => {
        const full = snap({
            stage: LQ_STAGE.ASKED_GUJUO_WATER,
            invIds: [LQ_ID.GOLD_BOWL_BLESSED, LQ_ID.MACHETE, LQ_ID.RUNE_AXE, LQ_ID.COINS, LQ_ID.LOBSTER],
            inv: [...Array.from({ length: 14 }, () => 'Lobster'), 'Coins'],
            bankIds: [LQ_ID.LOCKPICK],
            bank: ['Coins']
        });
        expect(decide({ ...full, freeSlots: 0 }).kind).toBe('custom');
    });

    // Why: a withdraw decided with no room fails for ever, and the trials and the band both hand back things the keep list does not want.
    // Why: the reserve rather than the last slot is the trigger, a step already opening the bank pays nothing to empty the pack there, and every hand-over this quest makes wants a slot a pack shed only when full does not have.
    test('a pack down to its reserve banks the junk at the booth the withdraw was going to', () => {
        const full = snap({
            stage: LQ_STAGE.SACRED_WATER,
            invIds: [LQ_ID.RUNE_AXE, LQ_ID.MACHETE, LQ_ID.YOMMI_SEEDS_GERM, 1511, 1511],
            inv: [...Array.from({ length: 14 }, () => 'Lobster')],
            bankIds: [LQ_ID.LOCKPICK, LQ_ID.UNPOWERED_ORB],
            bank: ['Coins']
        });
        expect(decide({ ...full, freeSlots: 0 }).kind).toBe('deposit');
        expect(decide({ ...full, freeSlots: 3 }).kind).toBe('deposit');
        expect(decide({ ...full, freeSlots: 20 }).kind).toBe('withdraw');
    });

    // Why: a junk item the bank will not take leaves the free count where it was, so a deposit chosen on "any junk at all" would be chosen again in place of the withdraw for ever.
    test('junk well clear of the reserve rides along rather than costing a deposit', () => {
        const roomy = snap({
            stage: LQ_STAGE.SACRED_WATER,
            // Why: Logs rather than a lump of rock. The rock is on the spent list, which is shed ahead of a bank errand and would answer this before the deposit rule got a look in.
            invIds: [LQ_ID.RUNE_AXE, LQ_ID.MACHETE, LQ_ID.YOMMI_SEEDS_GERM, 1511],
            inv: [...Array.from({ length: 14 }, () => 'Lobster')],
            bankIds: [LQ_ID.LOCKPICK, LQ_ID.UNPOWERED_ORB],
            bank: ['Coins']
        });
        expect(decide({ ...roomy, freeSlots: 20 }).kind).toBe('withdraw');
    });

    // Why: a live run withdrew five lobsters into its last five slots and dropped four lumps of rock on the next pass, the float came out four short and the drop bought nothing.
    test('what the quest is finished with goes out before the bank hands anything over', () => {
        const rocky = snap({
            stage: LQ_STAGE.TALK_GUJUO_POOL,
            invIds: [LQ_ID.RUNE_AXE, LQ_ID.MACHETE, LQ_ID.COINS, ...Array.from({ length: 4 }, () => LQ_ID.SWAMP_ROCK)],
            inv: ['Coins'],
            bankIds: [LQ_ID.COINS, ...Array.from({ length: 20 }, () => LQ_ID.LOBSTER)],
            bank: ['Coins', 'Lobster']
        });
        expect(name(decide({ ...rocky, freeSlots: 5 }))).toBe('custom:drop what the quest has finished with');
    });

    // Why: a random event's gift takes the slot the reed wants, and nothing is walking to a bank to be rid of it.
    test('a full pack drops a random event gift when the step is not going to a bank', () => {
        const jungle = { x: 2836, z: 2917, level: 0 };
        const full = snap({
            stage: LQ_STAGE.ASKED_GUJUO_WATER,
            invIds: [LQ_ID.GOLD_BOWL_BLESSED, LQ_ID.MACHETE, LQ_ID.COINS, 4566],
            inv: [...Array.from({ length: 14 }, () => 'Lobster'), 'Coins'],
            tile: jungle
        });
        expect(name(decide({ ...full, freeSlots: 0 }))).toBe('custom:drop what the quest has no use for');
        expect(name(decide({ ...full, freeSlots: 3 }))).not.toBe('custom:drop what the quest has no use for');
    });

    // Why: twenty-eight wanted things leave no slot for the herb the step is about to pick, and there is nothing spent or junk to shed.
    test('a full pack of wanted things eats a lobster for the slot', () => {
        const jungle = { x: 2836, z: 2917, level: 0 };
        const full = snap({
            stage: LQ_STAGE.ASKED_GUJUO_WATER,
            invIds: [LQ_ID.GOLD_BOWL_BLESSED, LQ_ID.MACHETE, LQ_ID.COINS, LQ_ID.LOBSTER],
            inv: [...Array.from({ length: 14 }, () => 'Lobster'), 'Coins'],
            tile: jungle
        });
        expect(name(decide({ ...full, freeSlots: 0 }))).toBe('custom:eat a lobster to make room');
        expect(name(decide({ ...full, freeSlots: 3 }))).not.toBe('custom:eat a lobster to make room');
    });

    // Why: the rock rolls opal 60/128, so the wait for the last gem fills the pack with uncut opals the keep list protects and the deposit will not take.
    test('a full pack drops the uncut gems whose cut stone is already in hand', () => {
        const full = atTheGemRocks([LQ_ID.OPAL, LQ_ID.UNCUT_OPAL, LQ_ID.UNCUT_OPAL]);
        expect(name(decide({ ...full, freeSlots: 0 }))).toBe('custom:drop what the quest has no use for');
        expect(name(decide({ ...full, freeSlots: 3 }))).toBe('custom:mine a gem (6 of seven still missing)');
    });

    // Why: an uncut gem whose stone has not been cut yet is the chisel step's input, not junk, and dropping it re-mines the rarest roll on the rock.
    test('the uncut gem still waiting on the chisel is not dropped', () => {
        const full = atTheGemRocks([LQ_ID.UNCUT_DIAMOND]);
        expect(name(decide({ ...full, freeSlots: 0 }))).not.toBe('custom:drop what the quest has no use for');
    });

    // Why: the trance takes five prayer points on every miss and refuses below forty-two, so seventy runs out before the bowl is blessed unless a flask goes with it.
    test('the plain golden bowl takes a prayer flask to the blessing', () => {
        const withBowl = snap({
            stage: LQ_STAGE.ASKED_GUJUO_WATER,
            invIds: [LQ_ID.GOLD_BOWL, LQ_ID.MACHETE, LQ_ID.RUNE_AXE, LQ_ID.COINS],
            inv: ['Coins', ...Array.from({ length: 14 }, () => 'Lobster')],
            bankIds: [2434],
            bank: ['Prayer potion(4)', 'Coins']
        });
        const step = decide(withBowl);
        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' ? step.items[0].name : '').toBe('Prayer potion(4)');
    });

    // Why: once the bowl is blessed the flask is the demon's, not the blessing's, and asking for one here is a bank trip the leg does not need.
    test('the blessed bowl asks for no flask of its own', () => {
        const blessed = kitted({
            stage: LQ_STAGE.ASKED_GUJUO_WATER,
            invIds: [LQ_ID.GOLD_BOWL_BLESSED],
            bankIds: [2434],
            bank: ['Prayer potion(4)']
        });
        expect(name(decide(blessed))).not.toBe('withdraw');
    });

    // Why: the book is gone from the pack once it is read, which is not the same as never having had it.
    test('the trials kit is not re-bought after the book has been read', () => {
        const jungle = { x: 2820, z: 2915, level: 0 };
        const bare = snap({
            stage: LQ_STAGE.DEFEATED_NEZI_FIRE,
            invIds: [LQ_ID.GOLD_BOWL_BLESSED, LQ_ID.YOMMI_SEEDS, LQ_ID.KNIFE],
            inv: [...Array.from({ length: 14 }, () => 'Lobster')],
            tile: jungle
        });
        expect(name(decide(bare))).toBe('custom:cut a hollow reed at the sacred pool');
    });

    // Why: every leg below the winch stands on a tile no surface path reaches, so a resumed run has to climb down before it acts.
    test('every Viyeldi leg descends first when the run is on the surface', () => {
        const surface = { x: 2800, z: 3000, level: 0 };
        const stages = [
            LQ_STAGE.ENTER_LOWER_DUNGEON,
            LQ_STAGE.CRYSTAL_SMELTED,
            LQ_STAGE.HEART_IN_RECESS,
            LQ_STAGE.PUSHED_BOULDER,
            LQ_STAGE.DEFEATED_NEZI_WATER
        ];
        for (const stage of stages) {
            const step = decide(kitted({ stage, invIds: [LQ_ID.GOLD_BOWL_BLESSED], tile: surface }));
            expect(name(step)).toBe('custom:climb back down to the Viyeldi caves');
        }
    });

    test('the dagger hand-in climbs up to Ungadulu rather than back down', () => {
        const surface = { x: 2800, z: 3000, level: 0 };
        const step = decide(kitted({ stage: LQ_STAGE.RECEIVED_DAGGER, invIds: [LQ_ID.DEATH_DAGGER], tile: surface }));
        expect(name(step)).toBe('custom:take the black dagger to Ungadulu');
    });

    // Why: a branch that acts from inside a sealed pocket sends the walker at a tile on the wrong side of a one-way crossing.
    test('every mainland leg escapes the caves first', () => {
        const inCaves = { x: 2774, z: 9301, level: 0 };
        for (const stage of [LQ_STAGE.NOT_STARTED, LQ_STAGE.GOT_GILDED_TOTEM, LQ_STAGE.TRAINING_1]) {
            const step = decide(kitted({ stage, invIds: [LQ_ID.GILDED_TOTEM, LQ_ID.YOMMI_SEEDS_GERM], tile: inCaves }));
            expect(name(step)).toBe('custom:climb back out of the caves');
        }
    });

    test('an unknown location waits rather than guessing', () => {
        const step = decide(snap({ stage: LQ_STAGE.STARTED, tile: { x: 100, z: 9000, level: 0 } }));
        expect(step.kind).toBe('wait');
    });
});

describe('the module', () => {
    test('is registered in the quest list', () => {
        expect(QUEST_DEFS.some(def => def.record.id === 'legends')).toBe(true);
    });

    test('owns its own inventory and carries no engine coin float', () => {
        expect(legends.ownsInventory).toBe(true);
        expect(legends.coinFloat).toBe(0);
    });

    // Why: the float is drawn best-first, since every fight in this quest is one it has to outlast.
    test('prefers shark, then swordfish, then lobster, then tuna', () => {
        expect([...LQ_FOODS]).toEqual(['Shark', 'Swordfish', 'Lobster', 'Tuna']);
        expect(legends.sustain?.foods[0]).toBe('Shark');
    });

    // Why: a slot is bought with the worst food held, which is the opposite order. The point is to keep the heal the demon needs.
    test('buys a slot with the worst food, not the best', () => {
        expect(FOOD_FOR_SLOT.map(f => f.name)).toEqual(['Tuna', 'Lobster', 'Swordfish', 'Shark']);
    });

    test('the keep list holds every quest item the deposit would otherwise lose', () => {
        for (const id of [LQ_ID.MAP, LQ_ID.MAP_COMPLETE, LQ_ID.BULLROARER, LQ_ID.GOLD_BOWL_BLESSED_PURE,
            LQ_ID.BOOK_OF_BINDING, LQ_ID.YOMMI_SEEDS_GERM, LQ_ID.HEART_CRYSTAL_GLOW, LQ_ID.DEATH_DAGGER,
            LQ_ID.HOLY_FORCE, LQ_ID.TOTEM_POLE, LQ_ID.GILDED_TOTEM, LQ_ID.RUNE_AXE, LQ_ID.LOCKPICK,
            LQ_ID.UNPOWERED_ORB, LQ_ID.COSMIC_RUNE]) {
            expect(KEEP_IDS).toContain(id);
        }
    });

    test('the record lists everything with no counter and no rock', () => {
        const wanted = legends.record.items.map(item => item.name);
        expect(wanted).toContain('Rune axe');
        expect(wanted).toContain('Lockpick');
        expect(wanted).toContain('Unpowered orb');
        expect(wanted).toContain('Cosmic rune');
        // Why: eligibility runs before a booth has ever been opened, so a `mustHave` would block the quest at startup.
        expect(legends.record.items.every(item => item.kind === 'acquirable')).toBe(true);
    });
});

// Why: every Viyeldi climb rolls `stat_random(agility, 110, 250)` and a miss drops the climber down the rock, so a descent lands anywhere from the next pocket to the cave floor, and the stands above are one-way behind it.
describe('the Viyeldi descent after a fall', () => {
    const at = (x: number, z: number): string => legendsPocket({ x, z, level: 0 } as never) ?? '—';

    test('the cave floor is a different pocket from the ledge stands above it', () => {
        expect(at(2385, 4730)).toBe('viyeldiMain');
        expect(at(2386, 4727)).toBe('descentThree');
        expect(at(2388, 4728)).toBe('descentFour');
    });

    // Why: this is the tile a live run ground on, three tiles from the character and in a pocket the fall had already put behind it.
    test('a guardian standing above the floor is not in the pocket the floor can walk to', () => {
        expect(at(2385, 4730)).not.toBe(at(2386, 4727));
    });
});
