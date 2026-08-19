import { describe, expect, test } from 'bun:test';

import { RG_ITEM } from '#/bot/api/ai/quests/defs/regicide/areas.js';
import { decide } from '#/bot/api/ai/quests/defs/regicide/index.js';
import { RG_FLAG, RG_STAGE } from '#/bot/api/ai/quests/defs/regicide/journal.js';
import { ARROW_TARGET, COAL_TARGET, FOOD_TARGET, RETURN_KIT, ROPE_TARGET, STILL_FOOD, WOOL_TARGET } from '#/bot/api/ai/quests/defs/regicide/supplies.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

// Why: decide() reads only a snapshot, so the routing table is testable end to end without a client.
type Stack = number | [number, number];
const counts = (stacks: Stack[]): Map<number, number> =>
    new Map(stacks.map(s => (Array.isArray(s) ? s : [s, 1])));

const ARDOUGNE = { x: 2655, z: 3283, level: 0 };
const ELF_CAMP = { x: 2205, z: 3252, level: 0 };
const PASS = { x: 2450, z: 9716, level: 0 };

/** What the module refuses to cross the palisade without. */
const KIT: Stack[] = [
    [RG_ITEM.BALL_OF_WOOL.id, WOOL_TARGET],
    RG_ITEM.PICKAXE.id,
    RG_ITEM.PESTLE.id,
    [RG_ITEM.ROPE.id, ROPE_TARGET],
    RG_ITEM.SHORTBOW.id,
    [RG_ITEM.BRONZE_ARROW.id, ARROW_TARGET],
    RG_ITEM.TINDERBOX.id,
    RG_ITEM.SPADE.id,
    [RG_ITEM.SHARK.id, FOOD_TARGET]
];
const WEAPON = 'rune scimitar';

function snapshot(over: Partial<QuestSnapshot> & {
    stage?: number;
    flags?: string[];
    carried?: Stack[];
    banked?: Stack[];
    wornNames?: string[];
} = {}): QuestSnapshot {
    const { stage = RG_STAGE.NOT_STARTED, flags = [], carried = KIT, banked = [], wornNames = [WEAPON], ...rest } = over;
    return {
        journal: 'inProgress',
        inv: new Map(),
        invIds: counts(carried),
        worn: new Set(wornNames),
        wornIds: new Set(),
        noProgress: 0,
        bankCoins: 2_000_000,
        bank: new Map(),
        bankIds: counts(banked),
        bankKnown: true,
        stage,
        progress: { stage, flags: new Set(flags) },
        tile: ELF_CAMP,
        ...rest
    } as QuestSnapshot;
}

const name = (step: QuestStep): string =>
    step.kind === 'custom' ? step.name : step.kind === 'wait' ? `wait: ${step.reason}` : step.kind;

