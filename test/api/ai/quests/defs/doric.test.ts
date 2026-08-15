import { describe, expect, test } from 'bun:test';
import { decide, decideForMiningLevel, doric, DORIC_ITEM, DORIC_PICKAXES, DORIC_STAGE, parseDoricJournal } from '#/bot/api/ai/quests/defs/doric.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

interface ItemStack {
    name: string;
    id: number;
    qty: number;
}

interface SnapshotOptions {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    inv?: readonly ItemStack[];
    worn?: readonly Omit<ItemStack, 'qty'>[];
    bank?: readonly ItemStack[];
    bankKnown?: boolean;
    freeSlots?: number;
}

const stack = (item: { name: string; id: number }, qty = 1): ItemStack => ({ ...item, qty });
const fake = (name: string, id: number, qty: number): ItemStack => ({ name, id, qty });

function nameCounts(items: readonly ItemStack[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const item of items) {
        const name = item.name.toLowerCase();
        counts.set(name, (counts.get(name) ?? 0) + item.qty);
    }
    return counts;
}

function idCounts(items: readonly ItemStack[]): Map<number, number> {
    const counts = new Map<number, number>();
    for (const item of items) {
        counts.set(item.id, (counts.get(item.id) ?? 0) + item.qty);
    }
    return counts;
}

function snap(options: SnapshotOptions = {}): QuestSnapshot {
    const inv = options.inv ?? [];
    const worn = options.worn ?? [];
    const bank = options.bank ?? [];
    return {
        journal: options.journal ?? 'inProgress',
        inv: nameCounts(inv),
        invIds: idCounts(inv),
        worn: new Set(worn.map(item => item.name)),
        wornIds: new Set(worn.map(item => item.id)),
        noProgress: 0,
        bankCoins: 2_000_000,
        stage: options.stage ?? DORIC_STAGE.STARTED,
        bank: nameCounts(bank),
        bankIds: idCounts(bank),
        bankKnown: options.bankKnown ?? true,
        freeSlots: options.freeSlots ?? Math.max(0, 28 - inv.reduce((sum, item) => sum + item.qty, 0))
    };
}

function customName(step: QuestStep): string | null {
    return step.kind === 'custom' ? step.name : null;
}

function expectCustom(step: QuestStep, purpose: RegExp): void {
    expect(step.kind).toBe('custom');
    expect(customName(step)).toMatch(purpose);
}

function expectDoricTalk(step: QuestStep): void {
    expect(['talk', 'custom']).toContain(step.kind);
    if (step.kind === 'talk') {
        expect(step.stop.npc).toBe('Doric');
    } else if (step.kind === 'custom') {
        expect(step.name).toMatch(/Doric/i);
    }
}

function expectWithdrawal(step: QuestStep, items: { name: string; id: number; qty: number }[]): void {
    expect(step.kind).toBe('withdraw');
    if (step.kind === 'withdraw') {
        expect(step.items).toEqual(items);
        expect(step.bank).toBeDefined();
    }
}

const BRONZE_PICK = stack(DORIC_ITEM.BRONZE_PICKAXE);
const IRON_PICK = { name: 'Iron pickaxe', id: 1267 } as const;
const STEEL_PICK = { name: 'Steel pickaxe', id: 1269 } as const;
const MITHRIL_PICK = { name: 'Mithril pickaxe', id: 1273 } as const;
const ADAMANT_PICK = { name: 'Adamant pickaxe', id: 1271 } as const;
const RUNE_PICK = { name: 'Rune pickaxe', id: 1275 } as const;

describe("Doric's Quest journal stage parsing", () => {
    const cases = [
        ['@dbl@I can start this quest by talking to @dre@Doric@dbl@ at his home|north of @dre@Falador@dbl@.', DORIC_STAGE.NOT_STARTED],
        ['@str@I have spoken to @dre@Doric||@dbl@I need to collect some items and bring them to @dre@Doric|@dre@6 Clay|@dre@4 Copper Ore|@dre@2 Iron Ore|', DORIC_STAGE.STARTED],
        ["@str@I have spoken to @dre@Doric||@str@I have collected some Clay, Copper Ore, and Iron Ore.||@str@Doric rewarded me for all my hard work.|@str@I can now use Doric's Anvils whenever I want.|@red@QUEST COMPLETE!", DORIC_STAGE.COMPLETE]
    ] as const;

    for (const [text, stage] of cases) {
        test(`maps the rendered journal to exact stage ${stage}`, () => {
            expect(parseDoricJournal(text)).toBe(stage);
        });
    }

    test('keeps the active stage when journal material lines are crossed out dynamically', () => {
        const text = '@str@I have spoken to @dre@Doric||@dbl@I need to collect some items and bring them to @dre@Doric|@str@6 Clay|@str@4 Copper Ore|@dre@2 Iron Ore|';
        expect(parseDoricJournal(text)).toBe(DORIC_STAGE.STARTED);
    });

    test('does not infer a stage from loading or unrelated text', () => {
        expect(parseDoricJournal(["Doric's Quest", 'Loading…'])).toBeUndefined();
        expect(parseDoricJournal('I should collect some ore for a smith.')).toBeUndefined();
    });
});

