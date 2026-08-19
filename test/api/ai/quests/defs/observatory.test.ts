import { describe, expect, test } from 'bun:test';

import { OBS_ID, OBS_STAGE, OBS_TILE } from '#/bot/api/ai/quests/defs/observatory/areas.js';
import { decide, observatory } from '#/bot/api/ai/quests/defs/observatory/index.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

interface Options {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    inv?: Record<number, number>;
    invNames?: string[];
    bank?: Record<number, number>;
    bankKnown?: boolean;
    freeSlots?: number;
}

function snap(o: Options = {}): QuestSnapshot {
    const bank = new Map(Object.entries(o.bank ?? {}).map(([id, n]) => [Number(id), n]));
    return {
        journal: o.journal ?? 'inProgress',
        stage: o.stage,
        inv: new Map((o.invNames ?? []).map(n => [n.toLowerCase(), 1])),
        invIds: new Map(Object.entries(o.inv ?? {}).map(([id, n]) => [Number(id), n])),
        worn: new Set(),
        noProgress: 0,
        bankCoins: 100_000,
        bank: new Map(),
        bankIds: bank,
        bankKnown: o.bankKnown ?? true,
        freeSlots: o.freeSlots ?? 20
    };
}

const PICKAXE = { invNames: ['bronze pickaxe'] };

const READY = {
    [OBS_ID.PLANK]: 3,
    [OBS_ID.BRONZE_BAR]: 1,
    [OBS_ID.MOLTEN_GLASS]: 1,
    [OBS_ID.LENS_MOULD]: 1
};

function step(o: Options): QuestStep {
    return decide(snap(o));
}

describe('observatory decide', () => {
    test('a green journal is done', () => {
        expect(step({ journal: 'complete' })).toEqual({ kind: 'done' });
    });

    test('an unloaded quest list waits rather than restarting the quest', () => {
        expect(step({ journal: 'unknown' })).toEqual({ kind: 'wait', reason: 'quest journal not loaded' });
    });

    test('a red journal opens with the professor', () => {
        const s = step({ journal: 'notStarted' });
        expect(s.kind).toBe('talk');
        expect(s.kind === 'talk' && s.stop.anchor).toEqual(OBS_TILE.PROFESSOR);
    });

    test('an unreadable stage waits', () => {
        expect(step({ stage: undefined }).kind).toBe('wait');
    });

    test('a stage past complete is done', () => {
        expect(step({ stage: OBS_STAGE.COMPLETE })).toEqual({ kind: 'done' });
    });
});

