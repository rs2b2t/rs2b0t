import { describe, expect, test } from 'bun:test';

import { PA_ITEM } from '#/bot/quests/defs/princeali/areas.js';
import {
    disguiseComplete,
    makeAshes,
    makeBlondWig,
    makePaste,
    sourceOnions,
    sourcePasteGoods,
    sourcePinkSkirt,
    sourceShears,
    sourceTinderbox,
    sourceWool
} from '#/bot/quests/defs/princeali/disguise.js';
import type { QuestSnapshot } from '#/bot/quests/engine/types.js';

const snap = (invIds: [number, number][] = [], bankIds: [number, number][] = []): QuestSnapshot => ({
    journal: 'inProgress',
    inv: new Map(),
    invIds: new Map(invIds),
    worn: new Set(),
    wornIds: new Set(),
    noProgress: 0,
    bankCoins: 0,
    bank: new Map(),
    bankIds: new Map(bankIds),
    bankKnown: true
});
const I = PA_ITEM;

describe('the wig chain never re-buys a consumed input', () => {
    test('nothing held -> wool is wanted', () => {
        expect(sourceWool(snap())).not.toBeNull();
    });

    test('a plain wig held -> no more wool', () => {
        expect(sourceWool(snap([[I.PLAIN_WIG.id, 1]]))).toBeNull();
    });

    test('a blond wig held -> no wool, no onions, nothing left to make', () => {
        const s = snap([[I.BLOND_WIG.id, 1]]);
        expect(sourceWool(s)).toBeNull();
        expect(sourceOnions(s)).toBeNull();
        expect(makeBlondWig(s)).toBeNull();
    });

    test('three balls already held -> no more wool', () => {
        expect(sourceWool(snap([[I.BALL_OF_WOOL.id, 3]]))).toBeNull();
    });

    test('onions are only wanted while the dye is missing', () => {
        expect(sourceOnions(snap())?.kind).toBe('pickLoc');
        expect(sourceOnions(snap([[I.YELLOW_DYE.id, 1]]))).toBeNull();
        expect(sourceOnions(snap([[I.ONION.id, 2]]))).toBeNull();
    });

    test('onions come from the Lumbridge patch by Pick', () => {
        const step = sourceOnions(snap());
        expect(step?.kind === 'pickLoc' && step.op).toBe('Pick');
        expect(step?.kind === 'pickLoc' && step.anchor.x).toBe(3189);
    });

    test('two onions and no dye -> make the dye at Aggie', () => {
        const step = makeBlondWig(snap([[I.ONION.id, 2]]));
        expect(step?.kind === 'custom' && step.name).toContain('yellow dye');
    });

    test('dye and three balls of wool but no wig -> Ned makes the wig', () => {
        const step = makeBlondWig(snap([[I.YELLOW_DYE.id, 1], [I.BALL_OF_WOOL.id, 3]]));
        expect(step?.kind === 'talk' && step.stop.npc).toBe('Ned');
    });

    test('dye plus plain wig -> dye the wig', () => {
        const step = makeBlondWig(snap([[I.PLAIN_WIG.id, 1], [I.YELLOW_DYE.id, 1]]));
        expect(step?.kind === 'custom' && step.name).toContain('dye');
    });

    test('a banked blond wig is withdrawn rather than remade', () => {
        const step = makeBlondWig(snap([], [[I.BLOND_WIG.id, 1]]));
        expect(step?.kind).toBe('withdraw');
    });
});

