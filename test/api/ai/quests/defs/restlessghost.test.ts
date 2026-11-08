import { expect, test, describe } from 'bun:test';
import { decide } from '#/bot/api/ai/quests/defs/restlessghost.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

const snap = (journal: string, inv: string[] = [], worn: string[] = []): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(inv.map(n => [n, 1])),
    worn: new Set(worn),
    noProgress: 0,
    bankCoins: 0,
    bankKnown: true,
    bank: new Map(),
    bankIds: new Map()
});

describe('restlessghost decide', () => {
    test('ends and start', () => {
        expect(decide(snap('complete')).kind).toBe('done');
        const s = decide(snap('notStarted'));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Father Aereck');
    });
    test('no amulet anywhere -> Urhney (also the lost-amulet recovery)', () => {
        const s = decide(snap('inProgress'));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Father Urhney');
    });
    test('reads an unknown bank before asking Urhney to replace an amulet', () => {
        expect(decide({ ...snap('inProgress'), bankKnown: false })).toMatchObject({ kind: 'scanBank' });
    });
    test('withdraws the banked amulet by ID, then equips it', () => {
        const banked = { ...snap('inProgress'), bankIds: new Map([[552, 1]]) };
        expect(decide(banked)).toMatchObject({ kind: 'withdraw', items: [{ name: 'Ghostspeak amulet', id: 552, qty: 1 }] });
        expect(decide({ ...banked, inv: new Map([['ghostspeak amulet', 1]]) })).toEqual({ kind: 'equip', item: 'Ghostspeak amulet' });
    });
    test('a held or worn amulet does not cause a bank scan', () => {
        expect(decide({ ...snap('inProgress', ['ghostspeak amulet']), bankKnown: false }).kind).toBe('equip');
        const step = decide({ ...snap('inProgress', [], ['ghostspeak amulet']), bankKnown: false });
        expect(step.kind === 'custom' && step.name).toBe('ghost + skull');
    });
    test('amulet in pack but not worn -> equip', () => {
        expect(decide(snap('inProgress', ['ghostspeak amulet'])).kind).toBe('equip');
    });
    test('amulet worn, no skull -> ghost+skull custom', () => {
        const s = decide(snap('inProgress', [], ['ghostspeak amulet']));
        expect(s.kind === 'custom' && s.name).toBe('ghost + skull');
    });
    test('skull held -> return-to-coffin custom (works regardless of worn state)', () => {
        const s = decide(snap('inProgress', ['skull'], ['ghostspeak amulet']));
        expect(s.kind === 'custom' && s.name).toBe('return skull');
    });
});
