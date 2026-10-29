import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { goblindiplomacy, goblinMailGatherStep } from '#/bot/api/ai/quests/defs/goblindiplomacy.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import * as primitives from '#/bot/api/ai/quests/exec/primitives.js';
import Tile from '#/bot/geometry/Tile.js';

afterEach(() => mock.restore());
const snap = (extra: Partial<QuestSnapshot> = {}): QuestSnapshot => ({
    journal: 'inProgress', inv: new Map([['coins', 1000]]), invIds: new Map([[995, 1000]]),
    worn: new Set(), wornIds: new Set(), bank: new Map(), bankIds: new Map(), bankKnown: true,
    bankCoins: 10000, noProgress: 0, attack: 40, freeSlots: 27, ...extra
});
const gather = (name: string, state: QuestSnapshot) => goblindiplomacy.gather![name]!(state, 1);

test('checks an unknown bank even when the quest purse is already carried', () => {
    expect(goblinMailGatherStep(snap({bankKnown: false})).kind).toBe('scanBank');
});

test('withdraws banked goblin mail before gearing up or fighting', () => {
    const step = goblinMailGatherStep(snap({bank: new Map([['goblin mail', 3]])}), 3);
    expect(step.kind === 'withdraw' && step.items).toEqual([{name: 'Goblin mail', qty: 3}]);
});

test('withdraws the best usable banked melee weapon instead of fighting with a pickaxe', () => {
    const step = goblinMailGatherStep(snap({wornIds: new Set([1275]), bankIds: new Map([[1333, 1], [1325, 1]])}));
    expect(step.kind === 'withdraw' && step.items).toEqual([{name: 'Rune scimitar', id: 1333, qty: 1}]);
});

test('respects Attack level and dragon quest requirements', () => {
    spyOn(Quests, 'status').mockReturnValue('notStarted');
    const step = goblinMailGatherStep(snap({attack: 60, bankIds: new Map([[1305, 1], [1333, 1]])}));
    expect(step.kind === 'withdraw' && step.items[0]?.id).toBe(1333);
    const low = goblinMailGatherStep(snap({attack: 20, bankIds: new Map([[1333, 1], [1329, 1]])}));
    expect(low.kind === 'withdraw' && low.items[0]?.id).toBe(1329);
});

test('allows a higher-tier two-handed sword for goblin farming', () => {
    const step = goblinMailGatherStep(snap({bankIds: new Map([[1319, 1], [1325, 1]])}));
    expect(step.kind === 'withdraw' && step.items[0]?.id).toBe(1319);
});

test('equips the best carried weapon and never downgrades a better worn one', () => {
    expect(goblinMailGatherStep(snap({invIds: new Map([[1333, 1]]), bankIds: new Map([[1325, 1]])})))
        .toEqual({kind: 'equip', item: 'Rune scimitar'});
    const step = goblinMailGatherStep(snap({wornIds: new Set([1333]), bankIds: new Map([[1325, 1]])}));
    expect(step.kind === 'custom' && step.name).toBe('farm goblin mail');
});

test('clears inventory space before withdrawing a weapon', () => {
    const step = goblinMailGatherStep(snap({freeSlots: 0, inv: new Map([['coins', 1000], ['rune essence', 27]]), bankIds: new Map([[1333, 1]])}));
    expect(step.kind).toBe('deposit');
});

test('surplus weapons can be banked instead of filling every protected slot', () => {
    const step = goblinMailGatherStep(snap({freeSlots: 0, inv: new Map([['coins', 1000], ['iron dagger', 27]]), wornIds: new Set([1333])}));
    expect(step.kind === 'deposit' && step.keep).not.toContain('iron dagger');
    expect(goblindiplomacy.tools).not.toContain('iron dagger');
});

test('makes room for the displaced sword and shield before equipping a two-hander', () => {
    const step = goblinMailGatherStep(snap({freeSlots: 0, invIds: new Map([[1319, 1]]),
        inv: new Map([['coins', 1000], ['rune 2h sword', 1], ['rune essence', 26]]), wornIds: new Set([1325, 1179])}));
    expect(step.kind).toBe('deposit');
});

test('uses banked dye before buying ingredients', () => {
    const step = gather('orange dye', snap({bank: new Map([['orange dye', 1]])}));
    expect(step.kind === 'withdraw' && step.items).toEqual([{name: 'Orange dye', qty: 1}]);
});

test('uses banked component dyes before buying redberries or picking onions', () => {
    const step = gather('orange dye', snap({bank: new Map([['red dye', 1], ['yellow dye', 1]])}));
    expect(step.kind === 'withdraw' && step.items).toEqual([{name: 'Red dye', qty: 1}, {name: 'Yellow dye', qty: 1}]);
});

test('withdraws only missing ingredient quantities from the bank', () => {
    const orange = gather('orange dye', snap({inv: new Map([['coins', 1000], ['redberries', 1], ['yellow dye', 1]]), bank: new Map([['redberries', 10]])}));
    expect(orange.kind === 'withdraw' && orange.items).toEqual([{name: 'Redberries', qty: 2}]);
    const blue = gather('blue dye', snap({bank: new Map([['woad leaf', 2]])}));
    expect(blue.kind === 'withdraw' && blue.items).toEqual([{name: 'Woad leaf', qty: 2}]);
});

test('approaches Wyson at his Falador park spawn before buying woad', async () => {
    spyOn(Inventory, 'contains').mockReturnValue(false);
    spyOn(Inventory, 'count').mockImplementation(name => name === 'Coins' ? 1000 : 0);
    const approach = spyOn(primitives, 'gotoNpc').mockResolvedValue(false);
    const step = gather('blue dye', snap());
    expect(step.kind).toBe('custom');
    if (step.kind === 'custom') await step.run(() => {});
    expect(approach).toHaveBeenCalledWith(expect.objectContaining({anchor: new Tile(3027, 3379, 0)}), [], expect.any(Function));
});
