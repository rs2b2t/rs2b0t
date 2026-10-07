import { describe, expect, test } from 'bun:test';
import { prepareStrikes, strikeSpell } from '#/bot/api/ai/quests/strike.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

const snapshot = (extra: Partial<QuestSnapshot> = {}): QuestSnapshot => ({
    journal: 'inProgress', inv: new Map(), worn: new Set(), noProgress: 0, bankCoins: 10000,
    magic: 1, bankKnown: true, bank: new Map(), freeSlots: 20, ...extra
});

describe('quest Strike supplies', () => {
    test.each([[1, 'Wind Strike'], [5, 'Water Strike'], [9, 'Earth Strike'], [13, 'Fire Strike']])('Magic %i selects %s', (magic, spell) => {
        expect(strikeSpell(magic)).toBe(spell);
    });
    test('reads an unknown bank before buying runes', () => {
        expect(prepareStrikes(snapshot({ bankKnown: false }))).toEqual({ kind: 'scanBank' });
    });
    test('withdraws only missing runes for 150 casts', () => {
        expect(prepareStrikes(snapshot({ magic: 13, inv: new Map([['mind rune', 20], ['air rune', 100]]),
            bank: new Map([['mind rune', 200], ['air rune', 500], ['fire rune', 1000]]) }))).toMatchObject({
            kind: 'withdraw', items: [{ name: 'Mind rune', qty: 130 }, { name: 'Fire rune', qty: 450 }, { name: 'Air rune', qty: 200 }]
        });
    });
    test('buys the shortfall after draining available bank stacks', () => {
        expect(prepareStrikes(snapshot({ inv: new Map([['mind rune', 150], ['air rune', 40]]) }))).toMatchObject({
            kind: 'buy', item: 'Air rune', qty: 110, shop: { npc: 'Betty' }
        });
    });
    test('a full budget proceeds without a bank trip', () => {
        expect(prepareStrikes(snapshot({ bankKnown: false, inv: new Map([['mind rune', 150], ['air rune', 150]]) }))).toBeNull();
    });
    test('does not switch to an unsupplied spell after gaining a level', () => {
        expect(strikeSpell(13, name => ({ 'mind rune': 5, 'air rune': 5 }[name.toLowerCase()] ?? 0))).toBe('Wind Strike');
    });
    test('no runes means no castable spell', () => {
        expect(strikeSpell(13, () => 0)).toBeNull();
    });
});
