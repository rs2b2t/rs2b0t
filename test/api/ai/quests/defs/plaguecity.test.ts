import { describe, expect, test } from 'bun:test';
import { PC_ITEM } from '#/bot/api/ai/quests/defs/plaguecity/areas.js';
import { PC_STAGE } from '#/bot/api/ai/quests/defs/plaguecity/journal.js';
import { decide, plaguecity } from '#/bot/api/ai/quests/defs/plaguecity/index.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

const EAST = { x: 2616, z: 3332, level: 0 };
const WEST = { x: 2540, z: 3305, level: 0 };
const SEWER = { x: 2530, z: 9703, level: 0 };

const PURSE = new Map([[PC_ITEM.COINS.id, 100_000]]);

function snapshot(o: Partial<QuestSnapshot> = {}): QuestSnapshot {
    return {
        journal: o.journal ?? 'inProgress',
        inv: o.inv ?? new Map(),
        invIds: o.invIds ?? new Map(),
        worn: o.worn ?? new Set(),
        wornIds: o.wornIds ?? new Set(),
        noProgress: 0,
        bankCoins: o.bankCoins ?? 0,
        stage: o.stage,
        progress: o.progress,
        bank: o.bank ?? new Map(),
        bankIds: o.bankIds ?? PURSE,
        bankKnown: o.bankKnown ?? true,
        tile: o.tile === undefined ? EAST : o.tile,
        freeSlots: o.freeSlots ?? 28
    };
}

const carrying = (...items: [{ id: number }, number][]): Map<number, number> =>
    new Map(items.map(([item, qty]) => [item.id, qty]));

const name = (step: QuestStep): string => (step.kind === 'custom' ? step.name : step.kind);

const KIT = carrying([PC_ITEM.SPADE, 1], [PC_ITEM.GAS_MASK, 1]);

describe('plague city decide — terminal and guard cases', () => {
    test('a complete journal on the mainland is done', () => {
        expect(decide(snapshot({ journal: 'complete' })).kind).toBe('done');
    });

    test('a complete journal holding the reward scroll reads it before finishing', () => {
        const step = decide(snapshot({ journal: 'complete', invIds: carrying([PC_ITEM.ARDOUGNE_SCROLL, 1]) }));
        expect(name(step)).toBe('read the Ardougne teleport scroll');
    });

    test('a complete journal inside West Ardougne walks out first', () => {
        expect(name(decide(snapshot({ journal: 'complete', tile: WEST })))).toBe('walk back to East Ardougne');
    });

    test('an unloaded journal waits — it is not notStarted', () => {
        expect(decide(snapshot({ journal: 'unknown' })).kind).toBe('wait');
    });

    test('an unknown tile waits rather than guessing an area', () => {
        expect(decide(snapshot({ tile: null, stage: PC_STAGE.STARTED })).kind).toBe('wait');
    });

    test('an unreadable stage waits', () => {
        expect(decide(snapshot({ stage: undefined })).kind).toBe('wait');
    });

    test('a nearly full pack banks spillover before the next pickup', () => {
        const step = decide(snapshot({ stage: PC_STAGE.STARTED, freeSlots: 2 }));
        expect(step.kind).toBe('deposit');
    });
});

