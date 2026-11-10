import { afterEach, expect, test } from 'bun:test';
import { ITEM_DB } from '#/bot/data/itemdb.js';
import { QuestFood } from '#/bot/api/ai/quests/food.js';
import { WT_ITEM as I } from '#/bot/api/ai/quests/defs/watchtower/areas.js';
import { decide, watchtower } from '#/bot/api/ai/quests/defs/watchtower/index.js';
import { sourceFood, sourceDeathRune, questKit } from '#/bot/api/ai/quests/defs/watchtower/supplies.js';
import { resumePreparation } from '#/bot/api/ai/quests/engine/resumePreparation.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

const previousFood = QuestFood.name;
afterEach(() => { QuestFood.name = previousFood; });
const item = (id: number, count = 1) => ({ id, count, name: Object.values(I).find(i => i.id === id)?.name ?? ITEM_DB.find(i => i.id === id)!.name });
function snapshot(stage: number, flags: string[] = [], inventory = [item(379, 8)]): QuestSnapshot {
    return { stage, progress: { stage, flags: new Set(flags) }, journal: 'inProgress',
        inv: new Map(inventory.map(i => [i.name.toLowerCase(), i.count])), invIds: new Map(inventory.map(i => [i.id, i.count])),
        worn: new Set(), bankKnown: true, bank: new Map(), bankIds: new Map(), bankCoins: 10000, noProgress: 0,
        freeSlots: 28 - inventory.reduce((n, i) => n + (i.id === 995 ? 1 : i.count), 0), tile: { x: 2612, z: 3092, level: 0 } };
}
const name = (snap: QuestSnapshot) => { const step = decide(snap); return step.kind === 'custom' ? step.name : step.kind; };

test('a consumed rope is not replenished while delivering the tooth on Grew island', () => {
    const snap = snapshot(2, ['helped-og', 'helped-toban', 'spoken-grew'], [item(I.OGRE_TOOTH.id)]);
    snap.tile = { x: 2513, z: 3084, level: 0 };
    snap.bankIds = new Map([[I.ROPE.id, 100]]);
    expect(name(snap)).toBe('talk to Grew');
});

test('an enchanted potion suppresses consumed ingredient replenishment inside the enclave', () => {
    const snap = snapshot(10, ['shamans-left:6'], [item(I.MAGIC_OGRE_POTION.id), item(379, 8)]);
    snap.tile = { x: 2588, z: 9410, level: 0 };
    snap.bankIds = new Map([[I.GUAM_LEAF.id, 100]]);
    expect(name(snap)).toBe('dissolve the ogre shamans');
});

test('partial cakes count toward the shared food target', () => {
    QuestFood.name = 'Cake';
    const snap = snapshot(10, [], [item(1893, 8)]);
    snap.bank = new Map([['cake', 100]]);
    expect(sourceFood(snap, 8)).toBeNull();
});

test('food withdrawal leaves two slots for quest items', () => {
    const snap = snapshot(10);
    snap.inv = new Map();
    snap.freeSlots = 5;
    snap.bank = new Map([['lobster', 100]]);
    const step = sourceFood(snap, 8);
    expect(step?.kind).toBe('withdraw');
    expect(step?.kind === 'withdraw' && step.items[0].qty).toBe(3);
});

test('a full pack is cleaned before attempting a banked phase kit', () => {
    const snap = snapshot(9, [], [item(1891, 20), item(I.ROPE.id, 8)]);
    snap.bankIds = new Map([[I.GUAM_LEAF.id, 1], [I.VIAL_WATER.id, 1], [I.BAT_BONES.id, 1]]);
    expect(questKit(snap, 8)?.kind).toBe('deposit');
});

test('crystal one recovery sources a rope before visiting Grew', () => {
    const snap = snapshot(10, ['shamans-left:0'], [item(I.CRYSTAL2.id), item(I.CRYSTAL3.id), item(I.CRYSTAL4.id)]);
    const step = decide(snap);
    expect(step.kind).toBe('buy');
    expect(step.kind === 'buy' && step.item).toBe('Rope');
});

test('crystal two recovery retrieves its banked map before entering the caves', () => {
    const snap = snapshot(10, ['shamans-left:0'], [item(I.CRYSTAL1.id), item(I.CRYSTAL3.id), item(I.CRYSTAL4.id)]);
    snap.bankIds = new Map([[I.SKAVID_MAP.id, 1]]);
    const step = decide(snap);
    expect(step.kind).toBe('withdraw');
    expect(step.kind === 'withdraw' && step.items.some(i => i.id === I.SKAVID_MAP.id)).toBe(true);
});

