import { describe, expect, test } from 'bun:test';

import { KS_ID } from '#/bot/api/ai/quests/defs/knightssword/areas.js';
import {
    COIN_LOW,
    ORE_PER_TRIP,
    ironBarsAt,
    kit,
    pickaxeAt,
    pie
} from '#/bot/api/ai/quests/defs/knightssword/supplies.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

const COINS = 995;
const BRONZE_PICKAXE = 1265;
const RUNE_PICKAXE = 1275;
const MAX_MINING = 70;

export function snap(invIds: [number, number][] = [], options: {
    bankIds?: [number, number][];
    bankKnown?: boolean;
    tile?: QuestSnapshot['tile'];
} = {}): QuestSnapshot {
    return {
        journal: 'inProgress',
        inv: new Map(),
        // Every case that is not about the float carries one, so the coin top-up
        // never masks the step under test.
        invIds: new Map([[COINS, COIN_LOW * 2], ...invIds]),
        worn: new Set(),
        wornIds: new Set(),
        noProgress: 0,
        bankCoins: 2_000_000,
        bank: new Map(),
        bankIds: new Map(options.bankIds ?? []),
        bankKnown: options.bankKnown ?? true,
        tile: options.tile ?? { x: 2946, z: 3369, level: 0 },
        freeSlots: 20
    };
}

const withdrawn = (step: QuestStep): number[] =>
    step.kind === 'withdraw' ? step.items.map(i => i.id ?? -1) : [];

const lobsters = (held: number) => ({ name: 'Lobster', held, target: 14, low: 4 });

describe('kit', () => {
    test('scans the bank before withdrawing anything it has not seen', () => {
        expect(kit(snap([[COINS, 3]], { bankKnown: false }))?.kind).toBe('scanBank');
    });

    test('withdraws a coin float when the pack is nearly empty', () => {
        expect(withdrawn(kit(snap([[COINS, 3]]))!)).toContain(COINS);
    });

    test('does not re-withdraw after a small purchase', () => {
        // The float is a threshold, not a target: topping up to an exact balance
        // sends the bot back to a booth after every single item bought.
        expect(kit(snap([[COINS, COIN_LOW + 1]]))).toBeNull();
    });

    test('withdraws food up to target when the pack is short', () => {
        const step = kit(snap(), lobsters(0));
        expect(step).toMatchObject({ kind: 'withdraw' });
        expect(step!.kind === 'withdraw' && step.items).toContainEqual({ name: 'Lobster', qty: 14 });
    });

    test('leaves a stocked pack alone', () => {
        expect(kit(snap(), lobsters(14))).toBeNull();
    });

    test('does not top up on every bite eaten', () => {
        expect(kit(snap(), lobsters(5))).toBeNull();
    });

    test('never re-banks for food from underground', () => {
        // Preparation stops at the door: a top-up that fires mid-dungeon walks
        // the bot back out of it.
        const below = snap([], { tile: { x: 3049, z: 9566, level: 0 } });
        expect(kit(below, lobsters(0))).toBeNull();
    });
});

