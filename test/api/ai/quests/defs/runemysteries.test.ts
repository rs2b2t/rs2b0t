import { expect, test, describe } from 'bun:test';
import { decide, parseRuneMysteriesJournal, WIZARD_HOPS } from '#/bot/api/ai/quests/defs/runemysteries.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';
import Tile from '#/bot/geometry/Tile.js';

const snap = (journal: string, items: string[] = [], noProgress = 0): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(items.map(n => [n, 1])),
    worn: new Set(),
    noProgress,
    bankKnown: true,
    bank: new Map(),
    bankCoins: 0
});

const npcOf = (s: ReturnType<typeof decide>): string => (s.kind === 'talk' ? s.stop.npc : `<${s.kind}>`);

describe('runemysteries decide', () => {
    test('journal drives the ends', () => {
        expect(decide(snap('complete')).kind).toBe('done');
        expect(decide(snap('unknown')).kind).toBe('wait');
        expect(npcOf(decide(snap('notStarted')))).toBe('Duke Horacio');
    });
    test('held item drives the deliveries (exact full-name CI match)', () => {
        expect(npcOf(decide(snap('inProgress', ['air talisman'])))).toBe('Sedridor');
        expect(npcOf(decide(snap('inProgress', ['research package'])))).toBe('Aubury');
        expect(npcOf(decide(snap('inProgress', ['notes'])))).toBe('Sedridor');
        expect(npcOf(decide(snap('inProgress', ['research notes'])))).toBe('Aubury');
    });
    test('research package outranks a leftover air talisman', () => {
        expect(npcOf(decide(snap('inProgress', ['air talisman', 'research package'])))).toBe('Aubury');
        expect(npcOf(decide(snap('inProgress', ['notes', 'air talisman'])))).toBe('Sedridor');
    });
    test('climb-down long-walks the hall east of the inner door', () => {
        const down = WIZARD_HOPS.find(h => h.op === 'Climb-down');
        expect(down?.stand.equals(new Tile(3105, 3162, 0))).toBe(true);
        expect(down?.walk?.equals(new Tile(3108, 3162, 0))).toBe(true);
    });
    test('inProgress empty-handed rotates the RECOVER probe Aubury -> Sedridor -> Duke via noProgress', () => {
        expect(npcOf(decide(snap('inProgress', [], 0)))).toBe('Aubury');
        expect(npcOf(decide(snap('inProgress', [], 1)))).toBe('Sedridor');
        expect(npcOf(decide(snap('inProgress', [], 2)))).toBe('Duke Horacio');
        expect(npcOf(decide(snap('inProgress', [], 3)))).toBe('Aubury');
    });
});

test('withdraws a banked talisman before probing NPCs empty-handed', () => {
    expect(decide({ ...snap('inProgress'), bankKnown: true, bank: new Map([['air talisman', 2]]) }))
        .toMatchObject({ kind: 'withdraw', items: [{ name: 'Air talisman', qty: 1 }] });
});

test('recovers banked delivery items before an earlier held item', () => {
    expect(decide({
        ...snap('inProgress', ['air talisman']), bankKnown: true, bank: new Map([['research package', 1]])
    })).toMatchObject({ kind: 'withdraw', items: [{ name: 'Research package', qty: 1 }] });
    expect(decide({
        ...snap('inProgress', ['research package']), bankKnown: true, bank: new Map([['notes', 1]])
    })).toMatchObject({ kind: 'withdraw', items: [{ name: 'Notes', qty: 1 }] });
});

test('checks an unknown bank before probing empty-handed', () => {
    expect(decide({ ...snap('inProgress'), bankKnown: false })).toMatchObject({ kind: 'scanBank' });
});

test('returns to Aubury after delivering the package despite spare talismans', () => {
    for (const items of [[], ['air talisman']]) {
        const state = { ...snap('inProgress', items), stage: 4, bank: new Map([['air talisman', 1]]) };
        expect(npcOf(decide(state))).toBe('Aubury');
    }
});

test('returns to Sedridor after handing over the talisman', () => {
    expect(npcOf(decide({ ...snap('inProgress'), stage: 2, bank: new Map([['air talisman', 1]]) }))).toBe('Sedridor');
});


test('reads each Rune Mysteries journal stage', () => {
    const journals = [
        '@dbl@I can start this quest by speaking to @dre@Duke Horacio of Lumbridge',
        '@dbl@I need to find the @dre@Head Wizard@dbl@ and give him the @dre@Talisman',
        '@dbl@I should talk to the @dre@Head Wizard@dbl@ again',
        '@dbl@I should take this @dre@Research Package@dbl@ to @dre@Aubury@dbl@ in @dre@Varrock',
        '@dbl@I should speak to @dre@Aubury@dbl@ again when he has finished examining the @dre@research package@dbl@ I have delivered him.',
        '@dbl@I should take the @dre@notes@dbl@ to @dre@Sedridor@dbl@ and see what he says',
        '@red@QUEST COMPLETE!'
    ];
    journals.forEach((text, stage) => expect(parseRuneMysteriesJournal(text)).toBe(stage));
    expect(parseRuneMysteriesJournal('')).toBeUndefined();
});
