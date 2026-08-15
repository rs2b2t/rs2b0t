import { describe, expect, test } from 'bun:test';
import type { WorldTile } from '#/bot/adapter/ClientAdapter.js';
import {
    decide,
    parseVampireSlayerJournal,
    vampireSlayerArea,
    VAMPIRE_SLAYER_STAGE
} from '#/bot/api/ai/quests/defs/vampireslayer.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

const MAINLAND: WorldTile = { x: 3093, z: 3243, level: 0 };
const MORGAN_UPPER: WorldTile = { x: 3096, z: 3268, level: 1 };
const CRYPT: WorldTile = { x: 3077, z: 9775, level: 0 };
const FOOD = Array(20).fill('Trout') as string[];

interface SnapshotOptions {
    journal?: QuestSnapshot['journal'];
    stage?: number | null;
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
    const bank = counts(options.bank ?? []);
    return {
        journal: options.journal ?? 'inProgress',
        inv: counts(options.inv ?? []),
        worn: new Set((options.worn ?? []).map(name => name.toLowerCase())),
        noProgress: 0,
        bankCoins: bank.get('coins') ?? 0,
        stage: options.stage === null ? undefined : (options.stage ?? VAMPIRE_SLAYER_STAGE.NOT_STARTED),
        bank,
        bankKnown: options.bankKnown ?? true,
        tile: options.tile === undefined ? MAINLAND : options.tile,
        freeSlots: options.freeSlots ?? 28
    };
}

function customName(step: QuestStep): string | null {
    return step.kind === 'custom' ? step.name : null;
}

describe('Vampire Slayer journal phase parsing', () => {
    test.each([
        ['@dbl@I can start this quest by speaking to @dre@Morgan@dbl@ who is in @dre@Draynor Village.', 0],
        ['@str@I spoke to Morgan in Draynor Village.||@dbl@I need to speak to @dre@Dr Harlow@dbl@ who can normally be found in the Jolly Boar Inn.', 1],
        ['@str@I have spoken to Dr Harlow. He seemed terribly drunk, and|@str@he kept asking me to buy him drinks.', 2],
        ["@str@Dr Harlow gave me a stake to finish off the Vampire when|I'm fighting it.", 2],
        ['@str@I have killed the Vampire, Count Draynor.||@red@QUEST COMPLETE!', 3]
    ])('maps source-authored journal text to phase %i', (text, phase) => {
        expect(parseVampireSlayerJournal(text as string)).toBe(phase);
    });

    test('fails closed on an incomplete or unrelated journal', () => {
        expect(parseVampireSlayerJournal(['Vampire Slayer', 'Loading…'])).toBeUndefined();
    });
});

describe('Vampire Slayer area classification', () => {
    test('recognizes every quest-specific area', () => {
        expect(vampireSlayerArea(MAINLAND)).toBe('mainland');
        expect(vampireSlayerArea(MORGAN_UPPER)).toBe('morganUpper');
        expect(vampireSlayerArea(CRYPT)).toBe('crypt');
        expect(vampireSlayerArea({ x: 3200, z: 3200, level: 2 })).toBe('unknown');
        expect(vampireSlayerArea(null)).toBe('unknown');
    });
});

describe('Vampire Slayer start and Harlow phases', () => {
    test('scans an unknown bank before starting from an empty pack', () => {
        expect(decide(snap({ stage: 0, bankKnown: false })).kind).toBe('scanBank');
    });

    test('banks unrelated spillover before speaking to Morgan', () => {
        const step = decide(snap({ stage: 0, inv: ['Bones'] }));
        expect(step.kind).toBe('deposit');
        expect(step.kind === 'deposit' && step.exactKeep).toBe(true);
    });

    test('starts with Morgan once the bank and pack are known', () => {
        const step = decide(snap({ stage: 0 }));
        expect(step.kind === 'talk' && step.stop.npc).toBe('Morgan');
    });

    test('stage 1 recovers banked garlic before visiting Harlow', () => {
        const step = decide(snap({ stage: 1, bank: ['Garlic'] }));
        expect(step.kind === 'withdraw' && step.items).toEqual([{ name: 'Garlic', qty: 1 }]);
    });

    test('stage 1 sources missing garlic and then visits Harlow', () => {
        expect(customName(decide(snap({ stage: 1 })))).toBe("take garlic from Morgan's cupboard");
        const ready = decide(snap({ stage: 1, inv: ['Garlic'] }));
        expect(ready.kind === 'talk' && ready.stop.npc).toBe('Dr Harlow');
    });

    test('an upstairs restart searches or leaves according to held garlic', () => {
        expect(customName(decide(snap({ stage: 1, tile: MORGAN_UPPER })))).toBe("take garlic from Morgan's cupboard");
        expect(customName(decide(snap({ stage: 1, tile: MORGAN_UPPER, inv: ['Garlic'] })))).toBe("leave Morgan's upper floor");
    });
});

