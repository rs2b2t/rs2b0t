import { describe, expect, test } from 'bun:test';

import { PA_ITEM } from '#/bot/api/ai/quests/defs/princeali/areas.js';
import { PRINCE_STAGE } from '#/bot/api/ai/quests/defs/princeali/journal.js';
import { decideJailbreak, sourceBeers, sourceRopes } from '#/bot/api/ai/quests/defs/princeali/jailbreak.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

const at = (stage: number, invIds: [number, number][] = [], bankIds: [number, number][] = []): QuestSnapshot => ({
    journal: 'inProgress',
    inv: new Map(),
    invIds: new Map(invIds),
    worn: new Set(),
    wornIds: new Set(),
    noProgress: 0,
    bankCoins: 0,
    bank: new Map(),
    bankIds: new Map(bankIds),
    bankKnown: true,
    stage,
    progress: { stage, flags: new Set() }
});
const I = PA_ITEM;
const S = PRINCE_STAGE;

describe('beers', () => {
    test('three, one per conversation at the Rusty Anchor', () => {
        const step = sourceBeers(at(S.SPOKEN_OSMAN));
        expect(step?.kind === 'talk' && step.stop.npc).toBe('Bartender');
    });

    test('the bartender has no Trade op, so this is a talk and never a buy', () => {
        expect(sourceBeers(at(S.SPOKEN_OSMAN))?.kind).not.toBe('buy');
    });

    test('null once three are held', () => {
        expect(sourceBeers(at(S.SPOKEN_OSMAN, [[I.BEER.id, 3]]))).toBeNull();
    });

    test('still wanted at stage 30 — Joe has not drunk them yet', () => {
        expect(sourceBeers(at(S.PREP_FINISHED))).not.toBeNull();
    });

    test('never wanted from stage 40 on: the guard is already drunk', () => {
        expect(sourceBeers(at(S.GUARD_DRUNK))).toBeNull();
        expect(sourceBeers(at(S.TIED_KELI))).toBeNull();
        expect(sourceBeers(at(S.SAVED))).toBeNull();
    });

    test('the bank is used before the bartender', () => {
        expect(sourceBeers(at(S.SPOKEN_OSMAN, [], [[I.BEER.id, 3]]))?.kind).toBe('withdraw');
    });
});

describe('ropes', () => {
    test('two before the tie: she respawns 100 ticks later, five tiles from the door', () => {
        expect(sourceRopes(at(S.SPOKEN_OSMAN, [[I.ROPE.id, 1]]))).not.toBeNull();
        expect(sourceRopes(at(S.SPOKEN_OSMAN, [[I.ROPE.id, 2]]))).toBeNull();
    });

    test('bought from Ned by dialogue, not from a shop', () => {
        const step = sourceRopes(at(S.SPOKEN_OSMAN));
        expect(step?.kind === 'talk' && step.stop.npc).toBe('Ned');
    });

    test('one spare kept at 40 and 50, for the re-tie', () => {
        expect(sourceRopes(at(S.GUARD_DRUNK, [[I.ROPE.id, 1]]))).toBeNull();
        expect(sourceRopes(at(S.TIED_KELI, [[I.ROPE.id, 1]]))).toBeNull();
        expect(sourceRopes(at(S.TIED_KELI))).not.toBeNull();
    });

    test('none wanted once the prince is out', () => {
        expect(sourceRopes(at(S.SAVED))).toBeNull();
    });
});

describe('stage 30 — the guard', () => {
    test('talks to Joe', () => {
        const step = decideJailbreak(at(S.PREP_FINISHED, [[I.BEER.id, 3]]));
        expect(step.kind === 'talk' && step.stop.npc).toBe('Joe');
    });
});

describe('stages 40 and 50 — Keli and the cell', () => {
    const kit: [number, number][] = [
        [I.BLOND_WIG.id, 1],
        [I.PINK_SKIRT.id, 1],
        [I.PASTE.id, 1],
        [I.PRINCE_KEY.id, 1],
        [I.ROPE.id, 1]
    ];

    test('40 -> the one-shot break-in', () => {
        const step = decideJailbreak(at(S.GUARD_DRUNK, kit));
        expect(step.kind === 'custom' && step.name).toContain('Keli');
    });

    test('50 -> the same break-in, re-entrant', () => {
        const step = decideJailbreak(at(S.TIED_KELI, kit));
        expect(step.kind === 'custom' && step.name).toContain('Keli');
    });

    test('an incomplete disguise waits with a reason rather than walking into the cell', () => {
        const step = decideJailbreak(at(S.GUARD_DRUNK, [[I.PRINCE_KEY.id, 1], [I.ROPE.id, 1]]));
        expect(step.kind).toBe('wait');
        expect(step.kind === 'wait' && step.reason).toContain('Wig');
    });

    test('a plain wig does not pass for the disguise', () => {
        const step = decideJailbreak(
            at(S.GUARD_DRUNK, [
                [I.PLAIN_WIG.id, 1],
                [I.PINK_SKIRT.id, 1],
                [I.PASTE.id, 1],
                [I.PRINCE_KEY.id, 1],
                [I.ROPE.id, 1]
            ])
        );
        expect(step.kind).toBe('wait');
    });

    test('no key waits rather than unlocking a door it cannot open', () => {
        const step = decideJailbreak(
            at(S.TIED_KELI, [[I.BLOND_WIG.id, 1], [I.PINK_SKIRT.id, 1], [I.PASTE.id, 1], [I.ROPE.id, 1]])
        );
        expect(step.kind).toBe('wait');
        expect(step.kind === 'wait' && step.reason).toContain('Bronze key');
    });

    test('no rope at 40 waits — the tie is impossible without one', () => {
        const step = decideJailbreak(
            at(S.GUARD_DRUNK, [[I.BLOND_WIG.id, 1], [I.PINK_SKIRT.id, 1], [I.PASTE.id, 1], [I.PRINCE_KEY.id, 1]])
        );
        expect(step.kind).toBe('wait');
        expect(step.kind === 'wait' && step.reason).toContain('Rope');
    });
});