describe('Regicide decide()', () => {
    test('a finished journal is done', () => {
        expect(decide(snapshot({ journal: 'complete' })).kind).toBe('done');
    });

    test('an unread journal waits rather than guessing a stage', () => {
        expect(decide(snapshot({ journal: 'unknown' })).kind).toBe('wait');
    });

    test('the messenger is waited for before anything else', () => {
        expect(name(decide(snapshot({ stage: RG_STAGE.NOT_STARTED, tile: ARDOUGNE })))).toContain('messenger');
    });

    test('a pack short of the kit is stopped on the mainland, not at the palisade', () => {
        const step = decide(snapshot({ stage: RG_STAGE.SPOKEN_LATHAS, tile: PASS, carried: [] }));
        expect(step.kind).toBe('wait');
        expect(step.kind === 'wait' && step.reason).toContain('not equipped for Tirannwn');
    });

    test('a kitted pack outside Tirannwn walks the pass', () => {
        expect(name(decide(snapshot({ stage: RG_STAGE.SPOKEN_LATHAS, tile: PASS })))).toContain('Underground Pass');
    });

    // Why: `upass_bridge` writes no permanent state and its lever only sends the player east, so a finished Underground Pass still owes a fire arrow on every westbound walk — a pack without one crosses nothing.
    const BRIDGE_KIT = [RG_ITEM.SHORTBOW, RG_ITEM.BRONZE_ARROW, RG_ITEM.TINDERBOX, RG_ITEM.SPADE] as const;

    for (const item of BRIDGE_KIT) {
        test(`the palisade waits for the ${item.name.toLowerCase()}`, () => {
            const short = KIT.filter(s => (Array.isArray(s) ? s[0] : s) !== item.id);
            const step = decide(snapshot({ stage: RG_STAGE.SPOKEN_LATHAS, tile: PASS, carried: short }));
            expect(step.kind).toBe('wait');
            expect(step.kind === 'wait' && step.reason.toLowerCase()).toContain(item.name.toLowerCase());
        });
    }

    test('a melee weapon is part of what the palisade waits for', () => {
        const step = decide(snapshot({ stage: RG_STAGE.SPOKEN_LATHAS, tile: PASS, wornNames: [] }));
        expect(step.kind === 'wait' && step.reason).toContain('melee weapon');
    });

    // Why: the gate is re-asked every cycle and the pass is walked with the pack in hand, so anything keyed on the full float blocks the moment the pass spends some of it — the run parked at the bridge's west foot, across the chasm, on "have 49" of fifty arrows.
    const SPENT: [string, [number, number]][] = [
        ['an arrow on the guide-rope shot', [RG_ITEM.BRONZE_ARROW.id, ARROW_TARGET - 1]],
        ['a rope on the rock swing', [RG_ITEM.ROPE.id, 1]],
        ['sharks on the traps', [RG_ITEM.SHARK.id, 1]]
    ];

    test.each(SPENT)('a pack that spent %s still walks on', (_what, left) => {
        const spent: Stack[] = KIT.map(s => ((Array.isArray(s) ? s[0] : s) === left[0] ? left : s));
        expect(name(decide(snapshot({ stage: RG_STAGE.SPOKEN_LATHAS, tile: PASS, carried: spent })))).toContain(
            'Underground Pass'
        );
    });

    // Why: the kit is 24 of the pack's 28 slots and the armour is drawn five pieces at a time, so a bank trip that takes the food first has nowhere to put the set — and `wearGear` withdraws nothing while `sourceKit` is still asking for sharks.
    test('the armour is drawn before the food, because the kit fills the pack', () => {
        const step = decide(
            snapshot({
                stage: RG_STAGE.SPOKEN_LATHAS,
                tile: ARDOUGNE,
                carried: [],
                wornNames: [],
                banked: KIT,
                bank: new Map([['rune scimitar', 1], ['rune chainbody', 1], ['rune platelegs', 1], ['rune full helm', 1], ['rune kiteshield', 1]])
            })
        );
        expect(step.kind).toBe('withdraw');
        const drawn = step.kind === 'withdraw' ? step.items.map(i => i.name.toLowerCase()) : [];
        expect(drawn).toContain('rune chainbody');
        expect(drawn).not.toContain(RG_ITEM.SHARK.name.toLowerCase());
    });

    test('the scouts are waited for inside the forest', () => {
        expect(name(decide(snapshot({ stage: RG_STAGE.SPOKEN_LATHAS })))).toContain('elf scouts');
    });

    test('the tracker is asked for proof before the pendant exists', () => {
        expect(name(decide(snapshot({ stage: RG_STAGE.SPOKEN_TRACKER })))).toContain('Lord Iorwerth');
    });

    test('the pendant in the pack sends the player back to the tracker', () => {
        const step = decide(snapshot({ stage: RG_STAGE.SPOKEN_TRACKER, carried: [...KIT, RG_ITEM.PENDANT.id] }));
        expect(name(step)).toContain('tracker');
    });

    test('a journal that records the pendant is enough, even once it has been handed over', () => {
        const step = decide(snapshot({ stage: RG_STAGE.SPOKEN_TRACKER, flags: [RG_FLAG.PENDANT] }));
        expect(name(step)).toContain('tracker');
    });
});