describe('redberry pie chain', () => {
    test('scans the bank before buying anything', () => {
        expect(pie(snap([], { bankKnown: false })).kind).toBe('scanBank');
    });

    test('withdraws a banked pie rather than baking one', () => {
        const step = pie(snap([], { bankIds: [[KS_ID.REDBERRY_PIE, 1]] }));
        expect(withdrawn(step)).toContain(KS_ID.REDBERRY_PIE);
    });

    test('grabs the pie dish from the Varrock kitchen when none is held', () => {
        const step = pie(snap([[KS_ID.POT_OF_FLOUR, 1], [KS_ID.REDBERRIES, 1], [KS_ID.BUCKET_OF_WATER, 1]]));
        expect(step).toMatchObject({ kind: 'grabGround', item: 'Pie dish' });
    });

    test('withdraws a banked pie dish instead of walking to Varrock', () => {
        const step = pie(snap([[KS_ID.BUCKET_OF_WATER, 1]], { bankIds: [[KS_ID.PIE_DISH, 1]] }));
        expect(withdrawn(step)).toContain(KS_ID.PIE_DISH);
    });

    test('does the whole water leg before leaving for Port Sarim', () => {
        // Why: the bucket and sink are Varrock errands while the flour, berries and range are Port Sarim ones, so interleaving costs a 360-tile round trip.
        const empty = pie(snap());
        expect(empty).toMatchObject({ kind: 'buy', item: 'Bucket' });
        const withBucket = pie(snap([[KS_ID.BUCKET, 1]]));
        expect(withBucket).toMatchObject({ kind: 'custom', name: 'fill the bucket' });
    });

    test('buys flour at Wydin when the dish and water are in hand', () => {
        const step = pie(snap([[KS_ID.PIE_DISH, 1], [KS_ID.BUCKET_OF_WATER, 1], [KS_ID.REDBERRIES, 1]]));
        expect(step).toMatchObject({ kind: 'buy', item: 'Pot of flour' });
    });

    test('buys redberries when everything else is in hand', () => {
        const step = pie(snap([[KS_ID.PIE_DISH, 1], [KS_ID.BUCKET_OF_WATER, 1], [KS_ID.POT_OF_FLOUR, 1]]));
        expect(step).toMatchObject({ kind: 'buy', item: 'Redberries' });
    });

    test('buys a bucket before trying to fill one', () => {
        const step = pie(snap([[KS_ID.PIE_DISH, 1], [KS_ID.POT_OF_FLOUR, 1], [KS_ID.REDBERRIES, 1]]));
        expect(step).toMatchObject({ kind: 'buy', item: 'Bucket' });
    });

    test('fills a held bucket at the fountain', () => {
        const step = pie(snap([
            [KS_ID.PIE_DISH, 1], [KS_ID.POT_OF_FLOUR, 1], [KS_ID.REDBERRIES, 1], [KS_ID.BUCKET, 1]
        ]));
        expect(step).toMatchObject({ kind: 'custom', name: 'fill the bucket' });
    });

    test('mixes dough once flour and water are both held', () => {
        const step = pie(snap([
            [KS_ID.PIE_DISH, 1], [KS_ID.POT_OF_FLOUR, 1], [KS_ID.REDBERRIES, 1], [KS_ID.BUCKET_OF_WATER, 1]
        ]));
        expect(step).toMatchObject({ kind: 'custom', name: 'mix pastry dough' });
    });

    test('makes the shell from dough and dish', () => {
        const step = pie(snap([[KS_ID.PASTRY_DOUGH, 1], [KS_ID.PIE_DISH, 1], [KS_ID.REDBERRIES, 1]]));
        expect(step).toMatchObject({ kind: 'useOn', product: 'Pie shell' });
    });

    test('fills the shell with redberries', () => {
        const step = pie(snap([[KS_ID.PIE_SHELL, 1], [KS_ID.REDBERRIES, 1]]));
        expect(step).toMatchObject({ kind: 'useOn', product: 'Uncooked berry pie' });
    });

    test('buys more redberries when the shell is made but the berries are gone', () => {
        const step = pie(snap([[KS_ID.PIE_SHELL, 1]]));
        expect(step).toMatchObject({ kind: 'buy', item: 'Redberries' });
    });

    test('cooks the uncooked pie on a range', () => {
        const step = pie(snap([[KS_ID.UNCOOKED_PIE, 1]]));
        expect(step).toMatchObject({ kind: 'custom', name: 'cook the redberry pie' });
    });

    test('empties a burnt pie instead of fetching another dish', () => {
        // The dish is trapped inside the ruined pie, so re-deriving the chain
        // would walk all the way back to the Varrock spawn for a new one.
        const step = pie(snap([[KS_ID.BURNT_PIE, 1]]));
        expect(step).toMatchObject({ kind: 'custom', name: 'empty the burnt dish' });
    });

    test('a held pie ends the chain', () => {
        expect(pie(snap([[KS_ID.REDBERRY_PIE, 1]])).kind).toBe('wait');
    });
});