// Why: the errand order is the map, not the quest — every one of these fixes a leg of the single loop the bot walks.
describe('observatory errand order', () => {
    const empty = { stage: OBS_STAGE.STARTED };

    test('an unread bank is checked before any walk', () => {
        expect(step({ ...empty, bankKnown: false })).toEqual({ kind: 'scanBank' });
    });

    test('the sand by the reception comes first', () => {
        const s = step(empty);
        expect(s.kind === 'grabGround' && s.item).toBe('Bucket of sand');
        expect(s.kind === 'grabGround' && s.anchor).toEqual(OBS_TILE.SAND_SPAWN);
    });

    test('the pickaxe and the seam come next', () => {
        const s = step({ ...empty, inv: { [OBS_ID.BUCKET_OF_SAND]: 1 } });
        expect(s).toMatchObject({ kind: 'buy', item: 'Bronze pickaxe' });
    });

    test('the planks come after the ore', () => {
        const s = step({
            ...empty,
            inv: { [OBS_ID.BUCKET_OF_SAND]: 1, [OBS_ID.COPPER_ORE]: 1, [OBS_ID.TIN_ORE]: 1 },
            ...PICKAXE
        });
        expect(s.kind === 'grabGround' && s.item).toBe('Plank');
    });

    test('the seaweed shore comes after the planks', () => {
        const s = step({
            ...empty,
            inv: { [OBS_ID.BUCKET_OF_SAND]: 1, [OBS_ID.COPPER_ORE]: 1, [OBS_ID.TIN_ORE]: 1, [OBS_ID.PLANK]: 3 },
            ...PICKAXE
        });
        expect(s.kind === 'grabGround' && s.item).toBe('Seaweed');
        expect(s.kind === 'grabGround' && s.anchor).toEqual(OBS_TILE.SEAWEED_SPAWN);
    });

    test('held seaweed goes on the range on the way home', () => {
        const s = step({
            ...empty,
            inv: { [OBS_ID.BUCKET_OF_SAND]: 1, [OBS_ID.PLANK]: 3, [OBS_ID.SEAWEED]: 1, [OBS_ID.BRONZE_BAR]: 1 }
        });
        expect(s).toMatchObject({ kind: 'custom', name: 'cook seaweed into soda ash' });
    });

    test('the glass is smelted before the bar, so one furnace visit does both', () => {
        const s = step({
            ...empty,
            inv: {
                [OBS_ID.BUCKET_OF_SAND]: 1, [OBS_ID.SODA_ASH]: 1, [OBS_ID.PLANK]: 3,
                [OBS_ID.COPPER_ORE]: 1, [OBS_ID.TIN_ORE]: 1
            },
            ...PICKAXE
        });
        expect(s).toMatchObject({ kind: 'custom', name: 'smelt molten glass' });
    });

    test('the bar follows on the same visit', () => {
        const s = step({
            ...empty,
            inv: {
                [OBS_ID.MOLTEN_GLASS]: 1, [OBS_ID.PLANK]: 3,
                [OBS_ID.COPPER_ORE]: 1, [OBS_ID.TIN_ORE]: 1
            },
            ...PICKAXE
        });
        expect(s).toMatchObject({ kind: 'custom', name: 'smelt a bronze bar' });
    });

    test('the cavern is last, once nothing above ground is outstanding', () => {
        const s = step({
            ...empty,
            inv: { [OBS_ID.MOLTEN_GLASS]: 1, [OBS_ID.PLANK]: 3, [OBS_ID.BRONZE_BAR]: 1 }
        });
        expect(s).toMatchObject({ kind: 'custom', name: 'fetch the lens mould' });
    });
});

describe('observatory bank-first sourcing', () => {
    const empty = { stage: OBS_STAGE.STARTED };

    const mined = { [OBS_ID.BUCKET_OF_SAND]: 1, [OBS_ID.COPPER_ORE]: 1, [OBS_ID.TIN_ORE]: 1 };

    test('banked planks are withdrawn rather than walked to', () => {
        const s = step({ ...empty, inv: mined, bank: { [OBS_ID.PLANK]: 5 }, ...PICKAXE });
        expect(s).toEqual({ kind: 'withdraw', items: [{ name: 'Plank', qty: 3, id: OBS_ID.PLANK }] });
    });

    test('a part-filled bank is topped up rather than re-withdrawn', () => {
        const s = step({
            ...empty,
            inv: { ...mined, [OBS_ID.PLANK]: 2 },
            bank: { [OBS_ID.PLANK]: 5 },
            ...PICKAXE
        });
        expect(s.kind === 'withdraw' && s.items[0].qty).toBe(1);
    });

    test('a banked bar skips the counter and the seam', () => {
        const s = step({ ...empty, bank: { [OBS_ID.BRONZE_BAR]: 1, [OBS_ID.MOLTEN_GLASS]: 1 } });
        expect(s.kind === 'withdraw' && s.items[0].name).toBe('Molten glass');
    });

    test('banked glass skips the whole glass chain', () => {
        const s = step({ ...empty, bank: { [OBS_ID.MOLTEN_GLASS]: 1 } });
        expect(s.kind === 'withdraw' && s.items[0].name).toBe('Molten glass');
    });

    test('a banked pickaxe is withdrawn rather than bought', () => {
        const s = step({ ...empty, inv: { [OBS_ID.BUCKET_OF_SAND]: 1 }, bank: { [OBS_ID.BRONZE_PICKAXE]: 1 } });
        expect(s.kind === 'withdraw' && s.items[0].name).toBe('Bronze pickaxe');
    });

    test('a banked mould skips the cavern', () => {
        const s = step({
            ...empty,
            inv: { [OBS_ID.MOLTEN_GLASS]: 1, [OBS_ID.PLANK]: 3, [OBS_ID.BRONZE_BAR]: 1 },
            bank: { [OBS_ID.LENS_MOULD]: 1 }
        });
        expect(s.kind === 'withdraw' && s.items[0].name).toBe('Lens mould');
    });

    test('copper comes before tin', () => {
        const s = step({ ...empty, inv: { [OBS_ID.BUCKET_OF_SAND]: 1 }, ...PICKAXE });
        expect(s).toEqual({
            kind: 'mineRock', rock: 'Copper ore', item: 'Copper ore', qty: 1, anchor: OBS_TILE.MINE
        });
    });

    test('tin follows the copper', () => {
        const s = step({
            ...empty,
            inv: { [OBS_ID.BUCKET_OF_SAND]: 1, [OBS_ID.COPPER_ORE]: 1 },
            ...PICKAXE
        });
        expect(s.kind === 'mineRock' && s.item).toBe('Tin ore');
    });
});

