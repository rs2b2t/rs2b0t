import { afterEach, expect, spyOn, test } from 'bun:test';
import { dressForCombat, junkIds } from '#/bot/api/ai/quests/defs/legends/supplies.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';
import { Skills } from '#/bot/api/skills/Skills.js';

afterEach(() => spyOn(Skills, 'level').mockRestore());

function snap(overrides: Partial<QuestSnapshot> = {}): QuestSnapshot {
    return { journal: 'inProgress', inv: new Map(), invIds: new Map(), worn: new Set(),
        wornIds: new Set([1333, 1079, 1163, 1201, 1704]), attack: 70,
        bankKnown: true, bank: new Map(), bankIds: new Map(), noProgress: 0, bankCoins: 0, ...overrides };
}

test('withdraws lower armor when Rune is not owned', () => {
    spyOn(Skills, 'level').mockReturnValue(70);
    const step = dressForCombat(snap({ bankIds: new Map([[1111, 1]]) }));
    expect(step).toMatchObject({ kind: 'withdraw', items: [{ id: 1111, name: 'Adamant chainbody', qty: 1 }] });
});

test('skips banked Rune when Defence is insufficient', () => {
    spyOn(Skills, 'level').mockReturnValue(30);
    const step = dressForCombat(snap({ bankIds: new Map([[1113, 1], [1111, 1]]) }));
    expect(step).toMatchObject({ kind: 'withdraw', items: [{ id: 1111, qty: 1 }] });
});

test('keeps already worn lower armor rather than withdrawing Rune', () => {
    spyOn(Skills, 'level').mockReturnValue(70);
    const step = dressForCombat(snap({ wornIds: new Set([1333, 1111, 1073, 1161, 1199]), bankIds: new Map([[1113, 1]]) }));
    expect(step).toBeNull();
});

test('equips carried lower armor without scanning the bank', () => {
    spyOn(Skills, 'level').mockReturnValue(30);
    const step = dressForCombat(snap({ bankKnown: false, invIds: new Map([[1111, 1], [1113, 1]]) }));
    expect(step).toEqual({ kind: 'equip', item: 'Adamant chainbody' });
});

test('keeps withdrawn lower armor through the junk deposit', () => {
    const junk = junkIds(snap({ invIds: new Map([[1111, 1], [1073, 1], [1161, 1], [1199, 1]]) }));
    expect(junk).toEqual([]);
});

test('waits when no protective body is owned', () => {
    spyOn(Skills, 'level').mockReturnValue(70);
    expect(dressForCombat(snap())?.kind).toBe('wait');
});

test('still withdraws wearable Rune', () => {
    spyOn(Skills, 'level').mockReturnValue(40);
    expect(dressForCombat(snap({ bankIds: new Map([[1113, 1]]) })))
        .toMatchObject({ kind: 'withdraw', items: [{ id: 1113, qty: 1 }] });
});

test('still equips the required usable melee weapon first', () => {
    spyOn(Skills, 'level').mockReturnValue(30);
    expect(dressForCombat(snap({ wornIds: new Set(), invIds: new Map([[1331, 1]]) })))
        .toEqual({ kind: 'equip', item: 'Adamant scimitar' });
});

test('preserves a worn amulet rather than replacing it with banked glory', () => {
    const step = dressForCombat(snap({ wornIds: new Set([1333, 1111, 1073, 1161, 1199, 1725]),
        bankIds: new Map([[1704, 1]]) }));
    expect(step).toBeNull();
});

test('keeps selected leather and studded armor through the junk deposit', () => {
    expect(junkIds(snap({ invIds: new Map([1129, 1095, 1167, 1131, 1133, 1097, 1169].map(id => [id, 1])) })))
        .toEqual([]);
});