describe('Regicide bomb chain', () => {
    const atStage = (carried: Stack[]): QuestStep =>
        decide(snapshot({ stage: RG_STAGE.SPOKEN_IORWERTH2, carried: [...KIT, ...carried] }));

    test('the cloth is woven first, while the wool is still in the pack', () => {
        expect(name(atStage([]))).toContain('weave');
    });

    // Why: the pot is taken while the loom is still in sight, because the elf camp is four crossings from the swamp and eight from the palisade — going back for it is the forest crossed twice over.
    test('the pot is taken while the pack is still in the elf camp', () => {
        expect(name(atStage([RG_ITEM.CLOTH.id]))).toContain('pot');
    });

    test('the barrel comes next, off the same floor', () => {
        expect(name(atStage([RG_ITEM.CLOTH.id, RG_ITEM.POT.id]))).toContain('empty barrel');
    });

    test('a barrel in hand is filled rather than a second one fetched', () => {
        expect(name(atStage([RG_ITEM.CLOTH.id, RG_ITEM.POT.id, RG_ITEM.BARREL.id]))).toContain('coal-tar');
    });

    const FOREST_KIT: Stack[] = [RG_ITEM.CLOTH.id, RG_ITEM.POT.id, RG_ITEM.BARREL_TAR.id];

    test('a barrel already full of tar is not refilled', () => {
        expect(name(atStage(FOREST_KIT))).toContain('rabbit');
    });

    test('the sulphur is broken off once the rabbit is caught', () => {
        expect(name(atStage([...FOREST_KIT, RG_ITEM.RAW_RABBIT.id]))).toContain('sulphur');
    });

    test('a lump of sulphur is ground rather than a second one taken', () => {
        expect(name(atStage([...FOREST_KIT, RG_ITEM.RAW_RABBIT.id, RG_ITEM.SULPHUR.id]))).toContain('grind');
    });

    // Why: the quarry is past the palisade, so from inside the forest the limestone is a crossing before it is a rock. A `mineRock` emitted from the elf camp anchors a plain walk, which answers "no path to (2323,3269): unreachable" and mines nothing.
    test('limestone is a crossing while the pack is still in the forest', () => {
        const step = atStage([...FOREST_KIT, RG_ITEM.RAW_RABBIT.id, RG_ITEM.SULPHUR_DUST.id]);
        expect(name(step)).toContain('Arandar quarry');
    });

    test('limestone is a rock once the quarry is in reach', () => {
        const step = decide(snapshot({
            stage: RG_STAGE.SPOKEN_IORWERTH2,
            carried: [...KIT, ...FOREST_KIT, RG_ITEM.RAW_RABBIT.id, RG_ITEM.SULPHUR_DUST.id],
            tile: { x: 2323, z: 3266, level: 0 }
        }));
        expect(step.kind).toBe('mineRock');
        expect(step.kind === 'mineRock' && step.rock).toBe('Limestone');
    });

    test('a full pack leaves through the palisade', () => {
        const step = atStage([
            ...FOREST_KIT,
            RG_ITEM.RAW_RABBIT.id,
            RG_ITEM.SULPHUR_DUST.id,
            RG_ITEM.LIMESTONE.id
        ]);
        expect(name(step)).toContain('Arandar');
    });

    // Why: the mainland half is keyed on the same pack, so the same snapshot with a mainland tile has to pick up where the forest left off.
    const onMainland = (carried: Stack[]): QuestStep =>
        decide(snapshot({ stage: RG_STAGE.SPOKEN_IORWERTH2, tile: ARDOUGNE, carried: [...KIT, ...carried] }));

    const CARRIED_OUT: Stack[] = [RG_ITEM.CLOTH.id, RG_ITEM.POT.id, RG_ITEM.BARREL_TAR.id, RG_ITEM.SULPHUR_DUST.id];

    test('the raw rabbit is cooked before anything else on the mainland', () => {
        expect(name(onMainland([...CARRIED_OUT, RG_ITEM.RAW_RABBIT.id, RG_ITEM.LIMESTONE.id]))).toContain('cook');
    });

    test('the limestone is burned at a furnace the forest does not have', () => {
        const step = onMainland([...CARRIED_OUT, RG_ITEM.COOKED_RABBIT.id, RG_ITEM.LIMESTONE.id]);
        expect(name(step)).toContain('burn the limestone');
    });

    test('the quicklime is ground into the pot carried out of the forest', () => {
        const step = onMainland([...CARRIED_OUT, RG_ITEM.COOKED_RABBIT.id, RG_ITEM.QUICKLIME.id]);
        expect(name(step)).toContain('grind the quicklime');
    });

    // Why: the pass kit is seven slots and coal does not stack, so the bank trip comes first — a pack still holding the spade, the ropes, the bow and the arrows runs out of room at four coal and swings at a full inventory for the rest of the leg.
    test('the pass kit is banked before the coal is mined', () => {
        const step = onMainland([...CARRIED_OUT, RG_ITEM.COOKED_RABBIT.id, RG_ITEM.QUICKLIME_DUST.id]);
        expect(step.kind).toBe('deposit');
        expect(step.kind === 'deposit' && step.keepIds).not.toContain(RG_ITEM.SPADE.id);
        expect(step.kind === 'deposit' && step.keepIds).toContain(RG_ITEM.BARREL_TAR.id);
    });

    // Why: the pack shaped to the coal run — the chain, the two tools and a short food float. Anything else and the plan sends it to the bank first.
    test('coal is sourced once the pack is shaped for it', () => {
        const shaped: Stack[] = [
            RG_ITEM.BARREL_TAR.id, RG_ITEM.CLOTH.id, RG_ITEM.SULPHUR_DUST.id, RG_ITEM.QUICKLIME_DUST.id,
            RG_ITEM.POT.id, RG_ITEM.COOKED_RABBIT.id, RG_ITEM.PICKAXE.id, RG_ITEM.PESTLE.id,
            [RG_ITEM.SHARK.id, STILL_FOOD]
        ];
        const step = decide(snapshot({ stage: RG_STAGE.SPOKEN_IORWERTH2, tile: ARDOUGNE, carried: shaped }));
        expect(step.kind).toBe('mineRock');
        expect(step.kind === 'mineRock' && step.rock).toBe('Coal');
    });

    test('a pack with coal distils', () => {
        const step = onMainland([...CARRIED_OUT, RG_ITEM.COOKED_RABBIT.id, RG_ITEM.QUICKLIME_DUST.id, [RG_ITEM.COAL.id, 20]]);
        expect(name(step)).toContain('distil');
    });

    test('naphtha is mixed with the powders', () => {
        const step = onMainland([RG_ITEM.CLOTH.id, RG_ITEM.SULPHUR_DUST.id, RG_ITEM.QUICKLIME_DUST.id, RG_ITEM.BARREL_NAPHTHA.id, RG_ITEM.COOKED_RABBIT.id]);
        expect(name(step)).toContain('mix');
    });

    test('a half-mixed barrel is still the mixing step', () => {
        const step = onMainland([RG_ITEM.CLOTH.id, RG_ITEM.SULPHUR_DUST.id, RG_ITEM.MIX_QUICKLIME.id, RG_ITEM.COOKED_RABBIT.id]);
        expect(name(step)).toContain('mix');
    });

    test('a sealed barrel takes the fuse', () => {
        expect(name(onMainland([RG_ITEM.CLOTH.id, RG_ITEM.BARREL_LID.id, RG_ITEM.COOKED_RABBIT.id]))).toContain('fuse');
    });

    // Why: the recipe is still in the pack at this point — the wool, the pickaxe, the pestle — and none of it crosses. The bomb waits for a bank trip rather than carrying nine dead slots into the pass.
    test('a fused bomb beside the spent recipe is shaped before it crosses', () => {
        expect(onMainland([RG_ITEM.BARREL_FUSED.id, RG_ITEM.COOKED_RABBIT.id]).kind).toBe('deposit');
    });

    // Why: `regicide_cross_over3` clears the given-rabbit bit inside mapsquare 34_49, which the walk to the catapult crosses — so the guard is fed after arriving, and never before setting out.
    test('the guard is fed after the bomb is back in the forest', () => {
        expect(name(atStage([RG_ITEM.BARREL_FUSED.id, RG_ITEM.COOKED_RABBIT.id]))).toContain('catapult guard');
    });

    test('with the rabbit handed over, the catapult fires', () => {
        expect(name(atStage([RG_ITEM.BARREL_FUSED.id]))).toContain('fire the barrel bomb');
    });
});

