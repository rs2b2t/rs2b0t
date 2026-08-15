import { describe, expect, test } from 'bun:test';
import type { WorldTile } from '#/bot/adapter/ClientAdapter.js';
import { decide, parseRomeoJulietJournal, romeojuliet, ROMEO_JULIET_ITEM, ROMEO_JULIET_STAGE } from '#/bot/api/ai/quests/defs/romeojuliet.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

const VARROCK: WorldTile = { x: 3211, z: 3425, level: 0 };
const FAR_AWAY: WorldTile = { x: 3000, z: 3200, level: 0 };

const ITEM_IDS = new Map<string, number>([
    [ROMEO_JULIET_ITEM.BERRIES.name.toLowerCase(), ROMEO_JULIET_ITEM.BERRIES.id],
    [ROMEO_JULIET_ITEM.MESSAGE.name.toLowerCase(), ROMEO_JULIET_ITEM.MESSAGE.id],
    [ROMEO_JULIET_ITEM.POTION.name.toLowerCase(), ROMEO_JULIET_ITEM.POTION.id]
]);

interface SnapshotOptions {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    inv?: string[];
    invIds?: ReadonlyMap<number, number>;
    bank?: string[];
    bankIds?: ReadonlyMap<number, number>;
    bankKnown?: boolean;
    noProgress?: number;
    tile?: WorldTile | null;
    freeSlots?: number;
}

function nameCounts(names: readonly string[]): Map<string, number> {
    const result = new Map<string, number>();
    for (const name of names) {
        const key = name.toLowerCase();
        result.set(key, (result.get(key) ?? 0) + 1);
    }
    return result;
}

function idCounts(names: readonly string[]): Map<number, number> {
    const result = new Map<number, number>();
    for (const name of names) {
        const id = ITEM_IDS.get(name.toLowerCase());
        if (id !== undefined) result.set(id, (result.get(id) ?? 0) + 1);
    }
    return result;
}

function snap(options: SnapshotOptions = {}): QuestSnapshot {
    const inv = options.inv ?? [];
    const bank = options.bank ?? [];
    return {
        journal: options.journal ?? 'inProgress',
        inv: nameCounts(inv),
        invIds: options.invIds ?? idCounts(inv),
        worn: new Set(),
        noProgress: options.noProgress ?? 0,
        bankCoins: 0,
        stage: options.stage ?? ROMEO_JULIET_STAGE.SPOKEN_TO_FATHER,
        bank: nameCounts(bank),
        bankIds: options.bankIds ?? idCounts(bank),
        bankKnown: options.bankKnown ?? true,
        tile: options.tile === undefined ? VARROCK : options.tile,
        freeSlots: options.freeSlots ?? 28 - inv.length
    };
}

function customName(step: QuestStep): string | null {
    return step.kind === 'custom' ? step.name : null;
}

function bankItem(step: QuestStep): { name: string; qty: number; id?: number } | null {
    return step.kind === 'withdraw' ? (step.items[0] ?? null) : null;
}