describe("Doric's Quest authoritative stage routing", () => {
    test('stage 0 starts the quest with Doric', () => {
        expectDoricTalk(decide(snap({ stage: DORIC_STAGE.NOT_STARTED })));
    });

    test('stage 100 and an authoritative complete journal are no-ops', () => {
        expect(decideForMiningLevel(snap({ stage: DORIC_STAGE.COMPLETE }), 1)).toEqual({ kind: 'done' });
        expect(decide(snap({ stage: DORIC_STAGE.NOT_STARTED, journal: 'complete' }))).toEqual({ kind: 'done' });
    });

    test('waits safely for an unknown journal, unavailable stage, or unknown stage', () => {
        expect(decide(snap({ journal: 'unknown' }))).toEqual({ kind: 'wait', reason: 'quest journal not loaded' });

        const unavailable = snap();
        unavailable.stage = undefined;
        const unavailableStep = decide(unavailable);
        expect(unavailableStep.kind).toBe('wait');
        expect(unavailableStep.kind === 'wait' && unavailableStep.reason).toMatch(/Doric.*stage unavailable/i);

        const unknownStep = decideForMiningLevel(snap({ stage: 70 }), 15);
        expect(unknownStep.kind).toBe('wait');
        expect(unknownStep.kind === 'wait' && unknownStep.reason).toMatch(/unrecognized.*Doric.*70/i);
    });
});

describe("Doric's Quest exact item and bank recovery decisions", () => {
    test('scans an unknown bank before mining, buying, or collecting a tool', () => {
        const step = decideForMiningLevel(snap({ bankKnown: false }), 1);
        expect(step.kind).toBe('scanBank');
        expect(step.kind === 'scanBank' && step.bank).toBeDefined();
    });

    test('withdraws all three exact material requirements in one bank visit', () => {
        const step = decideForMiningLevel(
            snap({
                bank: [stack(DORIC_ITEM.CLAY, 20), stack(DORIC_ITEM.COPPER, 20), stack(DORIC_ITEM.IRON, 20)]
            }),
            1
        );
        expectWithdrawal(step, [
            { ...DORIC_ITEM.CLAY, qty: DORIC_ITEM.CLAY.qty },
            { ...DORIC_ITEM.COPPER, qty: DORIC_ITEM.COPPER.qty },
            { ...DORIC_ITEM.IRON, qty: DORIC_ITEM.IRON.qty }
        ]);
    });

    test('withdraws only deficits from a partial inventory and mixed bank', () => {
        const step = decideForMiningLevel(
            snap({
                inv: [stack(DORIC_ITEM.CLAY, 2), stack(DORIC_ITEM.COPPER, 1)],
                bank: [stack(DORIC_ITEM.CLAY, 4), stack(DORIC_ITEM.COPPER, 3), stack(DORIC_ITEM.IRON, 2), fake('Clay', 9_434, 50)]
            }),
            1
        );
        expectWithdrawal(step, [
            { ...DORIC_ITEM.CLAY, qty: 4 },
            { ...DORIC_ITEM.COPPER, qty: 3 },
            { ...DORIC_ITEM.IRON, qty: 2 }
        ]);
    });

    test('withdraws banked iron at Mining 1 instead of needlessly training to Mining 15', () => {
        const step = decideForMiningLevel(
            snap({
                inv: [stack(DORIC_ITEM.CLAY, 6), stack(DORIC_ITEM.COPPER, 4), BRONZE_PICK],
                bank: [stack(DORIC_ITEM.IRON, 2)]
            }),
            1
        );
        expectWithdrawal(step, [{ ...DORIC_ITEM.IRON, qty: 2 }]);
    });

    test('same-name inventory collisions do not satisfy exact quest items or tools', () => {
        const step = decideForMiningLevel(
            snap({
                inv: [fake('Clay', 9_434, 6), fake('Copper ore', 9_436, 4), fake('Iron ore', 9_440, 2), fake('Bronze pickaxe', 9_265, 1)]
            }),
            15
        );
        expectCustom(step, /(?:acquire|collect|source|ground).*(?:bronze )?pickaxe/i);
    });

    test('same-name bank collisions are neither withdrawn nor counted as quest progress', () => {
        const step = decideForMiningLevel(
            snap({
                inv: [stack(DORIC_ITEM.CLAY, 6), stack(DORIC_ITEM.COPPER, 4), BRONZE_PICK],
                bank: [fake('Iron ore', 9_440, 2)]
            }),
            15
        );
        expectCustom(step, /mine.*iron/i);
    });
});