describe('Vampire Slayer stake and supply recovery', () => {
    test('recovers a banked stake without buying another beer', () => {
        const step = decide(snap({ stage: 2, bank: ['Stake'] }));
        expect(step.kind === 'withdraw' && step.items).toEqual([{ name: 'Stake', qty: 1 }]);
    });

    test('banks an oversized valid loadout and rebuilds instead of parking', () => {
        const step = decide(snap({
            stage: 2,
            inv: Array(28).fill('Trout'),
            bank: ['Stake'],
            freeSlots: 0
        }));
        expect(step.kind).toBe('deposit');
        expect(step.kind === 'deposit' && step.keep).toEqual(['coins']);
    });

    test('withdraws coins, buys a beer, then returns it to Harlow', () => {
        const coins = decide(snap({ stage: 2, bank: Array(5000).fill('Coins') }));
        expect(coins.kind === 'withdraw' && coins.items).toEqual([{ name: 'Coins', qty: 5000 }]);

        expect(customName(decide(snap({ stage: 2, inv: Array(5000).fill('Coins') })))).toBe('buy Dr Harlow a Beer');

        const beer = decide(snap({ stage: 2, inv: ['Beer'] }));
        expect(beer.kind === 'talk' && beer.stop.npc).toBe('Dr Harlow');
    });

    test('does not cross the map to top up a still-safe coin reserve', () => {
        const step = decide(snap({
            stage: 2,
            inv: ['Stake', 'Garlic', ...Array(4998).fill('Coins')]
        }));
        expect(step.kind === 'buy' && step.item).toBe('Hammer');
    });

    test('recovers banked beer before buying a replacement', () => {
        const step = decide(snap({ stage: 2, bank: ['Beer'] }));
        expect(step.kind === 'withdraw' && step.items).toEqual([{ name: 'Beer', qty: 1 }]);
    });

    test('recovers or sources each post-Harlow quest item in order', () => {
        const garlic = decide(snap({ stage: 2, inv: ['Stake'], bank: ['Garlic'] }));
        expect(garlic.kind === 'withdraw' && garlic.items).toEqual([{ name: 'Garlic', qty: 1 }]);

        const hammer = decide(snap({ stage: 2, inv: ['Stake', 'Garlic'], bank: ['Hammer'] }));
        expect(hammer.kind === 'withdraw' && hammer.items).toEqual([{ name: 'Hammer', qty: 1 }]);

        const buyHammer = decide(snap({ stage: 2, inv: ['Stake', 'Garlic', ...Array(5000).fill('Coins')] }));
        expect(buyHammer.kind === 'buy' && buyHammer.item).toBe('Hammer');
    });

    test('uses a banked safe weapon, equips it, and buys one only as fallback', () => {
        const base = ['Stake', 'Garlic', 'Hammer'];
        const banked = decide(snap({ stage: 2, inv: base, bank: ['Steel sword'] }));
        expect(banked.kind === 'withdraw' && banked.items).toEqual([{ name: 'Steel sword', qty: 1 }]);

        const equip = decide(snap({ stage: 2, inv: [...base, 'Steel sword'] }));
        expect(equip.kind === 'equip' && equip.item).toBe('Steel sword');

        const buy = decide(snap({ stage: 2, inv: [...base, ...Array(5000).fill('Coins')] }));
        expect(buy.kind === 'buy' && buy.item).toBe('Black sword');
    });

    test('uses banked food before sourcing fallback Kebabs', () => {
        const base = ['Stake', 'Garlic', 'Hammer'];
        const food = decide(snap({ stage: 2, inv: base, worn: ['Black sword'], bank: Array(20).fill('Trout') }));
        expect(food.kind === 'withdraw' && food.items).toEqual([{ name: 'Trout', qty: 20 }]);

        const fallback = decide(snap({
            stage: 2,
            inv: [...base, ...Array(5000).fill('Coins')],
            worn: ['Black sword']
        }));
        expect(customName(fallback)).toBe('buy 20 combat Kebabs');
    });

    test('enters the crypt only with stake, garlic, hammer, weapon, and twenty food', () => {
        const step = decide(snap({
            stage: 2,
            inv: ['Stake', 'Garlic', 'Hammer', ...FOOD],
            worn: ['Black sword']
        }));
        expect(customName(step)).toBe('enter the crypt and defeat Count Draynor');
    });

    test('a crypt restart leaves when incomplete and resumes combat when complete', () => {
        expect(customName(decide(snap({ stage: 2, tile: CRYPT, inv: ['Stake'] })))).toBe('leave the crypt to recover supplies');

        const ready = decide(snap({
            stage: 2,
            tile: CRYPT,
            inv: ['Stake', 'Garlic', 'Hammer', ...FOOD],
            worn: ['Black sword']
        }));
        expect(customName(ready)).toBe('enter the crypt and defeat Count Draynor');
    });
});

describe('Vampire Slayer terminal and defensive states', () => {
    test('completion is terminal even before the journal colour catches up', () => {
        expect(decide(snap({ stage: 3 })).kind).toBe('done');
        expect(decide(snap({ stage: 0, journal: 'complete' })).kind).toBe('done');
    });

    test('unknown journal, stage, and area all fail closed', () => {
        expect(decide(snap({ journal: 'unknown' })).kind).toBe('wait');
        expect(decide(snap({ stage: null })).kind).toBe('wait');
        expect(decide(snap({ stage: 2, tile: { x: 3200, z: 3200, level: 2 } })).kind).toBe('wait');
    });
});