describe('Romeo & Juliet journal stage parsing', () => {
    test.each([
        ['@dbl@I can start this quest by talking to @dre@Romeo@dbl@ in @dre@Varrock|@dre@Square@dbl@.', 0],
        ['I have agreed to find Juliet.|@dbl@I should go and speak to @dre@Juliet@dbl@. I can find her west of Varrock.', 10],
        ['Juliet gave me a message.|@dbl@I should take the @dre@message@dbl@ from @dre@Juliet@dbl@ to @dre@Romeo@dbl@.', 20],
        ['I delivered the message to Romeo.|@dbl@I should find @dre@Father Lawrence@dbl@ and see how we can help', 30],
        ['I found Father Lawrence.|@dbl@I need to find the @dre@Apothecary@dbl@ to make a @dre@cadaver potion@dbl@.', 40],
        ['@str@I went to the Apothecary regarding making this cadava|@str@potion, and he told me to bring him some cadava berries.|@dbl@I will have to find some @dre@cadava berries@dbl@.', 50],
        ["After the Apothecary made me the potion, I delivered it to Juliet.|@dbl@I have to find @dre@Romeo@dbl@ and tell him what's happened.", 60],
        ['I told Romeo what was going to happen.|@red@QUEST COMPLETE!', 100]
    ])('maps the rendered journal to exact stage %i', (text, stage) => {
        expect(parseRomeoJulietJournal(text as string)).toBe(stage);
    });

    test('also parses the legacy journal spelling deployed by older servers', () => {
        const legacy = 'I went to the Apothecary regarding making this cadaver potion, and he told me to bring him some cadaver berries.';
        expect(parseRomeoJulietJournal(legacy)).toBe(ROMEO_JULIET_STAGE.SPOKEN_TO_APOTHECARY);
    });

    test.each(['I should take these cadava berries to the Apothecary.', 'I should take this cadava potion to Juliet.', 'I will have to find some cadava berries.'])('keeps dynamic Apothecary-stage journal suffixes at stage 50: %s', suffix => {
        const history = `I should find Father Lawrence. I need to find the Apothecary. I went to the Apothecary regarding making this cadava potion, and he told me to bring him some cadava berries. ${suffix}`;
        expect(parseRomeoJulietJournal(history)).toBe(ROMEO_JULIET_STAGE.SPOKEN_TO_APOTHECARY);
    });

    test('matches the newest milestone when the journal retains all earlier history', () => {
        const history =
            "I should go and speak to Juliet. I should take the message to Romeo. I should find Father Lawrence. I need to find the Apothecary. I went to the Apothecary regarding making this cadaver potion. I have to find Romeo and tell him what's happened.";
        expect(parseRomeoJulietJournal(history)).toBe(ROMEO_JULIET_STAGE.JULIET_IN_CRYPT);
    });

    test('does not infer a stage from partial or loading text', () => {
        expect(parseRomeoJulietJournal(['Romeo & Juliet', 'Loading…'])).toBeUndefined();
        expect(parseRomeoJulietJournal('I spoke to someone in Varrock.')).toBeUndefined();
    });
});

describe('Romeo & Juliet authoritative stage routing', () => {
    test.each([
        [0, [], 'stage 0: ask Romeo how to help find Juliet'],
        [10, [], "stage 10: ask Juliet for Romeo's message"],
        [20, ['Message'], "stage 20: deliver Juliet's message to Romeo"],
        [30, [], 'stage 30: ask Father Lawrence for help'],
        [40, [], 'stage 40: ask the Apothecary for a Cadava potion'],
        [50, ['Cadava berries'], 'stage 50: exchange Cadava berries with the Apothecary'],
        [50, ['Cadava potion'], 'stage 50: deliver the Cadava potion to Juliet'],
        [60, [], 'stage 60: tell Romeo that Juliet took the potion']
    ])('routes stage %i deterministically to %s', (stage, inv, expected) => {
        expect(customName(decide(snap({ stage: stage as number, inv: inv as string[] })))).toBe(expected as string);
    });

    test('routing no longer depends on no-progress count or player tile', () => {
        const cases: Array<[number, string[], string]> = [
            [30, [], 'stage 30: ask Father Lawrence for help'],
            [40, [], 'stage 40: ask the Apothecary for a Cadava potion'],
            [50, ['Cadava berries'], 'stage 50: exchange Cadava berries with the Apothecary'],
            [60, ['Cadava berries'], 'stage 60: tell Romeo that Juliet took the potion']
        ];
        for (const [stage, inv, expected] of cases) {
            for (const noProgress of [0, 1, 2, 3, 7]) {
                for (const tile of [VARROCK, FAR_AWAY, null]) {
                    expect(customName(decide(snap({ stage, inv, noProgress, tile })))).toBe(expected);
                }
            }
        }
    });

    test('stage 60 ignores obsolete berries and a full pack and goes straight to Romeo', () => {
        const full = ['Cadava berries', ...Array(27).fill('Bones')];
        expect(customName(decide(snap({ stage: 60, inv: full, freeSlots: 0, bankKnown: false })))).toBe('stage 60: tell Romeo that Juliet took the potion');
    });

    test('completes from either status or exact stage and waits on unknown state', () => {
        expect(decide(snap({ stage: 0, journal: 'complete' })).kind).toBe('done');
        expect(decide(snap({ stage: 100 })).kind).toBe('done');
        expect(decide(snap({ journal: 'unknown' }))).toEqual({ kind: 'wait', reason: 'quest journal not loaded' });

        const unavailable = snap();
        unavailable.stage = undefined;
        expect(decide(unavailable)).toEqual({ kind: 'wait', reason: 'Romeo & Juliet stage unavailable' });
        expect(decide(snap({ stage: 70 }))).toEqual({ kind: 'wait', reason: 'unrecognized Romeo & Juliet stage 70' });
    });
});

