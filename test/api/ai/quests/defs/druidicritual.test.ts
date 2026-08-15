import { describe, expect, test } from 'bun:test';
import {
    decide,
    druidicritual,
    druidicRitualArea,
    DRUIDIC_RITUAL_STAGE,
    parseDruidicRitualJournal
} from '#/bot/api/ai/quests/defs/druidicritual.js';
import type { WorldTile } from '#/bot/adapter/ClientAdapter.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

const MAINLAND: WorldTile = { x: 3220, z: 3220, level: 0 };
const DUNGEON: WorldTile = { x: 2888, z: 9831, level: 0 };
const ENTRANA_DUNGEON: WorldTile = { x: 2822, z: 9774, level: 0 };

const RAW = ['Raw bear meat', 'Raw rat meat', 'Raw chicken', 'Raw beef'];
const ENCHANTED = ['Enchanted bear', 'Enchanted rat', 'Enchanted chicken', 'Enchanted beef'];

interface SnapshotOptions {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    inv?: string[];
    bank?: string[];
    bankKnown?: boolean;
    tile?: WorldTile | null;
    freeSlots?: number;
}

function counts(names: string[]): Map<string, number> {
    const result = new Map<string, number>();
    for (const name of names) {
        const key = name.toLowerCase();
        result.set(key, (result.get(key) ?? 0) + 1);
    }
    return result;
}

function snap(options: SnapshotOptions = {}): QuestSnapshot {
    return {
        journal: options.journal ?? 'inProgress',
        inv: counts(options.inv ?? []),
        worn: new Set(),
        noProgress: 0,
        bankCoins: 2_000_000,
        stage: options.stage ?? DRUIDIC_RITUAL_STAGE.SPOKEN_TO_SANFEW,
        bank: counts(options.bank ?? []),
        bankKnown: options.bankKnown ?? true,
        tile: options.tile === undefined ? MAINLAND : options.tile,
        freeSlots: options.freeSlots ?? 28 - (options.inv?.length ?? 0)
    };
}

function customName(step: QuestStep): string | null {
    return step.kind === 'custom' ? step.name : null;
}

describe('Druidic Ritual journal stage parsing', () => {
    test.each([
        ['@dbl@I can start this quest by speaking to @dre@Kaqemeex', 0],
        ['I told Kaqemeex I would help them prepare their ceremony.|@dbl@I should speak to @dre@Sanfew', 1],
        ['@dre@Sanfew@dbl@ told me for the ritual they would need me to place raw meats in the Cauldron of Thunder', 2],
        ['The ceremony required various meats being placed in the Cauldron of Thunder. I did this and gave them to Sanfew.|I should speak to Kaqemeex again and claim my reward', 3],
        ['@red@QUEST COMPLETE!', 4]
    ])('maps rendered journal text to exact stage %i', (text, stage) => {
        expect(parseDruidicRitualJournal(text as string)).toBe(stage);
    });

    test('matches the newest entry when the journal retains earlier history', () => {
        const history = 'I told Kaqemeex I would help. Sanfew told me for the ritual what was needed. I did this and gave them to Sanfew.';
        expect(parseDruidicRitualJournal(history)).toBe(DRUIDIC_RITUAL_STAGE.GIVEN_INGREDIENTS);
    });

    test('does not guess from an unrecognized or loading journal', () => {
        expect(parseDruidicRitualJournal(['Druidic Ritual', 'Loading…'])).toBeUndefined();
    });
});

describe('Druidic Ritual stage routing', () => {
    test('recognizes mainland, dungeon, and a missing player tile', () => {
        expect(druidicRitualArea(MAINLAND)).toBe('mainland');
        expect(druidicRitualArea(DUNGEON)).toBe('dungeon');
        expect(druidicRitualArea(ENTRANA_DUNGEON)).toBe('mainland');
        expect(druidicRitualArea(null)).toBe('unknown');
    });

    test('starts with Kaqemeex using both exact choices', () => {
        const step = decide(snap({ stage: 0 }));
        expect(step.kind).toBe('talk');
        if (step.kind === 'talk') {
            expect(step.stop.npc).toBe('Kaqemeex');
            expect(step.stop.prefer).toEqual(["I'm in search of a quest.", 'Ok, I will try and help.']);
        }
    });

    test('continues stage 1 with upstairs Sanfew using both exact choices', () => {
        const step = decide(snap({ stage: 1 }));
        expect(step.kind).toBe('talk');
        if (step.kind === 'talk') {
            expect(step.stop.npc).toBe('Sanfew');
            expect(step.stop.anchor.level).toBe(1);
            expect(step.stop.prefer).toEqual(["I've been sent to help purify the Varrock stone circle.", "Ok, I'll do that then."]);
        }
    });

    test('returns to Kaqemeex at stage 3 and finishes at stage 4', () => {
        const reward = decide(snap({ stage: 3, inv: [] }));
        expect(reward.kind === 'talk' && reward.stop.npc).toBe('Kaqemeex');
        expect(decide(snap({ stage: 4 })).kind).toBe('done');
        expect(decide(snap({ stage: 0, journal: 'complete' })).kind).toBe('done');
    });

    test('waits safely for unknown journal or unavailable stage state', () => {
        expect(decide(snap({ journal: 'unknown' })).kind).toBe('wait');
        const unavailable = snap();
        unavailable.stage = undefined;
        expect(decide(unavailable)).toEqual({ kind: 'wait', reason: 'Druidic Ritual stage unavailable' });
    });
});