describe('paste chain', () => {
    test('paste held -> nothing in the chain is wanted', () => {
        const s = snap([[I.PASTE.id, 1]]);
        expect(sourcePasteGoods(s)).toBeNull();
        expect(sourceTinderbox(s)).toBeNull();
        expect(makeAshes(s)).toBeNull();
        expect(makePaste(s)).toBeNull();
    });

    test('no redberries -> buy at Wydin', () => {
        const step = sourcePasteGoods(snap());
        expect(step?.kind === 'buy' && step.item).toBe('Redberries');
        expect(step?.kind === 'buy' && step.shop.npc).toBe('Wydin');
    });

    test('redberries but no flour -> buy the flour at Wydin', () => {
        const step = sourcePasteGoods(snap([[I.REDBERRIES.id, 1]]));
        expect(step?.kind === 'buy' && step.item).toBe('Pot of flour');
    });

    test('ashes held -> no tinderbox and no logs', () => {
        const s = snap([[I.ASHES.id, 1]]);
        expect(sourceTinderbox(s)).toBeNull();
        expect(makeAshes(s)).toBeNull();
    });

    test('no tinderbox yet -> the ashes leg holds off; the tinderbox leg runs earlier', () => {
        expect(makeAshes(snap())).toBeNull();
    });

    test('tinderbox but no logs -> grab the Draynor spawn', () => {
        const step = makeAshes(snap([[I.TINDERBOX.id, 1]]));
        expect(step?.kind === 'grabGround' && step.item).toBe('Logs');
        expect(step?.kind === 'grabGround' && step.anchor.x).toBe(3089);
    });

    test('tinderbox and logs -> burn them', () => {
        const step = makeAshes(snap([[I.TINDERBOX.id, 1], [I.LOGS.id, 1]]));
        expect(step?.kind === 'custom' && step.name).toContain('ash');
    });

    test('all four ingredients -> Aggie mixes the paste', () => {
        const s = snap([[I.REDBERRIES.id, 1], [I.POT_OF_FLOUR.id, 1], [I.ASHES.id, 1], [I.JUG_OF_WATER.id, 1]]);
        const step = makePaste(s);
        expect(step?.kind).toBe('talk');
        expect(step?.kind === 'talk' && step.stop.npc).toBe('Aggie');
    });

    test('no water -> the paste leg waits and names what is missing', () => {
        const s = snap([[I.REDBERRIES.id, 1], [I.POT_OF_FLOUR.id, 1], [I.ASHES.id, 1]]);
        const step = makePaste(s);
        expect(step?.kind).toBe('wait');
        expect(step?.kind === 'wait' && step.reason).toContain('Jug of water');
    });
});

describe('skirt and shears', () => {
    test('no skirt -> buy at Thessalia', () => {
        const step = sourcePinkSkirt(snap());
        expect(step?.kind === 'buy' && step.shop.npc).toBe('Thessalia');
    });

    test('skirt held -> null', () => {
        expect(sourcePinkSkirt(snap([[I.PINK_SKIRT.id, 1]]))).toBeNull();
    });

    test('shears are only wanted while wool is still needed', () => {
        expect(sourceShears(snap())?.kind).toBe('buy');
        expect(sourceShears(snap([[I.PLAIN_WIG.id, 1]]))).toBeNull();
        expect(sourceShears(snap([[I.BALL_OF_WOOL.id, 3]]))).toBeNull();
        expect(sourceShears(snap([[I.SHEARS.id, 1]]))).toBeNull();
    });

    test('shears come from the Lumbridge general store, on the same trip as the tinderbox', () => {
        const shears = sourceShears(snap());
        const tinderbox = sourceTinderbox(snap());
        expect(shears?.kind === 'buy' && shears.shop.npc).toBe('Shop keeper');
        expect(tinderbox?.kind === 'buy' && tinderbox.shop.npc).toBe('Shop keeper');
    });
});

describe('disguiseComplete', () => {
    test('needs the blond wig, not the plain one', () => {
        expect(disguiseComplete(snap([[I.PLAIN_WIG.id, 1], [I.PINK_SKIRT.id, 1], [I.PASTE.id, 1]]))).toBe(false);
        expect(disguiseComplete(snap([[I.BLOND_WIG.id, 1], [I.PINK_SKIRT.id, 1], [I.PASTE.id, 1]]))).toBe(true);
    });

    test('banked pieces do not count — the prince needs them in the pack', () => {
        expect(disguiseComplete(snap([[I.BLOND_WIG.id, 1], [I.PINK_SKIRT.id, 1]], [[I.PASTE.id, 1]]))).toBe(false);
    });
});