describe('plague city decide — East Ardougne', () => {
    test('stage 0 draws the shopping float, then asks Edmond about his daughter', () => {
        const float = decide(snapshot({ stage: PC_STAGE.NOT_STARTED }));
        expect(float.kind === 'withdraw' && float.items[0].name).toBe(PC_ITEM.COINS.name);
        expect(float.kind === 'withdraw' && float.items[0].qty).toBe(2000);
        const ask = decide(snapshot({ stage: PC_STAGE.NOT_STARTED, invIds: carrying([PC_ITEM.COINS, 2000]) }));
        expect(name(ask)).toBe('ask Edmond about his daughter');
    });

    test('an empty bank does not park the quest on its first step', () => {
        const step = decide(snapshot({ stage: PC_STAGE.NOT_STARTED, bankIds: new Map() }));
        expect(name(step)).toBe('ask Edmond about his daughter');
    });

    test('stage 1 fetches dwellberries, then hands them to Alrena', () => {
        const fetch = decide(snapshot({ stage: PC_STAGE.STARTED }));
        expect(fetch.kind).toBe('grabGround');
        expect(fetch.kind === 'grabGround' && fetch.item).toBe(PC_ITEM.DWELLBERRIES.name);
        const give = decide(snapshot({ stage: PC_STAGE.STARTED, invIds: carrying([PC_ITEM.DWELLBERRIES, 1]) }));
        expect(name(give)).toBe('give Alrena the dwellberries');
    });

    test('banked dwellberries are withdrawn rather than picked', () => {
        const step = decide(snapshot({
            stage: PC_STAGE.STARTED,
            bankIds: new Map([[PC_ITEM.DWELLBERRIES.id, 3]])
        }));
        expect(step.kind).toBe('withdraw');
    });

    test('stage 2 asks Edmond about the way in', () => {
        expect(name(decide(snapshot({ stage: PC_STAGE.GASMASK })))).toBe('ask Edmond about the way into West Ardougne');
    });

    test('the water block gathers four buckets, fills them, then pours them', () => {
        const empty = decide(snapshot({ stage: PC_STAGE.MUD_START, bankIds: new Map() }));
        expect(empty.kind).toBe('grabGround');
        const short = decide(snapshot({ stage: PC_STAGE.MUD_START, bankIds: new Map(), invIds: carrying([PC_ITEM.BUCKET, 2]) }));
        expect(short.kind === 'grabGround' && short.item).toBe(PC_ITEM.BUCKET.name);
        const fill = decide(snapshot({ stage: PC_STAGE.MUD_START, invIds: carrying([PC_ITEM.BUCKET, 4]) }));
        expect(name(fill)).toBe('fill buckets at the Ardougne fountain');
        const pour = decide(snapshot({ stage: PC_STAGE.MUD_START, invIds: carrying([PC_ITEM.BUCKET_WATER, 4]) }));
        expect(name(pour)).toBe('pour water on the garden soil');
    });

    test('a part-filled pack tops the water up before it walks to the garden', () => {
        const step = decide(snapshot({
            stage: PC_STAGE.MUD_START,
            invIds: carrying([PC_ITEM.BUCKET_WATER, 2], [PC_ITEM.BUCKET, 2])
        }));
        expect(name(step)).toBe('fill buckets at the Ardougne fountain');
    });

    test('the milk bucket is sourced one at a time, not four', () => {
        const step = decide(snapshot({
            stage: PC_STAGE.SPOKEN_BRAVEK,
            invIds: carrying([PC_ITEM.COINS, 2000], [PC_ITEM.BUCKET, 1])
        }));
        expect(step.kind === 'useOn' && step.product).toBe(PC_ITEM.BUCKET_MILK.name);
    });

    test('a stocked bank fills the pack with buckets in one trip', () => {
        const step = decide(snapshot({
            stage: PC_STAGE.MUD_START,
            bankIds: new Map([[PC_ITEM.BUCKET.id, 9]])
        }));
        expect(step.kind === 'withdraw' && step.items[0].qty).toBe(4);
    });

    test('stage 7 buys the spade and the rope before it digs', () => {
        const spade = decide(snapshot({ stage: PC_STAGE.MUD_SOFT, bankIds: new Map() }));
        expect(name(spade)).toBe("take the spade from Edmond's house");
        const rope = decide(snapshot({
            stage: PC_STAGE.MUD_SOFT,
            invIds: carrying([PC_ITEM.SPADE, 1], [PC_ITEM.COINS, 2000])
        }));
        expect(rope.kind === 'buy' && rope.item).toBe(PC_ITEM.ROPE.name);
        const dig = decide(snapshot({
            stage: PC_STAGE.MUD_SOFT,
            invIds: carrying([PC_ITEM.SPADE, 1], [PC_ITEM.ROPE, 1])
        }));
        expect(name(dig)).toBe('drop into the Ardougne sewer');
    });

    test('stage 8 buys the rope on the mainland and ties it in the sewer', () => {
        const buy = decide(snapshot({ stage: PC_STAGE.TUNNEL, invIds: carrying([PC_ITEM.COINS, 2000]) }));
        expect(buy.kind === 'buy' && buy.item).toBe(PC_ITEM.ROPE.name);
        const tie = decide(snapshot({
            stage: PC_STAGE.TUNNEL,
            tile: SEWER,
            invIds: carrying([PC_ITEM.ROPE, 1])
        }));
        expect(name(tie)).toBe('tie the rope to the sewer grill');
    });

    test('the rope purse is withdrawn before the shop trip', () => {
        const step = decide(snapshot({ stage: PC_STAGE.TUNNEL }));
        expect(step.kind === 'withdraw' && step.items[0].name).toBe(PC_ITEM.COINS.name);
    });

    test('a rope carried into the sewer is tied without another shop trip', () => {
        const step = decide(snapshot({
            stage: PC_STAGE.ROPE_TIED,
            tile: SEWER,
            invIds: carrying([PC_ITEM.SPADE, 1])
        }));
        expect(name(step)).toBe('pull the grill off with Edmond');
    });

    test('stage 9 on the mainland digs back down rather than talking to the wrong Edmond', () => {
        const step = decide(snapshot({ stage: PC_STAGE.ROPE_TIED, invIds: carrying([PC_ITEM.SPADE, 1]) }));
        expect(name(step)).toBe('drop into the Ardougne sewer');
    });

    test('stage 28 reports back to Edmond', () => {
        expect(name(decide(snapshot({ stage: PC_STAGE.FREED_ELENA })))).toBe('tell Edmond his daughter is safe');
    });
});