describe("Doric's Quest pickaxe sourcing", () => {
    test('exports every exact pickaxe ID in best-first usable-tier order', () => {
        expect(DORIC_PICKAXES).toEqual([
            { ...RUNE_PICK, level: 41 },
            { ...ADAMANT_PICK, level: 31 },
            { ...MITHRIL_PICK, level: 21 },
            { ...STEEL_PICK, level: 6 },
            { ...IRON_PICK, level: 1 },
            { ...DORIC_ITEM.BRONZE_PICKAXE, level: 1 }
        ]);
    });

    const usableTierCases: Array<{
        level: number;
        available: Array<{ name: string; id: number }>;
        expected: { name: string; id: number };
    }> = [
        { level: 1, available: [RUNE_PICK, STEEL_PICK, IRON_PICK, DORIC_ITEM.BRONZE_PICKAXE], expected: IRON_PICK },
        { level: 14, available: [RUNE_PICK, MITHRIL_PICK, STEEL_PICK, IRON_PICK], expected: STEEL_PICK },
        { level: 31, available: [RUNE_PICK, ADAMANT_PICK, STEEL_PICK], expected: ADAMANT_PICK },
        { level: 41, available: [RUNE_PICK, ADAMANT_PICK, DORIC_ITEM.BRONZE_PICKAXE], expected: RUNE_PICK }
    ];

    for (const { level, available, expected } of usableTierCases) {
        test(`Mining ${level} withdraws the best usable banked tier`, () => {
            const step = decideForMiningLevel(snap({ bank: available.map(item => stack(item)) }), level);
            expectWithdrawal(step, [{ name: expected.name, id: expected.id, qty: 1 }]);
        });
    }

    test('ignores an unusable held tier and withdraws a usable one', () => {
        const step = decideForMiningLevel(
            snap({
                inv: [stack(RUNE_PICK)],
                bank: [stack(DORIC_ITEM.BRONZE_PICKAXE)]
            }),
            1
        );
        expectWithdrawal(step, [{ ...DORIC_ITEM.BRONZE_PICKAXE, qty: 1 }]);
    });

    test('uses a usable exact worn pickaxe without trying to reacquire it', () => {
        const step = decideForMiningLevel(snap({ worn: [IRON_PICK] }), 1);
        expectCustom(step, /mine.*clay/i);
    });

    test('collects the free bronze pickaxe spawn when no usable pick exists anywhere', () => {
        const step = decideForMiningLevel(snap(), 1);
        expectCustom(step, /(?:acquire|collect|source|ground).*(?:bronze )?pickaxe/i);
    });
});

