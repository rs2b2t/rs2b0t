import { beforeEach, describe, expect, test } from 'bun:test';

import { DIG_ID, DIG_TILE } from '#/bot/api/ai/quests/defs/digsite/areas.js';
import { decide, digsite } from '#/bot/api/ai/quests/defs/digsite/index.js';
import { DIG_STAGE } from '#/bot/api/ai/quests/defs/digsite/journal.js';
import { DigsiteState, resetDigsiteState } from '#/bot/api/ai/quests/defs/digsite/supplies.js';
import { QUEST_DEFS } from '#/bot/api/ai/quests/defs/index.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

interface SnapOpts {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    flags?: string[];
    invIds?: number[];
    bankIds?: number[];
    bankKnown?: boolean;
    tile?: { x: number; z: number; level: number } | null;
}

function ids(list: number[]): Map<number, number> {
    const out = new Map<number, number>();
    for (const id of list) {
        out.set(id, (out.get(id) ?? 0) + 1);
    }
    return out;
}

function snap(o: SnapOpts = {}): QuestSnapshot {
    return {
        journal: o.journal ?? 'inProgress',
        inv: new Map(),
        invIds: ids(o.invIds ?? []),
        worn: new Set(),
        wornIds: new Set(),
        noProgress: 0,
        bankCoins: 0,
        stage: o.stage,
        progress: o.stage === undefined ? undefined : { stage: o.stage, flags: new Set(o.flags ?? []) },
        bank: new Map(),
        bankIds: ids(o.bankIds ?? []),
        bankKnown: o.bankKnown ?? true,
        tile: (o.tile ?? { x: 3358, z: 3410, level: 0 }) as QuestSnapshot['tile'],
        freeSlots: 20
    };
}

const label = (step: QuestStep): string => (step.kind === 'custom' ? `custom:${step.name}` : step.kind);

const WEST_SHAFT = { x: 3353, z: 9818, level: 0 };
const EAST_SHAFT = { x: 3370, z: 9828, level: 0 };
const ALTAR_CAVE = { x: 3368, z: 9767, level: 0 };

/** Enough of the chemical chain to make the pack look mid-mix. */
const NITRATE_AND_NITRO = [DIG_ID.AMMONIUM_NITRATE, DIG_ID.NITROGLYCERIN, DIG_ID.ARCENIA_ROOT, DIG_ID.COINS];

beforeEach(() => {
    resetDigsiteState();
});

describe('Digsite decide — gates', () => {
    test('a complete journal is done', () => {
        expect(decide(snap({ journal: 'complete' })).kind).toBe('done');
    });

    test('an unloaded journal waits rather than restarting the quest', () => {
        expect(decide(snap({ journal: 'unknown' })).kind).toBe('wait');
    });

    test('an unreadable stage waits', () => {
        expect(decide(snap({ stage: undefined })).kind).toBe('wait');
    });

    test('an unread bank is read before anything else', () => {
        const step = decide(snap({ stage: DIG_STAGE.FIRST_EXAM, bankKnown: false }));
        expect(step.kind).toBe('scanBank');
    });
});