test('a banked enchanted potion is reused before brewing ingredients', () => {
    const snap = snapshot(10, ['shamans-left:4']);
    snap.bankIds = new Map([[I.MAGIC_OGRE_POTION.id, 1]]);
    const step = decide(snap);
    expect(step.kind === 'withdraw' && step.items.some(i => i.id === I.MAGIC_OGRE_POTION.id)).toBe(true);
});

test('banked berries are withdrawn rather than collected again', () => {
    const snap = snapshot(9, [], [item(I.GUAM_VIAL.id), item(I.GROUND_BAT_BONES.id)]);
    snap.bankIds = new Map([[I.JANGERBERRIES.id, 2]]);
    const step = decide(snap);
    expect(step.kind === 'withdraw' && step.items.some(i => i.id === I.JANGERBERRIES.id)).toBe(true);
});

test('death rune shopping does not require entry to the Magic Guild', () => {
    const step = sourceDeathRune(snapshot(5));
    expect(step?.kind === 'buy' && step.shop.npc).toBe('Betty');
});

test('auto retaliation is disabled in the shaman enclave', () => {
    const snap = snapshot(10);
    snap.tile = { x: 2588, z: 9410, level: 0 };
    expect(typeof watchtower.autoRetaliate === 'function' && watchtower.autoRetaliate(snap)).toBe(false);
});

test.each([[2513, 3084], [2504, 9441], [2588, 9410], [2541, 3029]])('recovery can leave the sealed pocket at %s,%s', (x, z) => {
    const tile = { x, z, level: 0 };
    expect(watchtower.resumeAt?.(tile)).toBe(true);
    expect(watchtower.recover?.(tile)?.kind).toBe('custom');
});

test('resumed pack cleanup retires potion ingredients and caps whole and partial cakes together', () => {
    QuestFood.name = 'Cake';
    const inventory = [item(I.MAGIC_OGRE_POTION.id), item(I.GUAM_LEAF.id, 3), item(1891, 5), item(1893, 12), item(I.ROPE.id, 7)];
    const snap = snapshot(10, ['shamans-left:6'], inventory);
    const plan = resumePreparation(watchtower, snap, inventory, 'Cake');
    expect(plan?.keepIds).toContain(I.MAGIC_OGRE_POTION.id);
    expect(plan?.keepIds).not.toContain(I.GUAM_LEAF.id);
    expect(plan?.keepIds).not.toContain(I.ROPE.id);
    expect(plan?.caps).toContainEqual({ id: 1893, qty: 3 });
});

test('crystal two recovery reuses the permanently unlocked gold gate', () => {
    const snap = snapshot(10, ['shamans-left:0'], [item(I.CRYSTAL1.id), item(I.CRYSTAL3.id), item(I.CRYSTAL4.id), item(I.SKAVID_MAP.id), item(I.LIT_CANDLE.id)]);
    expect(name(snap)).toBe('ask the mad skavid for another crystal');
});

test('pack cleanup retains the Nightshade needed for the next enclave entry', () => {
    const inventory = [item(I.NIGHTSHADE.id), item(I.MAGIC_OGRE_POTION.id), item(379, 26)];
    const snap = snapshot(10, ['shamans-left:6'], inventory);
    expect(resumePreparation(watchtower, snap, inventory, 'Lobster')?.keepIds).toContain(I.NIGHTSHADE.id);
});

test('a missing crystal scans the bank only after leaving Grew island', () => {
    const snap = snapshot(10, ['shamans-left:0'], [item(I.CRYSTAL2.id), item(I.CRYSTAL3.id), item(I.CRYSTAL4.id)]);
    snap.bankKnown = false;
    snap.tile = { x: 2513, z: 3084, level: 0 };
    expect(name(snap)).toBe('swing back off Grew island');
});

test('stage six can retry an already-paid gate without a spare gold bar', () => {
    const snap = snapshot(6, ['learning-skavid', 'learned-nod', 'learned-ig', 'learned-ar', 'learned-cur'], [item(I.SKAVID_MAP.id), item(I.LIT_CANDLE.id)]);
    expect(name(snap)).toBe('answer the mad skavid for a crystal');
});
