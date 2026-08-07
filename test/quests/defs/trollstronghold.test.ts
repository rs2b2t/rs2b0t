import { beforeEach, describe, expect, test } from 'bun:test';
import type { WorldTile } from '#/bot/adapter/ClientAdapter.js';
import {
    decide,
    FOOD_TARGET,
    ITEM,
    parseTrollStrongholdJournal,
    TROLL_FLAG,
    TROLL_STAGE,
    trollArea,
    trollstronghold
} from '#/bot/quests/defs/trollstronghold/index.js';
import { QuestFood } from '#/bot/quests/food.js';
import type { QuestSnapshot, QuestStep } from '#/bot/quests/engine/types.js';

const BURTHORPE: WorldTile = { x: 2896, z: 3528, level: 0 };
const ARENA: WorldTile = { x: 2912, z: 3613, level: 0 };
const STRONGHOLD: WorldTile = { x: 2837, z: 10090, level: 2 };
const SECRET: WorldTile = { x: 2880, z: 3595, level: 0 };
const FOOD = Array(FOOD_TARGET).fill('Lobster') as string[];

interface SnapshotOptions {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    flags?: string[];
    inv?: string[];
    worn?: string[];
    bank?: string[];
    bankKnown?: boolean;
    tile?: WorldTile | null;
    freeSlots?: number;
}

function counts(names: string[]): Map<string, number> {
    const out = new Map<string, number>();
    for (const name of names) {
        const key = name.toLowerCase();
        out.set(key, (out.get(key) ?? 0) + 1);
    }
    return out;
}

function snap(options: SnapshotOptions = {}): QuestSnapshot {
    const stage = options.stage ?? TROLL_STAGE.NOT_STARTED;
    const bank = counts(options.bank ?? []);
    return {
        journal: options.journal ?? (stage === TROLL_STAGE.NOT_STARTED ? 'notStarted' : 'inProgress'),
        inv: counts(options.inv ?? []),
        worn: new Set((options.worn ?? []).map(name => name.toLowerCase())),
        noProgress: 0,
        bankCoins: bank.get('coins') ?? 0,
        stage,
        progress: {
            stage,
            flags: new Set(options.flags ?? [])
        },
        bank,
        bankKnown: options.bankKnown ?? true,
        tile: options.tile === undefined ? BURTHORPE : options.tile,
        freeSlots: options.freeSlots ?? 28
    };
}

function customName(step: QuestStep): string | null {
    return step.kind === 'custom' ? step.name : null;
}

beforeEach(() => {
    QuestFood.name = 'Lobster';
});

describe('Troll Stronghold journal stage parsing', () => {
    test.each([
        [
            '@dbl@I can start this quest by speaking to @dre@Denulth@dbl@ in his tent at the @dre@Imperial Guard Camp@dbl@ in @dre@Burthorpe@dbl@ after completing the @dre@Death Plateau Quest',
            0
        ],
        [
            '@dbl@I promised @dre@Denulth@dbl@ that I would rescue @dre@Godric@dbl@ from the @dre@Troll Stronghold',
            10
        ],
        [
            '@dbl@I promised @dre@Denulth@dbl@ that I would rescue @dre@Godric@dbl@ from the @dre@Troll Stronghold||@str@I got some climbing boots from Tenzing.||@dbl@I have to defeat the @dre@Troll Champion@dbl@ to get past the @dre@Arena',
            10
        ],
        [
            '@dbl@I promised Denulth||@str@I have defeated the Troll Champion.||@dbl@I have to find a way to get into the @dre@Troll Stronghold',
            20
        ],
        [
            '@str@I have defeated the Troll Champion.||@str@I have found my way into the Troll Stronghold||@str@I have the prison key.|@dbl@I have to get into the @dre@prison',
            20
        ],
        [
            '@str@I have found my way into the prison.||@dbl@I have to rescue @dre@Godric',
            30
        ],
        [
            "@str@I've rescued Godric and Mad Eadgar.|@dbl@I should return and tell @dre@Dunstan@dbl@ his son is safe.",
            40
        ],
        [
            '@str@I talked to Dunstan and he gave me the Law Talisman|@str@as a token of thanks!||@red@QUEST COMPLETE!',
            50
        ]
    ])('maps journal text to stage %i', (text, stage) => {
        const progress = parseTrollStrongholdJournal(text as string);
        expect(progress?.stage).toBe(stage);
    });

    test('reads sub-progress flags from journal lines', () => {
        const progress = parseTrollStrongholdJournal(
            '@str@I got some climbing boots from Tenzing.||@str@I have defeated the Troll Champion.||@str@I have found my way into the Troll Stronghold||@str@I have the prison key.'
        );
        expect(progress?.stage).toBe(TROLL_STAGE.DEFEATED_DAD);
        expect(progress?.flags.has(TROLL_FLAG.BOOTS)).toBe(true);
        expect(progress?.flags.has(TROLL_FLAG.ENTERED_STRONGHOLD)).toBe(true);
        expect(progress?.flags.has(TROLL_FLAG.HAS_PRISON_KEY)).toBe(true);
    });

    test('fails closed on incomplete journal text', () => {
        expect(parseTrollStrongholdJournal(['Troll Stronghold', 'Loading…'])).toBeUndefined();
    });
});

