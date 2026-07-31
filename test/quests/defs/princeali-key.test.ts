import { describe, expect, test } from 'bun:test';

import { PA_ITEM } from '#/bot/quests/defs/princeali/areas.js';
import { PRINCE_STAGE } from '#/bot/quests/defs/princeali/journal.js';
import {
    collectKey,
    haveKey,
    makeSoftClay,
    sourceBronzeBar,
    sourceClay,
    sourcePickaxe,
    sourceWater,
    takeKeyPrint
} from '#/bot/quests/defs/princeali/key.js';
import type { QuestSnapshot } from '#/bot/quests/engine/types.js';

const snap = (
    invIds: [number, number][] = [],
    bankIds: [number, number][] = [],
    extra: Partial<QuestSnapshot> = {}
): QuestSnapshot => ({
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
    stage: PRINCE_STAGE.SPOKEN_OSMAN,
    ...extra
});
const at = (stage: number, invIds: [number, number][] = [], bankIds: [number, number][] = []): QuestSnapshot =>
    snap(invIds, bankIds, { stage });
const I = PA_ITEM;

describe('bronze bar', () => {
    test('bought at Shantay while the key is still missing', () => {
        const step = sourceBronzeBar(snap());
        expect(step?.kind === 'buy' && step.item).toBe('Bronze bar');
        expect(step?.kind === 'buy' && step.shop.npc).toBe('Shantay');
    });

    test('not wanted once the key is owned', () => {
        expect(sourceBronzeBar(snap([[I.PRINCE_KEY.id, 1]]))).toBeNull();
        expect(sourceBronzeBar(snap([], [[I.PRINCE_KEY.id, 1]]))).toBeNull();
    });

    test('never wanted from stage 30 on: the key was already issued, so nothing can forge', () => {
        expect(sourceBronzeBar(at(PRINCE_STAGE.PREP_FINISHED))).toBeNull();
        expect(sourceBronzeBar(at(PRINCE_STAGE.TIED_KELI))).toBeNull();
    });
});

describe('water', () => {
    test('two jugs: one for the soft clay, one for the paste', () => {
        const step = sourceWater(snap());
        expect(step?.kind === 'buy' && step.qty).toBe(2);
        expect(step?.kind === 'buy' && step.shop.npc).toBe('Shantay');
    });

    test('one needed once the paste is made and the clay is still raw', () => {
        const step = sourceWater(snap([[I.PASTE.id, 1]]));
        expect(step?.kind === 'buy' && step.qty).toBe(1);
    });

    test('none once the paste is made and the soft clay exists', () => {
        expect(sourceWater(snap([[I.PASTE.id, 1], [I.SOFT_CLAY.id, 1]]))).toBeNull();
    });

    test('a spent jug is not re-bought: soft clay made, paste jug still held', () => {
        expect(sourceWater(snap([[I.SOFT_CLAY.id, 1], [I.JUG_OF_WATER.id, 1]]))).toBeNull();
    });

    test('at stage 30 only the paste can still want water', () => {
        expect(sourceWater(at(PRINCE_STAGE.PREP_FINISHED, [[I.PASTE.id, 1]]))).toBeNull();
        const step = sourceWater(at(PRINCE_STAGE.PREP_FINISHED));
        expect(step?.kind === 'buy' && step.qty).toBe(1);
    });
});

describe('pickaxe and clay', () => {
    test('no pickaxe -> the Rimmington spawn', () => {
        const step = sourcePickaxe(snap());
        expect(step?.kind === 'grabGround' && step.item).toBe('Bronze pickaxe');
        expect(step?.kind === 'grabGround' && step.anchor.x).toBe(2963);
    });

    test('a worn pickaxe counts', () => {
        expect(sourcePickaxe(snap([], [], { wornIds: new Set([1271]) }))).toBeNull();
    });

    test('no pickaxe wanted once the soft clay exists', () => {
        expect(sourcePickaxe(snap([[I.SOFT_CLAY.id, 1]]))).toBeNull();
    });

    test('no pickaxe or clay wanted from stage 30 on', () => {
        expect(sourcePickaxe(at(PRINCE_STAGE.PREP_FINISHED))).toBeNull();
        expect(sourceClay(at(PRINCE_STAGE.PREP_FINISHED, [[I.PICKAXE.id, 1]]))).toBeNull();
    });

    test('pickaxe held -> mine clay', () => {
        const step = sourceClay(snap([[I.PICKAXE.id, 1]]));
        expect(step?.kind === 'mineRock' && step.rock).toBe('Clay');
        expect(step?.kind === 'mineRock' && step.anchor.x).toBe(2986);
    });

    test('clay is not mined again once a print exists', () => {
        expect(sourceClay(snap([[I.PICKAXE.id, 1], [I.KEY_PRINT.id, 1]]))).toBeNull();
    });
});