describe("Doric's Quest mining progression", () => {
    test('mines the six required clay before moving to copper', () => {
        const step = decideForMiningLevel(snap({ inv: [BRONZE_PICK] }), 1);
        expectCustom(step, /mine.*clay/i);
    });

    test('mines the four required copper after clay is complete', () => {
        const step = decideForMiningLevel(snap({ inv: [BRONZE_PICK, stack(DORIC_ITEM.CLAY, 6)] }), 1);
        expectCustom(step, /mine.*copper/i);
    });

    test.each([1, 14])('Mining %i trains on copper after the clay and copper requirements are secured', level => {
        const step = decideForMiningLevel(snap({ inv: [BRONZE_PICK, stack(DORIC_ITEM.CLAY, 6), stack(DORIC_ITEM.COPPER, 4)] }), level);
        expectCustom(step, /(?:train|mine).*copper/i);
    });

    test('Mining 15 stops training and mines the two required iron', () => {
        const step = decideForMiningLevel(snap({ inv: [BRONZE_PICK, stack(DORIC_ITEM.CLAY, 6), stack(DORIC_ITEM.COPPER, 4)] }), 15);
        expectCustom(step, /mine.*iron/i);
    });

    test('hands in only when all three exact requirements are simultaneously held', () => {
        const complete = decideForMiningLevel(
            snap({
                inv: [stack(DORIC_ITEM.CLAY, 6), stack(DORIC_ITEM.COPPER, 4), stack(DORIC_ITEM.IRON, 2)]
            }),
            1
        );
        expectDoricTalk(complete);

        const split = decideForMiningLevel(
            snap({
                inv: [stack(DORIC_ITEM.CLAY, 6), stack(DORIC_ITEM.COPPER, 4)],
                bank: [stack(DORIC_ITEM.IRON, 2)]
            }),
            1
        );
        expect(split.kind).toBe('withdraw');
    });

    test('the hand-in owns the full post-completion reward queue', () => {
        const step = decideForMiningLevel(
            snap({
                inv: [stack(DORIC_ITEM.CLAY, 6), stack(DORIC_ITEM.COPPER, 4), stack(DORIC_ITEM.IRON, 2)]
            }),
            1
        );
        expectCustom(step, /hand Doric.*collect the full reward/i);
    });

    test('preserves extra clay and iron rather than treating them as disposable training ore', () => {
        const step = decideForMiningLevel(
            snap({
                inv: [BRONZE_PICK, stack(DORIC_ITEM.CLAY, 7), stack(DORIC_ITEM.COPPER, 3), stack(DORIC_ITEM.IRON, 3)]
            }),
            15
        );
        expectCustom(step, /mine.*copper/i);
        expect(customName(step)).not.toMatch(/drop/i);
    });

    test.each([
        [7, 4, 2],
        [6, 4, 3],
        [8, 12, 5]
    ])('hands in immediately with surplus counts (%i clay, %i copper, %i iron)', (clay, copper, iron) => {
        const step = decideForMiningLevel(
            snap({
                inv: [stack(DORIC_ITEM.CLAY, clay), stack(DORIC_ITEM.COPPER, copper), stack(DORIC_ITEM.IRON, iron)]
            }),
            15
        );
        expectDoricTalk(step);
    });

    test('drops disposable training copper when it fills the pack', () => {
        const step = decideForMiningLevel(
            snap({
                inv: [stack(DORIC_ITEM.CLAY, 6), stack(DORIC_ITEM.COPPER, 22)],
                worn: [DORIC_ITEM.BRONZE_PICKAXE],
                freeSlots: 0
            }),
            14
        );
        expectCustom(step, /drop.*(?:surplus|training)?.*copper/i);
    });

    test('cleans a full junk pack while preserving exact quest and pickaxe IDs', () => {
        const step = decideForMiningLevel(
            snap({
                inv: [stack(DORIC_ITEM.CLAY, 6), stack(DORIC_ITEM.COPPER, 4), BRONZE_PICK, fake('Bones', 526, 17)],
                freeSlots: 0
            }),
            15
        );
        expect(step.kind).toBe('deposit');
        if (step.kind === 'deposit') {
            expect(step.exactKeep).toBe(true);
            expect(step.keep).toEqual([]);
            expect(new Set(step.keepIds)).toEqual(new Set([DORIC_ITEM.CLAY.id, DORIC_ITEM.COPPER.id, DORIC_ITEM.IRON.id, ...DORIC_PICKAXES.map(item => item.id)]));
            expect(step.keepIds).not.toContain(526);
        }
    });

    test('rebalances a full exact-item pack instead of parking forever', () => {
        const step = decideForMiningLevel(
            snap({
                inv: [stack(DORIC_ITEM.CLAY, 7), stack(DORIC_ITEM.COPPER, 4), stack(DORIC_ITEM.IRON, 1), stack(DORIC_ITEM.BRONZE_PICKAXE, 1), stack(RUNE_PICK, 15)],
                freeSlots: 0
            }),
            1
        );
        expect(step.kind).toBe('deposit');
        if (step.kind === 'deposit') {
            expect(step.exactKeep).toBe(true);
            expect(step.keep).toEqual([]);
            expect(step.keepIds).toEqual([]);
        }
    });

    test('rebalances exact items when a bank withdrawal needs more slots than remain', () => {
        const step = decideForMiningLevel(
            snap({
                inv: [stack(DORIC_ITEM.CLAY, 20), stack(DORIC_ITEM.BRONZE_PICKAXE, 5)],
                bank: [stack(DORIC_ITEM.COPPER, 4), stack(DORIC_ITEM.IRON, 2)],
                freeSlots: 3
            }),
            1
        );
        expect(step.kind).toBe('deposit');
        if (step.kind === 'deposit') expect(step.keepIds).toEqual([]);
    });
});

describe("Doric's Quest module wiring", () => {
    test('owns its inventory and exposes its exact journal-stage oracle', () => {
        expect(doric.record.id).toBe('doric');
        expect(doric.ownsInventory).toBe(true);
        expect(doric.readStage).toBeDefined();
        expect(doric.decide).toBe(decide);
        expect(doric.bank).toBeDefined();
        expect(doric.gather).toBeUndefined();
    });
});