describe('Troll Stronghold area classification', () => {
    test('recognizes quest regions', () => {
        expect(trollArea(BURTHORPE)).toBe('burthorpe');
        expect(trollArea(ARENA)).toBe('arena');
        expect(trollArea(SECRET)).toBe('secretPath');
        expect(trollArea(STRONGHOLD)).toBe('stronghold');
        expect(trollArea({ x: 3200, z: 3200, level: 0 })).toBe('mainland');
        expect(trollArea(null)).toBe('unknown');
    });
});

describe('Troll Stronghold decide', () => {
    test('module record id is troll', () => {
        expect(trollstronghold.record.id).toBe('troll');
        expect(trollstronghold.sustain?.eatBelowHp).toBe(0.5);
    });

    test('starts with Denulth once bank is known', () => {
        // Death Plateau gate uses live Quests.status — when not complete, wait.
        // In unit tests without a client, status is typically notStarted → wait.
        const step = decide(snap({ stage: TROLL_STAGE.NOT_STARTED }));
        expect(step.kind === 'talk' || step.kind === 'wait').toBe(true);
        if (step.kind === 'talk') {
            expect(step.stop.npc).toBe('Denulth');
        }
    });

    test('scans bank before mountain prep when unknown', () => {
        const step = decide(snap({
            stage: TROLL_STAGE.STARTED,
            journal: 'inProgress',
            bankKnown: false,
            tile: BURTHORPE
        }));
        expect(step.kind).toBe('scanBank');
    });

    test('buys or withdraws climbing boots after start', () => {
        const step = decide(snap({
            stage: TROLL_STAGE.STARTED,
            journal: 'inProgress',
            inv: [...FOOD, 'Coins'],
            bank: Array(500).fill('Coins') as string[],
            tile: BURTHORPE
        }));
        // Coins in inv may be count 1 only from counts() — sourceBoots wants bank or buy.
        expect(
            step.kind === 'custom'
            || step.kind === 'withdraw'
            || step.kind === 'wait'
            || step.kind === 'deposit'
        ).toBe(true);
    });

    test('equips held climbing boots', () => {
        const step = decide(snap({
            stage: TROLL_STAGE.STARTED,
            journal: 'inProgress',
            inv: [ITEM.CLIMBING_BOOTS, ...FOOD],
            tile: BURTHORPE
        }));
        expect(step.kind === 'equip' && step.item).toBe(ITEM.CLIMBING_BOOTS);
    });

    test('fights Dad when ready in the arena', () => {
        const step = decide(snap({
            stage: TROLL_STAGE.STARTED,
            journal: 'inProgress',
            inv: [...FOOD],
            worn: [ITEM.CLIMBING_BOOTS],
            tile: ARENA
        }));
        expect(customName(step)).toContain('Dad');
    });

    test('kills general for prison key after Dad', () => {
        const step = decide(snap({
            stage: TROLL_STAGE.DEFEATED_DAD,
            journal: 'inProgress',
            inv: [...FOOD],
            worn: [ITEM.CLIMBING_BOOTS],
            tile: STRONGHOLD
        }));
        expect(customName(step)?.toLowerCase()).toContain('prison key');
    });

    test('unlocks prison when holding the key inside the stronghold', () => {
        const step = decide(snap({
            stage: TROLL_STAGE.DEFEATED_DAD,
            journal: 'inProgress',
            inv: [ITEM.PRISON_KEY, ...FOOD],
            worn: [ITEM.CLIMBING_BOOTS],
            tile: STRONGHOLD
        }));
        expect(customName(step)?.toLowerCase()).toContain('prison');
    });

    test('frees Godric once in prison stage', () => {
        const step = decide(snap({
            stage: TROLL_STAGE.ENTERED_PRISON,
            journal: 'inProgress',
            inv: [...FOOD],
            tile: STRONGHOLD
        }));
        expect(customName(step)?.toLowerCase()).toMatch(/godric|eadgar|cell|free/);
    });

    test('talks to Dunstan after freeing Godric', () => {
        const step = decide(snap({
            stage: TROLL_STAGE.FREED_GODRIC,
            journal: 'inProgress',
            tile: BURTHORPE
        }));
        expect(step.kind === 'talk' && step.stop.npc).toBe('Dunstan');
    });

    test('done when complete', () => {
        expect(decide(snap({
            stage: TROLL_STAGE.COMPLETE,
            journal: 'complete'
        })).kind).toBe('done');
    });
});