describe('Regicide endgame', () => {
    test('the deed is reported to Iorwerth before leaving', () => {
        expect(name(decide(snapshot({ stage: RG_STAGE.KILLED_TYRAS })))).toContain('Lord Iorwerth');
    });

    test('the letter is carried out through the palisade', () => {
        expect(name(decide(snapshot({ stage: RG_STAGE.REPORTED_IORWERTH })))).toContain('Arandar');
    });

    test('on the mainland the Ardougne road is walked for Arianwyn', () => {
        expect(name(decide(snapshot({ stage: RG_STAGE.REPORTED_IORWERTH, tile: ARDOUGNE })))).toContain('Arianwyn');
    });

    test('once Arianwyn has spoken, the letter goes to King Lathas', () => {
        expect(name(decide(snapshot({ stage: RG_STAGE.SPOKEN_ARIANWYN, tile: ARDOUGNE })))).toContain('King Lathas');
    });
});

// Why: the bomb is built, so the recipe is spent — the wool is cloth and the limestone is dust. A second crossing that redraws the full kit puts nine dead slots beside a barrel bomb that has to fit as well.
describe('the walk back through the pass', () => {
    const CROSSINGS = [RG_ITEM.SPADE, RG_ITEM.ROPE, RG_ITEM.SHORTBOW, RG_ITEM.BRONZE_ARROW, RG_ITEM.TINDERBOX, RG_ITEM.SHARK];
    const RECIPE = [RG_ITEM.BALL_OF_WOOL, RG_ITEM.PICKAXE, RG_ITEM.PESTLE];

    test('the return kit keeps every crossing', () => {
        for (const item of CROSSINGS) {
            expect(RETURN_KIT.some(supply => supply.item.id === item.id)).toBe(true);
        }
    });

    test('the return kit drops the recipe', () => {
        for (const item of RECIPE) {
            expect(RETURN_KIT.some(supply => supply.item.id === item.id)).toBe(false);
        }
    });

    test('a bomb in the pack is not sent back for wool', () => {
        const step = decide(snapshot({
            stage: RG_STAGE.SPOKEN_IORWERTH2,
            tile: ARDOUGNE,
            carried: [RG_ITEM.BARREL_FUSED.id, RG_ITEM.SPADE.id, [RG_ITEM.ROPE.id, ROPE_TARGET],
                RG_ITEM.SHORTBOW.id, [RG_ITEM.BRONZE_ARROW.id, ARROW_TARGET], RG_ITEM.TINDERBOX.id,
                [RG_ITEM.SHARK.id, FOOD_TARGET]]
        }));
        expect(name(step)).toContain('Underground Pass');
    });
});

