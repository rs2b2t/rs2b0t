import { describe, expect, test } from 'bun:test';
import { prepareStrikes, strikeSpell } from '#/bot/api/ai/quests/strike.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';
import { runesPerCast } from '#/bot/api/combat/CombatStyleLogic.js';

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
    test('an equipped fire staff supplies Fire Strike without loose fire runes', () => {
        const count = (name: string) => ({ 'mind rune': 150, 'air rune': 300 }[name.toLowerCase()] ?? 0);
        expect(strikeSpell(13, count, ['Staff of fire'])).toBe('Fire Strike');
        expect(prepareStrikes(snapshot({ magic: 13, inv: new Map([['mind rune', 150], ['air rune', 300]]) }), [], ['Staff of fire']))
            .toBeNull();
    });
    test('staff-aware provisioning buys only uncovered runes', () => {
        expect(prepareStrikes(snapshot({ magic: 13, inv: new Map([['mind rune', 150], ['air rune', 100]]) }), [], ['Staff of fire']))
            .toMatchObject({ kind: 'buy', item: 'Air rune', qty: 200 });
    });
    test('keeps a fully supplied stronger spell when an air staff also supports Wind Strike', () => {
        expect(prepareStrikes(snapshot({ magic: 13, bankKnown: false, worn: new Set(['staff of air']),
            inv: new Map([['mind rune', 150], ['fire rune', 450]]) }))).toBeNull();
    });
    test.each([
        { staff: 'Staff of earth', casts: 200 },
        { staff: 'Staff of water', casts: 300 },
        { staff: 'Staff of air', casts: 600 }
    ])('combat preserves the prepared damage budget with $staff and leftover fire runes', ({ staff, casts }) => {
        const inv = new Map([['mind rune', casts], ['air rune', casts], ['fire rune', 300]]);
        expect(prepareStrikes(snapshot({ magic: 42, inv, worn: new Set([staff.toLowerCase()]) }))).toBeNull();
        const hits: Record<string, number> = { 'Fire Strike': 8, 'Earth Strike': 6, 'Water Strike': 4, 'Wind Strike': 2 };
        let damage = 0;
        for (let i = 0; i < casts; i++) {
            const spell = strikeSpell(42, name => inv.get(name.toLowerCase()) ?? 0, [staff]);
            if (!spell) break;
            damage += hits[spell]!;
            for (const { rune, count } of runesPerCast(spell, [staff])!) {
                const key = rune.toLowerCase();
                inv.set(key, inv.get(key)! - count);
            }
        }
        expect(damage).toBeGreaterThanOrEqual(150 * 8);
    });
});