describe('Digsite decide — exams', () => {
    test('an unstarted quest opens with the Examiner', () => {
        expect(label(decide(snap({ stage: DIG_STAGE.NOT_STARTED, invIds: [DIG_ID.COINS] }))))
            .toBe('custom:ask the Examiner about the Earth Sciences exams');
    });

    test('an unstamped letter goes to the Curator', () => {
        expect(label(decide(snap({ stage: DIG_STAGE.STAMPING, invIds: [DIG_ID.COINS, DIG_ID.PLAIN_LETTER] }))))
            .toBe('custom:have the Curator stamp the letter');
    });

    test('a stamped letter goes back to the Examiner', () => {
        expect(label(decide(snap({ stage: DIG_STAGE.STAMPING, invIds: [DIG_ID.COINS, DIG_ID.STAMPED_LETTER] }))))
            .toBe('custom:hand the stamped letter to the Examiner');
    });

    test('a banked letter is withdrawn rather than asked for again', () => {
        const step = decide(snap({ stage: DIG_STAGE.STAMPING, invIds: [DIG_ID.COINS], bankIds: [DIG_ID.STAMPED_LETTER] }));
        expect(step.kind).toBe('withdraw');
    });

    test('no letter anywhere asks the Examiner for a replacement', () => {
        expect(label(decide(snap({ stage: DIG_STAGE.STAMPING, invIds: [DIG_ID.COINS] }))))
            .toBe('custom:ask the Examiner to replace the lost letter');
    });

    test('the first exam starts by stealing the green sample', () => {
        expect(label(decide(snap({ stage: DIG_STAGE.FIRST_EXAM, invIds: [DIG_ID.COINS] }))))
            .toBe("custom:pickpocket the workmen for the green student's sample");
    });

    test('a held green sample is delivered before anything else', () => {
        expect(label(decide(snap({ stage: DIG_STAGE.FIRST_EXAM, invIds: [DIG_ID.COINS, DIG_ID.ROCK_SAMPLE_GREEN] }))))
            .toBe("custom:return the green student's rock sample");
    });

    test('the purple errand is the bush', () => {
        expect(label(decide(snap({ stage: DIG_STAGE.FIRST_EXAM, flags: ['green-answered'], invIds: [DIG_ID.COINS] }))))
            .toBe("custom:search the bush for the purple student's sample");
    });

    test('the orange errand is the river', () => {
        expect(label(decide(snap({
            stage: DIG_STAGE.FIRST_EXAM,
            flags: ['green-answered', 'purple-answered'],
            invIds: [DIG_ID.COINS]
        })))).toBe("custom:pan the river for the orange student's sample");
    });

    test('all three answered sits the exam', () => {
        expect(label(decide(snap({ stage: DIG_STAGE.FIRST_EXAM, flags: ['exam-ready'], invIds: [DIG_ID.COINS] }))))
            .toBe('custom:sit the first Earth Sciences exam');
    });

    test('the second exam is three conversations', () => {
        expect(label(decide(snap({ stage: DIG_STAGE.SECOND_EXAM, invIds: [DIG_ID.COINS] }))))
            .toBe('custom:revise with the three students for exam 2');
    });

    test('the third exam needs an opal before the students are worth talking to', () => {
        expect(label(decide(snap({ stage: DIG_STAGE.THIRD_EXAM, invIds: [DIG_ID.COINS] }))))
            .toBe('custom:pan the river for an opal');
    });

    test('an uncut opal is cut before it is given away', () => {
        const step = decide(snap({ stage: DIG_STAGE.THIRD_EXAM, invIds: [DIG_ID.COINS, DIG_ID.UNCUT_OPAL, DIG_ID.CHISEL] }));
        expect(step.kind).toBe('useOn');
        expect(step.kind === 'useOn' && step.product).toBe('Opal');
    });

    test('cutting an opal without a chisel buys one', () => {
        const step = decide(snap({ stage: DIG_STAGE.THIRD_EXAM, invIds: [DIG_ID.COINS, DIG_ID.UNCUT_OPAL] }));
        expect(step.kind).toBe('buy');
        expect(step.kind === 'buy' && step.item).toBe('Chisel');
    });

    test('a cut opal in the pack sends the bot back to the students', () => {
        expect(label(decide(snap({ stage: DIG_STAGE.THIRD_EXAM, invIds: [DIG_ID.COINS, DIG_ID.OPAL] }))))
            .toBe('custom:revise with the three students for exam 3');
    });
});

describe('Digsite decide — panning rights', () => {
    const orangeOutstanding = (invIds: number[]): QuestStep => decide(snap({
        stage: DIG_STAGE.FIRST_EXAM,
        flags: ['green-answered', 'purple-answered'],
        invIds
    }));

    test('the first pan is attempted without asking anyone', () => {
        expect(label(orangeOutstanding([DIG_ID.COINS])))
            .toBe("custom:pan the river for the orange student's sample");
    });

    test('a refused pan sends the bot to the tea seller', () => {
        DigsiteState.teaWanted = true;
        const step = orangeOutstanding([DIG_ID.COINS]);
        expect(step.kind).toBe('buy');
        expect(step.kind === 'buy' && step.item).toBe('Cup of tea');
    });

    test('tea in the pack goes back to the water rather than buying another', () => {
        DigsiteState.teaWanted = true;
        expect(label(orangeOutstanding([DIG_ID.COINS, DIG_ID.CUP_OF_TEA])))
            .toBe("custom:pan the river for the orange student's sample");
    });
});