describe('Druidic Ritual item recovery', () => {
    test('checks an unknown bank before sourcing any absent meat', () => {
        const step = decide(snap({ bankKnown: false }));
        expect(step.kind).toBe('scanBank');
        expect(step.kind === 'scanBank' && step.bank).toBeDefined();
    });

    test('prefers banked enchanted forms and otherwise withdraws raw forms', () => {
        const step = decide(
            snap({
                inv: ['Raw bear meat'],
                bank: ['Enchanted rat', 'Raw chicken', 'Enchanted beef']
            })
        );
        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items).toEqual([
            { name: 'Enchanted rat', qty: 1 },
            { name: 'Raw chicken', qty: 1 },
            { name: 'Enchanted beef', qty: 1 }
        ]);
    });

    test.each([
        ['Enchanted bear', 'Raw bear meat'],
        ['Enchanted rat', 'Raw rat meat'],
        ['Enchanted chicken', 'Raw chicken'],
        ['Enchanted beef', 'Raw beef']
    ])('%s satisfies its species without reacquiring %s', (enchanted, raw) => {
        const others = ENCHANTED.filter(name => name !== enchanted);
        const step = decide(snap({ inv: [enchanted, ...others] }));
        expect(step.kind).toBe('talk');
        expect(step.kind === 'talk' && step.stop.npc).toBe('Sanfew');
        expect(JSON.stringify(step)).not.toContain(raw);
    });

    test.each([
        ['Bear', 'Raw bear meat'],
        ['Giant rat', 'Raw rat meat'],
        ['Chicken', 'Raw chicken'],
        ['Cow', 'Raw beef']
    ])('hunts %s when %s is absent from both inventory and bank', (npc, raw) => {
        const index = RAW.indexOf(raw);
        const held = ENCHANTED.filter((_, i) => i !== index);
        const step = decide(snap({ inv: held }));
        expect(customName(step)).toBe(`hunt ${npc} for ${raw}`);
    });

    test('cleans a full dirty pack before a withdrawal or hunt', () => {
        const dirty = [...RAW.slice(0, 3), ...Array(25).fill('Bones')] as string[];
        const step = decide(snap({ inv: dirty, bank: ['Enchanted beef'], freeSlots: 0 }));
        expect(step.kind).toBe('deposit');
        if (step.kind === 'deposit') {
            expect(step.exactKeep).toBe(true);
            expect(step.keep).toContain('raw beef');
            expect(step.keep).toContain('enchanted beef');
        }
    });

    test('banks duplicate quest forms instead of parking when only they fill the pack', () => {
        const full = Array(28).fill('Raw bear meat') as string[];
        const step = decide(snap({ inv: full, freeSlots: 0 }));
        expect(step.kind).toBe('deposit');
        expect(step.kind === 'deposit' && step.keep).toEqual([]);
        expect(step.kind === 'deposit' && step.exactKeep).toBe(true);
    });
});

describe('Druidic Ritual cauldron and restart states', () => {
    test('enters the dungeon and dips one exact raw form at a time', () => {
        const step = decide(snap({ inv: RAW }));
        expect(customName(step)).toBe('dip Raw bear meat in the Cauldron of Thunder');
    });

    test('continues from a partial enchanted/raw state inside the dungeon', () => {
        const step = decide(
            snap({
                inv: ['Enchanted bear', 'Raw rat meat', 'Enchanted chicken', 'Raw beef'],
                tile: DUNGEON
            })
        );
        expect(customName(step)).toBe('dip Raw rat meat in the Cauldron of Thunder');
    });

    test('leaves the dungeon before consulting the bank for a missing species', () => {
        const step = decide(
            snap({
                inv: ['Enchanted bear', 'Raw rat meat', 'Raw chicken'],
                bank: ['Raw beef'],
                tile: DUNGEON
            })
        );
        expect(customName(step)).toBe('leave the dungeon to recover missing ritual meat');
    });

    test('hands in only when all four enchanted meats are simultaneously held', () => {
        const completeSet = decide(snap({ inv: ENCHANTED, tile: DUNGEON }));
        expect(completeSet.kind === 'talk' && completeSet.stop.npc).toBe('Sanfew');

        const split = decide(snap({ inv: ENCHANTED.slice(0, 3), bank: [ENCHANTED[3]] }));
        expect(split.kind === 'withdraw' && split.items).toEqual([{ name: 'Enchanted beef', qty: 1 }]);
    });

    test('a lost enchanted item is naturally reacquired as its raw counterpart', () => {
        const step = decide(snap({ inv: ENCHANTED.slice(0, 3) }));
        expect(customName(step)).toBe('hunt Cow for Raw beef');
    });
});

describe('Druidic Ritual module wiring', () => {
    test('owns inventory and supplies exact dungeon transport and combat metadata', () => {
        expect(druidicritual.record.id).toBe('druid');
        expect(druidicritual.record.items.map(item => item.name)).toEqual(['Raw bear meat', 'Raw beef', 'Raw chicken', 'Raw rat meat']);
        expect(druidicritual.ownsInventory).toBe(true);
        expect(druidicritual.readStage).toBeDefined();
        expect(druidicritual.hops).toHaveLength(2);
        expect(druidicritual.grind).toEqual(['Bear', 'Giant rat', 'Chicken', 'Cow', 'Suit of armour']);
    });
});