// Why: coal accumulates in the pack, so the room the plan asks for is what is left to mine. Asking for the full float once half of it is already held parks a leg that is one swing from finishing.
describe('room for the coal', () => {
    const CHAIN: Stack[] = [
        RG_ITEM.BARREL_TAR.id, RG_ITEM.CLOTH.id, RG_ITEM.SULPHUR_DUST.id, RG_ITEM.QUICKLIME_DUST.id,
        RG_ITEM.POT.id, RG_ITEM.PICKAXE.id, RG_ITEM.PESTLE.id, [RG_ITEM.SHARK.id, STILL_FOOD]
    ];

    test('a pack part way through the coal keeps mining', () => {
        const step = decide(snapshot({
            stage: RG_STAGE.SPOKEN_IORWERTH2,
            tile: ARDOUGNE,
            carried: [...CHAIN, [RG_ITEM.COAL.id, 6]],
            freeSlots: 11
        }));
        expect(step.kind).toBe('mineRock');
    });

    test('a pack with the float already mined moves on to the still', () => {
        const step = decide(snapshot({
            stage: RG_STAGE.SPOKEN_IORWERTH2,
            tile: ARDOUGNE,
            carried: [...CHAIN, [RG_ITEM.COAL.id, COAL_TARGET]],
            freeSlots: 5
        }));
        expect(name(step)).toContain('distil');
    });
});