describe('Romeo & Juliet restart and item recovery', () => {
    test('uses a held exact message immediately, even before a bank scan', () => {
        const full = ['Message', ...Array(27).fill('Bones')];
        expect(customName(decide(snap({ stage: 20, inv: full, freeSlots: 0, bankKnown: false })))).toBe("stage 20: deliver Juliet's message to Romeo");
    });

    test('scans an unknown bank before asking Juliet to replace a missing message', () => {
        const step = decide(snap({ stage: 20, bankKnown: false }));
        expect(step.kind).toBe('scanBank');
        expect(step.kind === 'scanBank' && step.bank).toBeDefined();
    });

    test('withdraws the exact banked quest message after a restart', () => {
        const step = decide(snap({ stage: 20, bank: ['Message'] }));
        expect(bankItem(step)).toEqual({ name: 'Message', id: 755, qty: 1 });
    });

    test('asks Juliet for a replacement only after proving the message is absent', () => {
        expect(customName(decide(snap({ stage: 20 })))).toBe('stage 20: ask Juliet to replace the lost message');
    });

    test('does not mistake a different item named Message for quest item id 755', () => {
        const step = decide(
            snap({
                stage: 20,
                inv: ['Message'],
                invIds: new Map([[9999, 1]]),
                bankKnown: true
            })
        );
        expect(customName(step)).toBe('stage 20: ask Juliet to replace the lost message');
    });

    test('clears a full pack before Juliet creates or replaces a message', () => {
        for (const stage of [10, 20]) {
            const step = decide(snap({ stage, inv: Array(28).fill('Bones'), freeSlots: 0 }));
            expect(step.kind).toBe('deposit');
            if (step.kind === 'deposit') {
                expect(step.keep).toEqual([]);
                expect(step.keepIds).toEqual([]);
                expect(step.exactKeep).toBe(true);
            }
        }
    });

    test('stage 50 prioritizes a held potion over held berries', () => {
        const step = decide(snap({ stage: 50, inv: ['Cadava berries', 'Cadava potion'] }));
        expect(customName(step)).toBe('stage 50: deliver the Cadava potion to Juliet');
    });

    test('stage 50 scans the bank, then prioritizes banked potion over berries', () => {
        expect(decide(snap({ stage: 50, bankKnown: false })).kind).toBe('scanBank');
        const potion = decide(snap({ stage: 50, bank: ['Cadava berries', 'Cadava potion'] }));
        expect(bankItem(potion)).toEqual({ name: 'Cadava potion', id: 756, qty: 1 });
        const berries = decide(snap({ stage: 50, bank: ['Cadava berries'] }));
        expect(bankItem(berries)).toEqual({ name: 'Cadava berries', id: 753, qty: 1 });
    });

    test('collects a ground berry only after inventory and known bank are both empty', () => {
        expect(customName(decide(snap({ stage: 50 })))).toBe('stage 50: collect Cadava berries from their ground spawns');
    });

    test('clears a full pack before withdrawing or collecting a stage-50 item', () => {
        const step = decide(snap({ stage: 50, inv: Array(28).fill('Bones'), freeSlots: 0, bank: ['Cadava potion'] }));
        expect(step.kind).toBe('deposit');
        expect(step.kind === 'deposit' && step.exactKeep).toBe(true);
    });

    test('does not mistake same-name inventory or bank entries for exact quest IDs', () => {
        const inventoryCollision = decide(
            snap({
                stage: 50,
                inv: ['Cadava potion'],
                invIds: new Map([[9998, 1]])
            })
        );
        expect(customName(inventoryCollision)).toBe('stage 50: collect Cadava berries from their ground spawns');

        const bankCollision = decide(
            snap({
                stage: 50,
                bank: ['Cadava berries'],
                bankIds: new Map([[9997, 1]])
            })
        );
        expect(customName(bankCollision)).toBe('stage 50: collect Cadava berries from their ground spawns');
    });
});

describe('Romeo & Juliet module wiring', () => {
    test('owns its stage-specific inventory and exposes the journal stage oracle', () => {
        expect(romeojuliet.record.id).toBe('romeojuliet');
        expect(romeojuliet.ownsInventory).toBe(true);
        expect(romeojuliet.readStage).toBeDefined();
        expect(romeojuliet.bank).toBeDefined();
        expect(romeojuliet.gather).toBeUndefined();
    });
});
