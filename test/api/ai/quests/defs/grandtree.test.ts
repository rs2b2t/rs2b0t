import { afterEach, describe, expect, test } from 'bun:test';

import { GT_OBJ, GT_STAGE, GT_TILE, NARNODE_TRANSLATION } from '#/bot/api/ai/quests/defs/grandtree/areas.js';
import { decide, grandtree } from '#/bot/api/ai/quests/defs/grandtree/index.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';
import { QuestFood } from '#/bot/api/ai/quests/food.js';

interface Options {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    invIds?: number[];
    inv?: string[];
    worn?: string[];
    bank?: string[];
    bankKnown?: boolean;
    tile?: { x: number; z: number; level: number };
    freeSlots?: number;
}

const STRONGHOLD = { x: 2466, z: 3497, level: 0 };
const KARAMJA = { x: 2999, z: 3043, level: 0 };
const CAVES = { x: 2491, z: 9864, level: 0 };

function counts(names: string[]): Map<string, number> {
    const out = new Map<string, number>();
    for (const name of names) {
        const key = name.toLowerCase();
        out.set(key, (out.get(key) ?? 0) + 1);
    }
    return out;
}

function idCounts(ids: number[]): Map<number, number> {
    const out = new Map<number, number>();
    for (const id of ids) {
        out.set(id, (out.get(id) ?? 0) + 1);
    }
    return out;
}

function snap(options: Options = {}): QuestSnapshot {
    return {
        journal: options.journal ?? 'inProgress',
        inv: counts(options.inv ?? []),
        invIds: idCounts(options.invIds ?? []),
        worn: new Set((options.worn ?? []).map(n => n.toLowerCase())),
        noProgress: 0,
        bankCoins: 2_000_000,
        stage: options.stage,
        bank: counts(options.bank ?? []),
        bankKnown: options.bankKnown ?? true,
        tile: options.tile ?? STRONGHOLD,
        freeSlots: options.freeSlots ?? 20
    };
}

function talkTarget(step: QuestStep): string | null {
    return step.kind === 'talk' ? step.stop.npc : null;
}

function customName(step: QuestStep): string | null {
    return step.kind === 'custom' ? step.name : null;
}

afterEach(() => {
    QuestFood.name = 'Trout';
});