describe('Digsite decide — the find and the permit', () => {
    test('the level 3 dig needs a trowel first', () => {
        expect(label(decide(snap({ stage: DIG_STAGE.IMPRESS_EXPERT, invIds: [DIG_ID.COINS] }))))
            .toBe('custom:ask the Examiner for another trowel');
    });

    test('a trowel without a jar searches the sacks', () => {
        expect(label(decide(snap({ stage: DIG_STAGE.IMPRESS_EXPERT, invIds: [DIG_ID.COINS, DIG_ID.TROWEL] }))))
            .toBe('custom:search the sacks for a specimen jar');
    });

    test('a jar without a brush picks a pocket', () => {
        expect(label(decide(snap({
            stage: DIG_STAGE.IMPRESS_EXPERT,
            invIds: [DIG_ID.COINS, DIG_ID.TROWEL, DIG_ID.SPECIMEN_JAR]
        })))).toBe('custom:pickpocket the workmen for a specimen brush');
    });

    test('a full dig kit digs', () => {
        expect(label(decide(snap({
            stage: DIG_STAGE.IMPRESS_EXPERT,
            invIds: [DIG_ID.COINS, DIG_ID.TROWEL, DIG_ID.SPECIMEN_JAR, DIG_ID.SPECIMEN_BRUSH]
        })))).toBe('custom:dig the level 3 site for a find');
    });

    test('a talisman goes to the expert', () => {
        expect(label(decide(snap({ stage: DIG_STAGE.IMPRESS_EXPERT, invIds: [DIG_ID.COINS, DIG_ID.TALISMAN] }))))
            .toBe('custom:show the Zarosian talisman to the expert');
    });

    test('the invitation letter goes to a workman', () => {
        expect(label(decide(snap({ stage: DIG_STAGE.IMPRESS_EXPERT, invIds: [DIG_ID.COINS, DIG_ID.EXPERT_SCROLL] }))))
            .toBe('custom:show the invitation letter to a workman');
    });
});

describe('Digsite decide — the chemical chain', () => {
    /** The far shops are visited once, so every later branch starts from a stocked pack. */
    const SHOPPED = [DIG_ID.COINS, DIG_ID.TINDERBOX, DIG_ID.VIAL, DIG_ID.PESTLE];

    const permit = (invIds: number[], tile?: { x: number; z: number; level: number }): QuestStep =>
        decide(snap({ stage: DIG_STAGE.MINESHAFT_PERMIT, invIds, tile }));

    test('with no key and no root, the rope comes first', () => {
        expect(label(permit([DIG_ID.COINS]))).toBe('custom:pickpocket the workmen for 2 ropes');
    });

    test('with a rope, the west shaft is the first trip', () => {
        expect(label(permit([DIG_ID.COINS, DIG_ID.ROPE]))).toBe('custom:beg the cave workman for the chest key');
    });

    test('standing in the west shaft does the shaft work rather than climbing out', () => {
        expect(label(permit([DIG_ID.COINS], WEST_SHAFT))).toBe('custom:beg the cave workman for the chest key');
    });

    test('standing in the east shaft with shaft work outstanding climbs out', () => {
        expect(label(permit([DIG_ID.COINS], EAST_SHAFT))).toBe('custom:climb out of the dig shaft');
    });

    test('the shaft work done, the tinderbox is bought before anything walks back east', () => {
        const step = permit([DIG_ID.COINS, DIG_ID.CHEST_KEY, DIG_ID.ARCENIA_ROOT]);
        expect(step.kind).toBe('buy');
        expect(step.kind === 'buy' && step.item).toBe('Tinderbox');
    });

    test('the vial and the pestle are bought on one trip', () => {
        expect(label(permit([DIG_ID.COINS, DIG_ID.TINDERBOX, DIG_ID.CHEST_KEY, DIG_ID.ARCENIA_ROOT])))
            .toBe('custom:buy Vial and Pestle and mortar from Jatix');
    });

    test('a key and a root move on to the chest', () => {
        expect(label(permit([...SHOPPED, DIG_ID.CHEST_KEY, DIG_ID.ARCENIA_ROOT])))
            .toBe('custom:unlock and search the digsite chest');
    });

    test('the powder is identified by the expert', () => {
        expect(label(permit([...SHOPPED, DIG_ID.POWDER, DIG_ID.ARCENIA_ROOT])))
            .toBe('custom:have the expert identify the powder');
    });

    test('with nitrate and a vial, the trowel opens the barrel', () => {
        expect(label(permit([...SHOPPED, DIG_ID.AMMONIUM_NITRATE, DIG_ID.ARCENIA_ROOT, DIG_ID.TROWEL])))
            .toBe('custom:lever the barrel open and fill a vial');
    });

    test('without a trowel the Examiner is asked for one', () => {
        expect(label(permit([...SHOPPED, DIG_ID.AMMONIUM_NITRATE, DIG_ID.ARCENIA_ROOT])))
            .toBe('custom:ask the Examiner for another trowel');
    });

    test('a filled vial is identified by the expert', () => {
        expect(label(permit([...SHOPPED, DIG_ID.AMMONIUM_NITRATE, DIG_ID.ARCENIA_ROOT, DIG_ID.LIQUID])))
            .toBe('custom:have the expert identify the liquid');
    });

    test('nitrate and nitroglycerin are mixed', () => {
        expect(label(permit([...SHOPPED, ...NITRATE_AND_NITRO]))).toBe('custom:mix the nitrate into the nitroglycerin');
    });

    test('the half mixture wants charcoal next', () => {
        expect(label(permit([...SHOPPED, DIG_ID.PRE_CHARCOAL, DIG_ID.ARCENIA_ROOT, DIG_ID.TROWEL])))
            .toBe('custom:dig the training site for charcoal');
    });

    test('charcoal and a pestle are ground', () => {
        expect(label(permit([...SHOPPED, DIG_ID.PRE_CHARCOAL, DIG_ID.ARCENIA_ROOT, DIG_ID.CHARCOAL])))
            .toBe('custom:grind the charcoal to a powder');
    });

    test('ground charcoal is mixed in', () => {
        expect(label(permit([...SHOPPED, DIG_ID.PRE_CHARCOAL, DIG_ID.ARCENIA_ROOT, DIG_ID.GROUND_CHARCOAL])))
            .toBe('custom:mix the ground charcoal in');
    });

    test('the root is last into the mixture', () => {
        expect(label(permit([...SHOPPED, DIG_ID.POST_CHARCOAL, DIG_ID.ARCENIA_ROOT])))
            .toBe('custom:mix the arcenia root in');
    });

    test('a finished compound needs a tinderbox before the shaft', () => {
        const step = permit([DIG_ID.COINS, DIG_ID.COMPOUND, DIG_ID.ROPE]);
        expect(step.kind).toBe('buy');
        expect(step.kind === 'buy' && step.item).toBe('Tinderbox');
    });

    test('compound, tinderbox and rope go and pour it', () => {
        expect(label(permit([DIG_ID.COINS, DIG_ID.COMPOUND, DIG_ID.TINDERBOX, DIG_ID.ROPE])))
            .toBe('custom:pour the compound over the blocked bricks');
    });
});