describe('pickaxe sourcing', () => {
    test('nothing to do when a usable one is already held', () => {
        expect(pickaxeAt(snap([[BRONZE_PICKAXE, 1]]), MAX_MINING)).toBeNull();
    });

    test('a worn pickaxe counts as held', () => {
        const worn = { ...snap(), wornIds: new Set([BRONZE_PICKAXE]) };
        expect(pickaxeAt(worn, MAX_MINING)).toBeNull();
    });

    test('scans an unknown bank before walking to a spawn', () => {
        expect(pickaxeAt(snap([], { bankKnown: false }), MAX_MINING)?.kind).toBe('scanBank');
    });

    test('withdraws the best banked pickaxe the level allows', () => {
        const step = pickaxeAt(snap([], { bankIds: [[BRONZE_PICKAXE, 1], [RUNE_PICKAXE, 1]] }), MAX_MINING);
        expect(withdrawn(step!)).toContain(RUNE_PICKAXE);
    });

    test('ignores a banked pickaxe the level cannot swing', () => {
        // Rune needs 41 mining; withdrawing it at the quest floor of 10 is a
        // wasted bank trip and an unusable tool.
        const step = pickaxeAt(snap([], { bankIds: [[RUNE_PICKAXE, 1]] }), 10);
        expect(step).toMatchObject({ kind: 'grabGround', item: 'Bronze pickaxe' });
    });

    test('falls back to the Rimmington spawn with an empty bank', () => {
        expect(pickaxeAt(snap(), MAX_MINING)).toMatchObject({ kind: 'grabGround', item: 'Bronze pickaxe' });
    });
});

describe('iron bar chain', () => {
    const withPick = (extra: [number, number][] = []) => snap([[BRONZE_PICKAXE, 1], ...extra]);

    test('scans an unknown bank first', () => {
        expect(ironBarsAt(snap([], { bankKnown: false }), MAX_MINING).kind).toBe('scanBank');
    });

    test('withdraws banked bars rather than smelting', () => {
        const step = ironBarsAt(snap([], { bankIds: [[KS_ID.IRON_BAR, 2]] }), MAX_MINING);
        expect(withdrawn(step)).toContain(KS_ID.IRON_BAR);
    });

    test('withdraws only the shortfall', () => {
        const step = ironBarsAt(snap([[KS_ID.IRON_BAR, 1]], { bankIds: [[KS_ID.IRON_BAR, 5]] }), MAX_MINING);
        expect(step.kind === 'withdraw' && step.items[0].qty).toBe(1);
    });

    test('sources a pickaxe before heading for the rocks', () => {
        expect(ironBarsAt(snap(), MAX_MINING)).toMatchObject({ kind: 'grabGround', item: 'Bronze pickaxe' });
    });

    test('mines a batch of ore once a pickaxe is held', () => {
        expect(ironBarsAt(withPick(), MAX_MINING)).toMatchObject({
            kind: 'mineRock',
            rock: 'Iron',
            qty: ORE_PER_TRIP
        });
    });

    test('smelts once the whole batch is mined', () => {
        const step = ironBarsAt(withPick([[KS_ID.IRON_ORE, ORE_PER_TRIP]]), MAX_MINING);
        expect(step).toMatchObject({ kind: 'custom', name: 'smelt iron bars' });
    });

    test('keeps mining on a part-built batch', () => {
        // mineRock ignores its qty and mines one ore per invocation, so
        // smelting on the first ore would walk Rimmington -> furnace eight times.
        for (const ore of [1, ORE_PER_TRIP - 1]) {
            expect(ironBarsAt(withPick([[KS_ID.IRON_ORE, ore]]), MAX_MINING))
                .toMatchObject({ kind: 'mineRock', rock: 'Iron' });
        }
    });

    test('one bar and no ore goes back to the rocks', () => {
        // Iron fails to refine half the time, so the loop counts bars, never ore.
        expect(ironBarsAt(withPick([[KS_ID.IRON_BAR, 1]]), MAX_MINING)).toMatchObject({ kind: 'mineRock' });
    });

    test('two bars ends the chain', () => {
        expect(ironBarsAt(withPick([[KS_ID.IRON_BAR, 2]]), MAX_MINING).kind).toBe('wait');
    });

    test('the batch covers two bars with room to spare', () => {
        // P(fewer than 2 successes in 8 coin flips) = 9/256.
        expect(ORE_PER_TRIP).toBeGreaterThanOrEqual(8);
    });
});