describe('The Grand Tree decide()', () => {
    test('a green quest list is done and a blank one waits', () => {
        expect(decide(snap({ journal: 'complete' })).kind).toBe('done');
        expect(decide(snap({ journal: 'unknown' })).kind).toBe('wait');
    });

    test('an unreadable journal waits rather than restarting the quest', () => {
        const step = decide(snap({ stage: undefined }));

        expect(step.kind).toBe('wait');
        expect(step.kind === 'wait' && step.reason).toContain('stage unavailable');
    });

    test('starts by talking to King Narnode', () => {
        expect(customName(decide(snap({ journal: 'notStarted', stage: GT_STAGE.NOT_STARTED }))))
            .toBe('start the quest with King Narnode');
    });

    test('banks junk when the pack has no room for the bark sample and the book', () => {
        const step = decide(snap({ stage: GT_STAGE.NOT_STARTED, freeSlots: 1 }));

        expect(step.kind).toBe('deposit');
        expect(step.kind === 'deposit' && step.keep).toContain('bark sample');
    });

    test('carries the bark sample to Hazelmere, then the message back to the King', () => {
        expect(talkTarget(decide(snap({ stage: GT_STAGE.STARTED, invIds: [GT_OBJ.BARK] })))).toBe('Hazelmere');
        expect(talkTarget(decide(snap({ stage: GT_STAGE.SPOKEN_HAZELMERE })))).toBe('King Narnode Shareen');
    });

    test('a lost bark sample goes back to the King for another rather than to Hazelmere', () => {
        expect(talkTarget(decide(snap({ stage: GT_STAGE.STARTED })))).toBe('King Narnode Shareen');
    });

    test('relays the message to Glough and reports back', () => {
        expect(talkTarget(decide(snap({ stage: GT_STAGE.RELAYED_MESSAGE })))).toBe('Glough');
        expect(talkTarget(decide(snap({ stage: GT_STAGE.SPOKEN_GLOUGH })))).toBe('King Narnode Shareen');
    });

    test('visits the prisoner, then searches the cupboard he points at', () => {
        expect(talkTarget(decide(snap({ stage: GT_STAGE.FOUND_PRISONER })))).toBe('Charlie');
        expect(customName(decide(snap({ stage: GT_STAGE.SPOKEN_PRISONER })))).toBe("search Glough's cupboard");
    });

    test('takes the journal back to Glough and expects the cage', () => {
        expect(customName(decide(snap({ stage: GT_STAGE.FOUND_JOURNAL }))))
            .toBe('confront Glough and get out of his cage');
    });

    test('stage 80 flies out of the stronghold, and talks to the foreman once it lands', () => {
        expect(customName(decide(snap({ stage: GT_STAGE.RELEASED_PRISON, tile: STRONGHOLD }))))
            .toBe('take the glider to Karamja');
        expect(customName(decide(snap({ stage: GT_STAGE.RELEASED_PRISON, tile: KARAMJA }))))
            .toBe('get the lumber order from the foreman');
    });

    test('stage 90 rides the cart back in from outside, and talks to Charlie once inside', () => {
        expect(customName(decide(snap({ stage: GT_STAGE.OBTAINED_LUMBER_ORDER, tile: KARAMJA }))))
            .toBe("ride Femi's cart into the stronghold");
        expect(talkTarget(decide(snap({ stage: GT_STAGE.OBTAINED_LUMBER_ORDER, tile: STRONGHOLD })))).toBe('Charlie');
    });

    test('stage 100 fetches the key before it opens the chest', () => {
        expect(customName(decide(snap({ stage: GT_STAGE.CLUE_CHARLIE }))))
            .toBe('ask Anita for the chest key');
        expect(customName(decide(snap({ stage: GT_STAGE.CLUE_CHARLIE, invIds: [GT_OBJ.KEY] }))))
            .toBe("unlock Glough's chest");
    });

    test('the plans need four free slots for the twigs the King answers with', () => {
        const holding = { stage: GT_STAGE.FOUND_INVASION_PLANS, invIds: [GT_OBJ.INVASION_PLANS] };
        expect(decide(snap({ ...holding, freeSlots: 3 })).kind).toBe('deposit');
        expect(talkTarget(decide(snap(holding)))).toBe('King Narnode Shareen');
    });

    test('plans lost after the chest was opened re-run the chest instead of parking', () => {
        expect(customName(decide(snap({ stage: GT_STAGE.FOUND_INVASION_PLANS, invIds: [GT_OBJ.KEY] }))))
            .toBe("unlock Glough's chest");
    });

    test('the caves are re-entered before anything past the demon is attempted', () => {
        expect(customName(decide(snap({ stage: GT_STAGE.DEFEATED_BLACK_DEMON, tile: STRONGHOLD }))))
            .toBe('drop back into the root caves');
        expect(customName(decide(snap({ stage: GT_STAGE.SEARCHING_DACONIA, tile: STRONGHOLD }))))
            .toBe('drop back into the root caves');
    });

    test('lays each held twig on its own pillar, in the order the trapdoor checks them', () => {
        const all = snap({ stage: GT_STAGE.GIVEN_TWIGS, invIds: [GT_OBJ.TWIG_T, GT_OBJ.TWIG_U, GT_OBJ.TWIG_Z, GT_OBJ.TWIG_O] });
        expect(customName(decide(all))).toBe('lay twig 1 of 4 on its pillar');

        const twoLeft = snap({ stage: GT_STAGE.GIVEN_TWIGS, invIds: [GT_OBJ.TWIG_Z, GT_OBJ.TWIG_O] });
        expect(customName(decide(twoLeft))).toBe('lay twig 3 of 4 on its pillar');
    });

    test('an empty pack at stage 120 asks the King for another set rather than waiting', () => {
        expect(talkTarget(decide(snap({ stage: GT_STAGE.GIVEN_TWIGS })))).toBe('King Narnode Shareen');
    });

    test('kits up for the demon while the trapdoor is still shut', () => {
        QuestFood.name = 'Lobster';
        const step = decide(snap({ stage: GT_STAGE.UNLOCKED_TRAPDOOR, bank: ['lobster', 'lobster', 'lobster'] }));

        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0]?.name).toBe('Lobster');
    });

    test('the kit is bought at stage 120, before the first climb to the pillars', () => {
        QuestFood.name = 'Lobster';
        const step = decide(snap({
            stage: GT_STAGE.GIVEN_TWIGS,
            invIds: [GT_OBJ.TWIG_T],
            bank: ['lobster', 'lobster', 'lobster']
        }));

        expect(step.kind).toBe('withdraw');
    });

    test('a kit still owed from the pillar floor climbs down for it rather than banking in the pocket', () => {
        QuestFood.name = 'Lobster';
        const pillars = { x: 2486, z: 3465, level: 2 };
        expect(customName(decide(snap({ stage: GT_STAGE.GIVEN_TWIGS, tile: pillars, bank: ['lobster'] }))))
            .toBe("climb down out of Glough's tree for the kit");
        expect(customName(decide(snap({ stage: GT_STAGE.UNLOCKED_TRAPDOOR, tile: pillars, bank: ['lobster'] }))))
            .toBe("climb down out of Glough's tree for the kit");
    });

    test('an unknown bank is scanned before the demon rather than guessed at', () => {
        QuestFood.name = 'Lobster';
        const step = decide(snap({ stage: GT_STAGE.UNLOCKED_TRAPDOOR, bankKnown: false }));

        expect(step.kind).toBe('scanBank');
    });

    test('once the pack is stocked, stage 130 goes down the trapdoor', () => {
        QuestFood.name = 'Lobster';
        const stocked = Array.from({ length: 10 }, () => 'Lobster');
        expect(customName(decide(snap({ stage: GT_STAGE.UNLOCKED_TRAPDOOR, inv: stocked }))))
            .toBe('take the trapdoor and kill the Black Demon');
    });

    test('preparation stops at the door — inside the caves nothing banks', () => {
        QuestFood.name = 'Lobster';
        const step = decide(snap({ stage: GT_STAGE.UNLOCKED_TRAPDOOR, tile: CAVES, bank: ['lobster'] }));

        expect(customName(step)).toBe('take the trapdoor and kill the Black Demon');
    });

    test('reports the fight to the King underground, then hunts the roots', () => {
        expect(talkTarget(decide(snap({ stage: GT_STAGE.DEFEATED_BLACK_DEMON, tile: CAVES }))))
            .toBe('King Narnode Shareen');
        expect(customName(decide(snap({ stage: GT_STAGE.SEARCHING_DACONIA, tile: CAVES }))))
            .toBe('search the roots for the Daconia rock');
        expect(customName(decide(snap({ stage: GT_STAGE.SEARCHING_DACONIA, tile: CAVES, invIds: [GT_OBJ.DACONIA] }))))
            .toBe('give the King the Daconia rock');
    });

    test('the underground King is the one stage 140 walks to', () => {
        const step = decide(snap({ stage: GT_STAGE.DEFEATED_BLACK_DEMON, tile: CAVES }));

        expect(step.kind === 'talk' && step.stop.anchor.z).toBe(GT_TILE.narnodeUnder.z);
    });
});

describe('The Grand Tree module', () => {
    test('keeps every quest item off the spillover deposit', () => {
        expect(grandtree.tools).toContain('twigs');
        expect(grandtree.tools).toContain('daconia rock');
    });

    test('banks wherever it is standing, since the quest crosses three kingdoms', () => {
        expect(grandtree.bank).toBe('nearest');
    });

    test('carries a float Femi\'s 1000gp cart fare and the Brimhaven fare both fit inside', () => {
        expect(grandtree.coinFloat).toBeGreaterThanOrEqual(1030);
    });

    test('the translation answers are ordered so the two "None of the above." pages fall through', () => {
        expect(NARNODE_TRANSLATION.indexOf('None of the above.'))
            .toBeGreaterThan(NARNODE_TRANSLATION.indexOf("A man came to me with the King's seal."));
        expect(NARNODE_TRANSLATION.indexOf('None of the above.'))
            .toBeGreaterThan(NARNODE_TRANSLATION.indexOf('And Daconia rocks will kill the tree!'));
    });
});