describe('Digsite decide — the blast and the tablet', () => {
    test('a poured compound is lit', () => {
        expect(label(decide(snap({
            stage: DIG_STAGE.POURED_COMPOUND,
            invIds: [DIG_ID.COINS, DIG_ID.TINDERBOX, DIG_ID.ROPE]
        })))).toBe('custom:light the explosive compound');
    });

    test('a blast that already went off looks for the tablet', () => {
        expect(label(decide(snap({
            stage: DIG_STAGE.POURED_COMPOUND,
            invIds: [DIG_ID.COINS],
            tile: ALTAR_CAVE
        })))).toBe('custom:take the Zarosian stone tablet');
    });

    test('the altar cave is searched for the tablet', () => {
        expect(label(decide(snap({ stage: DIG_STAGE.REMOVED_BLOCKAGE, invIds: [DIG_ID.COINS], tile: ALTAR_CAVE }))))
            .toBe('custom:take the Zarosian stone tablet');
    });

    test('a held tablet goes to the expert, climbing out first', () => {
        expect(label(decide(snap({
            stage: DIG_STAGE.REMOVED_BLOCKAGE,
            invIds: [DIG_ID.COINS, DIG_ID.STONE_TABLET],
            tile: ALTAR_CAVE
        })))).toBe('custom:climb out of the dig shaft');
        expect(label(decide(snap({
            stage: DIG_STAGE.REMOVED_BLOCKAGE,
            invIds: [DIG_ID.COINS, DIG_ID.STONE_TABLET]
        })))).toBe('custom:show the stone tablet to the expert');
    });
});

describe('Digsite module wiring', () => {
    test('the module is in the queue exactly once', () => {
        expect(QUEST_DEFS.filter(d => d.record.id === 'itexam')).toHaveLength(1);
    });

    test('it owns its own inventory and pins the Varrock booth', () => {
        expect(digsite.ownsInventory).toBe(true);
        expect(digsite.bank).toBe(DIG_TILE.VARROCK_BANK);
    });

    test('it reads progress from the journal rather than a varp', () => {
        expect(typeof digsite.readProgress).toBe('function');
        expect(digsite.readStage).toBeUndefined();
    });

    test('every surface leg escapes a shaft first', () => {
        for (const stage of [DIG_STAGE.NOT_STARTED, DIG_STAGE.STAMPING, DIG_STAGE.FIRST_EXAM, DIG_STAGE.SECOND_EXAM, DIG_STAGE.THIRD_EXAM, DIG_STAGE.IMPRESS_EXPERT]) {
            expect(label(decide(snap({ stage, invIds: [DIG_ID.COINS], tile: WEST_SHAFT }))))
                .toBe('custom:climb out of the dig shaft');
        }
    });
});