describe('soft clay', () => {
    test('clay plus water -> the item-on-item craft', () => {
        const step = makeSoftClay(snap([[I.CLAY.id, 1], [I.JUG_OF_WATER.id, 1]]));
        expect(step?.kind === 'useOn' && step.item).toBe('Jug of water');
        expect(step?.kind === 'useOn' && step.target).toBe('Clay');
        expect(step?.kind === 'useOn' && step.targetKind).toBe('item');
        expect(step?.kind === 'useOn' && step.product).toBe('Soft clay');
    });

    test('null once the soft clay, print or key exists', () => {
        expect(makeSoftClay(snap([[I.SOFT_CLAY.id, 1]]))).toBeNull();
        expect(makeSoftClay(snap([[I.KEY_PRINT.id, 1]]))).toBeNull();
        expect(makeSoftClay(snap([[I.PRINCE_KEY.id, 1]]))).toBeNull();
    });

    test('null with clay but no water — the water leg runs earlier', () => {
        expect(makeSoftClay(snap([[I.CLAY.id, 1]]))).toBeNull();
    });
});

describe('key print', () => {
    test('soft clay held -> Lady Keli', () => {
        const step = takeKeyPrint(snap([[I.SOFT_CLAY.id, 1]]));
        expect(step?.kind === 'talk' && step.stop.npc).toBe('Lady Keli');
    });

    test('no soft clay -> nothing; the clay legs run first', () => {
        expect(takeKeyPrint(snap())).toBeNull();
    });

    test('null once a print or the key exists', () => {
        expect(takeKeyPrint(snap([[I.SOFT_CLAY.id, 1], [I.KEY_PRINT.id, 1]]))).toBeNull();
        expect(takeKeyPrint(snap([[I.SOFT_CLAY.id, 1], [I.PRINCE_KEY.id, 1]]))).toBeNull();
    });

    test('never taken from stage 30 on, even holding soft clay', () => {
        expect(takeKeyPrint(at(PRINCE_STAGE.PREP_FINISHED, [[I.SOFT_CLAY.id, 1]]))).toBeNull();
    });
});

describe('collectKey — the wedge', () => {
    test('key in the pack -> nothing left to do', () => {
        expect(collectKey(snap([[I.PRINCE_KEY.id, 1]]))).toBeNull();
    });

    test('a banked key is withdrawn before anyone is asked for another', () => {
        // Leela reads inv_total(bank, princeskey) too, so a banked key blocks its
        // own replacement.
        const step = collectKey(snap([], [[I.PRINCE_KEY.id, 1]]));
        expect(step?.kind).toBe('withdraw');
    });

    test('print plus bar -> the self-correcting forge-and-collect', () => {
        const step = collectKey(snap([[I.KEY_PRINT.id, 1], [I.BRONZE_BAR.id, 1]]));
        expect(step?.kind === 'custom' && step.name).toContain('Osman');
    });

    test('print without a bar -> nothing here; the bar leg runs earlier', () => {
        expect(collectKey(snap([[I.KEY_PRINT.id, 1]]))).toBeNull();
    });

    test('no print and no key at stage 20 -> nothing; the clay legs run earlier', () => {
        expect(collectKey(snap())).toBeNull();
    });

    test('a lost key at stage 30+ is re-issued by Leela, not re-forged', () => {
        for (const stage of [PRINCE_STAGE.PREP_FINISHED, PRINCE_STAGE.GUARD_DRUNK, PRINCE_STAGE.TIED_KELI]) {
            const step = collectKey(at(stage));
            expect(step?.kind).toBe('custom');
            expect(step?.kind === 'custom' && step.name).toContain('Leela');
            expect(step?.kind === 'custom' && step.name).not.toContain('Osman');
        }
    });

    test('a banked key at stage 30+ is still withdrawn first, not re-issued', () => {
        const step = collectKey(at(PRINCE_STAGE.GUARD_DRUNK, [], [[I.PRINCE_KEY.id, 1]]));
        expect(step?.kind).toBe('withdraw');
    });
});

describe('haveKey', () => {
    test('true only when the key is in the pack', () => {
        expect(haveKey(snap([[I.PRINCE_KEY.id, 1]]))).toBe(true);
        expect(haveKey(snap([], [[I.PRINCE_KEY.id, 1]]))).toBe(false);
        expect(haveKey(snap())).toBe(false);
    });
});
