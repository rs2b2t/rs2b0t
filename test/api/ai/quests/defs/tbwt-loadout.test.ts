import { afterEach, expect, spyOn, test } from 'bun:test';
import { ITEM_DB } from '#/bot/data/itemdb.js';
import { QuestFood } from '#/bot/api/ai/quests/food.js';
import { tbwt, decide } from '#/bot/api/ai/quests/defs/tbwt/index.js';
import { prepare } from '#/bot/api/ai/quests/defs/tbwt/supplies.js';
import { resumePreparation } from '#/bot/api/ai/quests/engine/resumePreparation.js';
import { resolveSustainPolicy, selectSustainConsumable } from '#/bot/scripts/AIOQuester/AIOQuesterLogic.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

const previousFood = QuestFood.name;
afterEach(() => { QuestFood.name = previousFood; spyOn(Skills, 'level').mockRestore(); });
const names: Record<number, string> = { 995: 'Coins', 946: 'Knife', 303: 'Small fishing net', 233: 'Pestle and mortar', 590: 'Tinderbox', 3166: 'Monkey corpse', 401: 'Seaweed', 3148: 'Burnt karambwan', 3142: 'Raw karambwan', 3150: 'Raw karambwanji' };
const item = (id: number, count = 1) => ({ id, name: names[id] ?? ITEM_DB.find(item => item.id === id)!.name, count });
function snapshot(flags: string[], inventory = [item(995, 500), item(379, 6)], freeSlots = 28 - inventory.reduce((n, i) => n + (i.id === 995 ? 1 : i.count), 0)): QuestSnapshot {
    return {
        journal: 'inProgress', stage: 3, progress: { stage: 3, flags: new Set(flags) },
        inv: new Map(inventory.map(i => [i.name.toLowerCase(), i.count])), invIds: new Map(inventory.map(i => [i.id, i.count])),
        worn: new Set(['maple shortbow', 'adamant arrow', 'rune chainbody', 'rune platelegs', 'rune full helm']),
        bankKnown: true, bank: new Map(), bankIds: new Map(), bankCoins: 1000, ranged: 70, noProgress: 0,
        freeSlots, tile: { x: 2780, z: 3087, level: 0 }
    };
}
const early = ['lubufu:5', 'tiadeche:0', 'tamayu:0', 'tinsay:0'];
const tamayu = ['lubufu:31', 'tiadeche:4', 'tamayu:3', 'tinsay:0', 'agility'];
const sandwich = ['lubufu:31', 'tiadeche:4', 'tamayu:4', 'tinsay:4'];

test('Lubufu can proceed with a net and food without future potions, spear or recipe tools', () => {
    const snap = snapshot(early, [item(995, 500), item(379, 6), item(303)]);
    expect(prepare(snap)).toBeNull();
    expect(decide(snap).kind).toBe('custom');
});

test('a full partial catch is delivered before any banking or supply check', () => {
    const snap = snapshot(early, [item(3150, 20), item(379, 8)], 0);
    const step = decide(snap);
    expect(step.kind === 'custom' && step.name).toContain('hand Lubufu');
});

test('sandwich preparation retires the knife and preserves the corpse when making space', () => {
    const snap = snapshot(sandwich, [item(995, 500), item(379, 6), item(946), item(3166), item(401)], 0);
    const step = prepare(snap);
    expect(step?.kind).toBe('deposit');
    if (step?.kind !== 'deposit') return;
    expect(step.keepIds).not.toContain(946);
    expect(step.keepIds).toContain(3166);
    expect(step.keepIds).toContain(401);
});

test('recovery removes retired tools and caps mixed whole and partial food together', () => {
    QuestFood.name = 'Cake';
    const inv = [item(946), item(303), item(233), item(590), item(3166), item(401), item(1891, 4), item(1893, 4)];
    const plan = resumePreparation(tbwt, snapshot(sandwich, inv, 0), inv, 'Cake');
    expect(plan?.keepIds).toContain(3166);
    for (const id of [946, 303, 233, 590]) expect(plan?.keepIds).not.toContain(id);
    expect(plan?.caps).toContainEqual({ id: 1893, qty: 2 });
});

test('fallback food selected by the supply planner is eligible for eating', () => {
    const lobster = { name: 'Lobster', actions: () => ['Eat'] };
    expect(selectSustainConsumable([lobster], resolveSustainPolicy('Cake', tbwt.sustain).foods, 10, 70)?.item).toBe(lobster);
});