describe('plague city decide — crossing into West Ardougne', () => {
    test('the picture comes off the floor of Edmond house before the crossing', () => {
        const step = decide(snapshot({ stage: PC_STAGE.PIPE_OPEN, bankIds: new Map(), invIds: KIT }));
        expect(name(step)).toBe("take the picture from Edmond's house");
    });

    test('a missing gas mask is searched out of the cupboard, never skipped', () => {
        const step = decide(snapshot({
            stage: PC_STAGE.PIPE_OPEN,
            bankIds: new Map(),
            invIds: carrying([PC_ITEM.PICTURE, 1], [PC_ITEM.SPADE, 1])
        }));
        expect(name(step)).toBe("search Alrena's cupboard for the spare gas mask");
    });

    test('a worn gas mask counts as held', () => {
        const step = decide(snapshot({
            stage: PC_STAGE.PIPE_OPEN,
            bankIds: new Map(),
            invIds: carrying([PC_ITEM.PICTURE, 1], [PC_ITEM.SPADE, 1]),
            wornIds: new Set([PC_ITEM.GAS_MASK.id])
        }));
        expect(name(step)).toBe('cross into West Ardougne');
    });

    test('the full kit crosses, and Jethick is asked once inside', () => {
        const cross = decide(snapshot({
            stage: PC_STAGE.PIPE_OPEN,
            invIds: new Map([...KIT, [PC_ITEM.PICTURE.id, 1]])
        }));
        expect(name(cross)).toBe('cross into West Ardougne');
        const ask = decide(snapshot({
            stage: PC_STAGE.PIPE_OPEN,
            tile: WEST,
            invIds: new Map([...KIT, [PC_ITEM.PICTURE.id, 1]])
        }));
        expect(name(ask)).toBe("show Jethick Elena's picture");
    });
});

describe('plague city decide — West Ardougne', () => {
    const west = (stage: number, invIds = new Map<number, number>()): QuestStep =>
        decide(snapshot({ stage, tile: WEST, invIds }));

    // Stages 20 and 21 render the same journal line, so one leg covers both.
    test('stage 20 runs the Rehnison leg with or without the book in the pack', () => {
        expect(name(west(PC_STAGE.SHOWN_PICTURE, carrying([PC_ITEM.TURNIP_BOOK, 1]))))
            .toBe('get into the Rehnison house and ask about Elena');
        expect(name(west(PC_STAGE.SHOWN_PICTURE)))
            .toBe('get into the Rehnison house and ask about Elena');
    });

    test('stages 21 to 23 walk the Rehnison chain and then the plague house door', () => {
        expect(name(west(PC_STAGE.RETURNED_BOOK))).toBe('ask the Rehnisons about Elena');
        expect(name(west(PC_STAGE.SPOKEN_PARENTS))).toBe('ask Milli what she saw');
        expect(name(west(PC_STAGE.SPOKEN_MILLI))).toBe('ask the mourner about the plague house');
    });

    test('both clearance stages run the one clerk-then-Bravek leg', () => {
        expect(name(west(PC_STAGE.NEED_CLEARANCE))).toBe('get an audience with Bravek');
        expect(name(west(PC_STAGE.SPOKEN_CLERK))).toBe('get an audience with Bravek');
    });

    test('stage 27 rescues Elena with the warrant and asks for another without one', () => {
        expect(name(west(PC_STAGE.CURED_BRAVEK, carrying([PC_ITEM.WARRANT, 1]))))
            .toBe('free Elena from the plague house');
        expect(name(west(PC_STAGE.CURED_BRAVEK))).toBe('ask Bravek for another warrant');
    });

    test('a banked warrant is withdrawn rather than asked for again', () => {
        const step = decide(snapshot({
            stage: PC_STAGE.CURED_BRAVEK,
            tile: WEST,
            bankIds: new Map([[PC_ITEM.WARRANT.id, 1]])
        }));
        expect(name(step)).toBe('walk back to East Ardougne');
        const east = decide(snapshot({
            stage: PC_STAGE.CURED_BRAVEK,
            bankIds: new Map([[PC_ITEM.WARRANT.id, 1]])
        }));
        expect(east.kind === 'withdraw' && east.items[0].name).toBe(PC_ITEM.WARRANT.name);
    });

    test('a banked book is withdrawn rather than asked for again', () => {
        const step = decide(snapshot({
            stage: PC_STAGE.SHOWN_PICTURE,
            bankIds: new Map([[PC_ITEM.TURNIP_BOOK.id, 1]])
        }));
        expect(step.kind === 'withdraw' && step.items[0].name).toBe(PC_ITEM.TURNIP_BOOK.name);
    });
});