// Why: the still leaves coal and a full food float in the pack, and `sourceKit` only ever adds — so the walk back crossed with no room and `make_clotharrow` answered "You don't have space to do that." at the bridge, an hour from the nearest bank.
describe('shaping the pack for the walk back', () => {
    const LEFTOVERS: Stack[] = [
        RG_ITEM.BARREL_FUSED.id, RG_ITEM.SPADE.id, [RG_ITEM.ROPE.id, ROPE_TARGET], RG_ITEM.SHORTBOW.id,
        [RG_ITEM.BRONZE_ARROW.id, ARROW_TARGET], RG_ITEM.TINDERBOX.id, [RG_ITEM.SHARK.id, FOOD_TARGET],
        [RG_ITEM.COAL.id, 5], RG_ITEM.PICKAXE.id, RG_ITEM.PESTLE.id
    ];

    test('the leftover coal and tools are banked before crossing', () => {
        const step = decide(snapshot({ stage: RG_STAGE.SPOKEN_IORWERTH2, tile: ARDOUGNE, carried: LEFTOVERS, freeSlots: 0 }));
        expect(step.kind).toBe('deposit');
        expect(step.kind === 'deposit' && step.keepIds).not.toContain(RG_ITEM.COAL.id);
        expect(step.kind === 'deposit' && step.keepIds).toContain(RG_ITEM.BARREL_FUSED.id);
    });

    test('a shaped pack with room for the fire arrow crosses', () => {
        const shaped: Stack[] = [
            RG_ITEM.BARREL_FUSED.id, RG_ITEM.SPADE.id, [RG_ITEM.ROPE.id, ROPE_TARGET], RG_ITEM.SHORTBOW.id,
            [RG_ITEM.BRONZE_ARROW.id, ARROW_TARGET], RG_ITEM.TINDERBOX.id, [RG_ITEM.SHARK.id, FOOD_TARGET]
        ];
        const step = decide(snapshot({ stage: RG_STAGE.SPOKEN_IORWERTH2, tile: ARDOUGNE, carried: shaped }));
        expect(name(step)).toContain('Underground Pass');
    });
});

// Why: nothing in the content deletes the King's message — the messenger's `inv_add` is the only site that touches its count, and King Lathas reads `%regicide_quest` rather than the pack. It would otherwise ride the pass twice and the coal run as a dead slot. Iorwerth's letter is the opposite: Lathas takes that one, so it stays.
describe('the King\'s message is a prop the quest never reclaims', () => {
    const CHAIN: Stack[] = [
        RG_ITEM.BARREL_TAR.id, RG_ITEM.CLOTH.id, RG_ITEM.SULPHUR_DUST.id, RG_ITEM.QUICKLIME_DUST.id,
        RG_ITEM.POT.id, RG_ITEM.PICKAXE.id, RG_ITEM.PESTLE.id, [RG_ITEM.SHARK.id, STILL_FOOD]
    ];

    test('the coal run banks it', () => {
        const step = decide(snapshot({
            stage: RG_STAGE.SPOKEN_IORWERTH2,
            tile: ARDOUGNE,
            carried: [...CHAIN, RG_ITEM.SUMMONS.id]
        }));
        expect(step.kind).toBe('deposit');
        expect(step.kind === 'deposit' && step.keepIds).not.toContain(RG_ITEM.SUMMONS.id);
    });

    test('the walk back keeps Iorwerth\'s letter, which Lathas does take', () => {
        const shaped: Stack[] = [
            RG_ITEM.BARREL_FUSED.id, RG_ITEM.MESSAGE.id, RG_ITEM.SPADE.id, [RG_ITEM.ROPE.id, ROPE_TARGET],
            RG_ITEM.SHORTBOW.id, [RG_ITEM.BRONZE_ARROW.id, ARROW_TARGET], RG_ITEM.TINDERBOX.id,
            [RG_ITEM.SHARK.id, FOOD_TARGET]
        ];
        const step = decide(snapshot({ stage: RG_STAGE.SPOKEN_IORWERTH2, tile: ARDOUGNE, carried: shaped }));
        expect(name(step)).toContain('Underground Pass');
    });
});