describe('observatory lens mould and hand-overs', () => {

    test('a full pack is banked before the stage that hands the glass back', () => {
        const s = step({ stage: OBS_STAGE.GIVEN_GLASS, inv: { [OBS_ID.LENS_MOULD]: 1 }, freeSlots: 0 });
        expect(s.kind).toBe('deposit');
    });

    test('a full load walks back to the professor', () => {
        expect(step({ stage: OBS_STAGE.STARTED, inv: READY })).toMatchObject({ kind: 'talk' });
        expect(step({ stage: OBS_STAGE.GIVEN_PLANKS, inv: READY })).toMatchObject({ kind: 'talk' });
        expect(step({ stage: OBS_STAGE.GIVEN_BRONZE, inv: READY })).toMatchObject({ kind: 'talk' });
        expect(step({ stage: OBS_STAGE.GIVEN_GLASS, inv: READY })).toMatchObject({ kind: 'talk' });
    });

    test('the stage past the mould never re-fetches the planks or the bar', () => {
        const s = step({
            stage: OBS_STAGE.GIVEN_MOULD,
            inv: { [OBS_ID.MOLTEN_GLASS]: 1, [OBS_ID.LENS_MOULD]: 1 }
        });
        expect(s).toMatchObject({ kind: 'useOn', item: 'Lens mould', target: 'Molten glass', product: 'Lens' });
    });

    test('a lost glass at the lens stage is remade rather than asked for', () => {
        const s = step({ stage: OBS_STAGE.GIVEN_MOULD, inv: { [OBS_ID.LENS_MOULD]: 1 } });
        expect(s.kind === 'grabGround' && s.item).toBe('Bucket of sand');
    });

    test('the lens stage never re-fetches the planks or the ore', () => {
        const s = step({ stage: OBS_STAGE.GIVEN_MOULD, inv: { [OBS_ID.LENS_MOULD]: 1, [OBS_ID.BUCKET_OF_SAND]: 1 } });
        expect(s.kind === 'grabGround' && s.item).toBe('Seaweed');
    });

    test('a lost mould at the lens stage sends the bot back to the sack', () => {
        const s = step({ stage: OBS_STAGE.GIVEN_MOULD, inv: { [OBS_ID.MOLTEN_GLASS]: 1 } });
        expect(s).toMatchObject({ kind: 'custom', name: 'fetch the lens mould' });
    });

    test('a finished lens goes to the professor', () => {
        const s = step({ stage: OBS_STAGE.GIVEN_MOULD, inv: { [OBS_ID.LENS]: 1 } });
        expect(s).toMatchObject({ kind: 'talk' });
    });

    test('the last stage is the telescope', () => {
        expect(step({ stage: OBS_STAGE.SENT_TELESCOPE }))
            .toMatchObject({ kind: 'custom', name: 'look through the telescope' });
    });
});

describe('observatory module', () => {
    test('is wired to its record and the Ardougne bank', () => {
        expect(observatory.record.id).toBe('itgronigen');
        expect(observatory.record.questPoints).toBe(2);
        expect(observatory.bank).toEqual(OBS_TILE.BANK);
    });

    test('keeps every intermediate through a spillover deposit', () => {
        for (const item of ['plank', 'bronze bar', 'molten glass', 'lens mould', 'lens', 'keep key',
            'seaweed', 'soda ash', 'bucket of sand', 'copper ore', 'tin ore', 'pickaxe']) {
            expect(observatory.tools).toContain(item);
        }
    });
});