describe('plague city decide — the hangover cure chain', () => {
    const cure = (invIds: Map<number, number>): QuestStep =>
        decide(snapshot({ stage: PC_STAGE.SPOKEN_BRAVEK, invIds }));

    const MILK = carrying([PC_ITEM.COINS, 2000], [PC_ITEM.BUCKET_MILK, 1]);

    test('the shopping float is drawn in Ardougne, before the eastward loop', () => {
        const step = cure(new Map());
        expect(step.kind === 'withdraw' && step.items[0].name).toBe(PC_ITEM.COINS.name);
        expect(step.kind === 'withdraw' && step.bank).toBeUndefined();
    });

    test('every raw ingredient is gathered before the first mix', () => {
        const bucket = cure(carrying([PC_ITEM.COINS, 2000]));
        expect(bucket.kind === 'grabGround' && bucket.item).toBe(PC_ITEM.BUCKET.name);
        const cow = cure(carrying([PC_ITEM.COINS, 2000], [PC_ITEM.BUCKET, 1]));
        expect(cow.kind === 'useOn' && cow.product).toBe(PC_ITEM.BUCKET_MILK.name);
        const grass = cure(MILK);
        expect(grass.kind === 'grabGround' && grass.item).toBe(PC_ITEM.SNAPE_GRASS.name);
        const pestle = cure(new Map([...MILK, [PC_ITEM.SNAPE_GRASS.id, 1]]));
        expect(pestle.kind === 'buy' && pestle.item).toBe(PC_ITEM.PESTLE.name);
        const bar = cure(new Map([...MILK, [PC_ITEM.SNAPE_GRASS.id, 1], [PC_ITEM.PESTLE.id, 1]]));
        expect(bar.kind === 'buy' && bar.item).toBe(PC_ITEM.CHOCOLATE_BAR.name);
    });

    test('a full ingredient set grinds, mixes and finishes in order', () => {
        const full = new Map([
            ...MILK,
            [PC_ITEM.SNAPE_GRASS.id, 1],
            [PC_ITEM.PESTLE.id, 1],
            [PC_ITEM.CHOCOLATE_BAR.id, 1]
        ]);
        const grind = cure(full);
        expect(grind.kind === 'useOn' && grind.product).toBe(PC_ITEM.CHOCOLATE_DUST.name);
        const mix = cure(carrying([PC_ITEM.CHOCOLATE_DUST, 1], [PC_ITEM.BUCKET_MILK, 1]));
        expect(mix.kind === 'useOn' && mix.product).toBe(PC_ITEM.CHOCOLATY_MILK.name);
        const finish = cure(carrying([PC_ITEM.CHOCOLATY_MILK, 1], [PC_ITEM.SNAPE_GRASS, 1]));
        expect(finish.kind === 'useOn' && finish.product).toBe(PC_ITEM.HANGOVER_CURE.name);
    });

    test('a lost ingredient is re-sourced rather than mixed with nothing', () => {
        const grass = cure(carrying([PC_ITEM.CHOCOLATY_MILK, 1]));
        expect(grass.kind === 'grabGround' && grass.item).toBe(PC_ITEM.SNAPE_GRASS.name);
        const milk = cure(carrying([PC_ITEM.CHOCOLATE_DUST, 1], [PC_ITEM.BUCKET, 1]));
        expect(milk.kind === 'useOn' && milk.product).toBe(PC_ITEM.BUCKET_MILK.name);
    });

    test('a finished cure is carried to Bravek', () => {
        const step = decide(snapshot({
            stage: PC_STAGE.SPOKEN_BRAVEK,
            tile: WEST,
            invIds: carrying([PC_ITEM.HANGOVER_CURE, 1])
        }));
        expect(name(step)).toBe('give Bravek the hangover cure');
    });
});

describe('plaguecity module', () => {
    test('it owns its inventory and banks in north Ardougne', () => {
        expect(plaguecity.record.id).toBe('elena');
        expect(plaguecity.ownsInventory).toBe(true);
        expect(plaguecity.record.items).toEqual([]);
        expect(plaguecity.bank).toEqual({ x: 2616, z: 3332, level: 0 } as never);
    });
});