test('a burned gift below 65 Fishing does not send the bot to fish replacement Karambwan', () => {
    spyOn(Skills, 'level').mockReturnValue(40);
    const snap = snapshot(tamayu, [item(995, 500), item(379, 6), item(303), item(233), item(1239), item(3148)]);
    const step = decide(snap);
    expect(step.kind).toBe('wait');
    expect(step.kind === 'wait' && step.reason).toContain('65 Fishing');
});

test('a banked replacement Karambwan is withdrawn before attempting fishing', () => {
    spyOn(Skills, 'level').mockReturnValue(40);
    const snap = snapshot(tamayu, [item(995, 500), item(379, 6), item(303), item(233), item(1239)]);
    snap.bankIds = new Map([[3142, 1]]);
    snap.bank = new Map([['raw karambwan', 1]]);
    const step = decide(snap);
    expect(step.kind).toBe('withdraw');
    expect(step.kind === 'withdraw' && step.items).toContainEqual({ name: 'Raw karambwan', id: 3142, qty: 1 });
});

test('bank withdrawal makes room for supplies as well as the next fishing action', () => {
    const snap = snapshot(tamayu, [item(995, 500), item(379, 6)], 7);
    snap.bankIds = new Map([[303, 1], [233, 1], [1239, 1]]);
    snap.bank = new Map([['small fishing net', 1], ['pestle and mortar', 1], ['iron spear', 1]]);
    const step = prepare(snap);
    expect(step?.kind).toBe('deposit');
});

test('finishing the rum recipe takes priority over banking a full pack', () => {
    const snap = snapshot(['lubufu:31', 'tiadeche:4', 'tamayu:4', 'tinsay:2'], [
        item(995, 500), item(379, 8), { id: 3162, name: 'Sliced banana', count: 1 }, { id: 431, name: 'Karamjan rum', count: 1 }
    ], 0);
    const step = decide(snap);
    expect(step.kind === 'custom' && step.name).toContain('drop the banana slices');
});

test('recovery with incomplete brother progress preserves supplies conservatively', () => {
    const inventory = [item(946), item(303), item(233), item(590)];
    const plan = resumePreparation(tbwt, snapshot(['tiadeche:4'], inventory, 0), inventory, 'Cake');
    for (const id of [946, 303, 233, 590]) expect(plan?.keepIds ?? inventory.map(i => i.id)).toContain(id);
});

test('a crowded resumed rum pack slices its banana before trying to bank', () => {
    const snap = snapshot(['lubufu:31', 'tiadeche:4', 'tamayu:4', 'tinsay:2'], [
        item(995, 500), item(379, 8), item(946), { id: 1963, name: 'Banana', count: 1 }, { id: 431, name: 'Karamjan rum', count: 1 }
    ], 0);
    const step = decide(snap);
    expect(step.kind === 'custom' ? step.name : step.kind).toBe('slice the banana');
});

test.each([
    [2, [{ id: 3159, name: 'Karambwan vessel', count: 1 }], 'hand Tiadeche the baited vessel'],
    [3, [], 'ask Tiadeche what he needs next']
])('Tiadeche stage %s proceeds without an obsolete net', (stage, extras, name) => {
    const snap = snapshot(['lubufu:31', `tiadeche:${stage}`, 'tamayu:0', 'tinsay:0'], [item(995, 500), item(379, 6), ...extras]);
    const step = decide(snap);
    expect(step.kind === 'custom' ? step.name : step.kind).toBe(name);
});

test('the bones recipe uses carried bait without requiring another net', () => {
    const snap = snapshot(['lubufu:31', 'tiadeche:4', 'tamayu:4', 'tinsay:6'], [
        item(995, 500), item(379, 6), item(233), item(3150), { id: 3127, name: 'Burnt jogre bones', count: 1 }
    ]);
    const step = decide(snap);
    expect(step.kind === 'custom' ? step.name : step.kind).toBe('grind the Karambwanji into paste');
});

test('recovery banks spare weapons when the ranged weapon is already worn', () => {
    const inventory = [item(379, 6), item(1333), item(1323), item(3166), item(401)];
    const plan = resumePreparation(tbwt, snapshot(sandwich, inventory, 0), inventory, 'Lobster');
    expect(plan?.keepIds).not.toContain(1333);
    expect(plan?.keepIds).not.toContain(1323);
    expect(plan?.keepIds).toContain(3166);
});
