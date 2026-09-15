import { expect, test } from 'bun:test';
import { assessLootSequence, type LootEvent } from '../../e2e/jivedragons-loot-sequence.js';

const anchor = { x: 2836, z: 9817 };
const event = (at: number, action: LootEvent['action'], item = '', tile = anchor): LootEvent => ({ at, action, item, tile, anchor, used: 28, sharks: 22, prayerXp: 0, hideCount: at >= 6 ? 1 : 0, groundSharks: 0 });
const good = [event(0, 'death'), event(1, 'Drop', 'Shark'), event(2, 'Take', 'Dragon bones'),
    { ...event(3, 'Bury', 'Dragon bones'), used: 28 }, { ...event(4, 'tick'), used: 27, prayerXp: 72 },
    event(5, 'Take', 'Dragonhide'), event(6, 'Take', 'Coins'), { ...event(7, 'tick'), used: 28 }, event(8, 'Attack')];

test('accepts full-food bones burial hide other and return without reclaim when full', () => {
    expect(assessLootSequence(good).violations).toEqual([]);
});
test('allows last food to free a safe slot under approved recovery policy', () => {
    expect(assessLootSequence(good.map(e => ({ ...e, sharks: 1 }))).violations).toEqual([]);
});
test('rejects food Drop during dangerous HP or an owned fight', () => {
    expect(assessLootSequence(good.map(e => ({ ...e, danger: true }))).violations).toContain('dangerous-food-drop');
    expect(assessLootSequence(good.map(e => ({ ...e, ownedAlive: true }))).violations).toContain('fight-preemption');
});
test('rejects corpse starvation after a full-food death', () => {
    expect(assessLootSequence([event(0, 'death'), event(20000, 'Attack')]).violations).toContain('corpse-starvation');
});
test('rejects dropping food at the corpse instead of the safe anchor', () => {
    expect(assessLootSequence(good.map(e => e.action === 'Drop' ? { ...e, tile: { x: 2836, z: 9822 } } : e)).violations).toContain('unsafe-food-drop');
});
test('rejects taking hide before bones were buried', () => {
    const changed = good.map(e => e.at === 2 ? { ...e, item: 'Dragonhide' } : e);
    expect(assessLootSequence(changed).violations).toContain('hide-before-bury');
});
test('rejects missing return after collecting the corpse', () => {
    const changed = good.map(e => e.at >= 5 ? { ...e, tile: { x: 2836, z: 9822 } } : e);
    expect(assessLootSequence(changed).violations).toContain('missing-return');
});
test('rejects a full-pack food reclaim attempt', () => {
    expect(assessLootSequence([...good.slice(0, -1), event(8, 'Take', 'Shark')]).violations).toContain('full-food-reclaim');
});
test('requires own food reclamation when space remains after return', () => {
    const changed = good.map(e => e.at >= 7 ? { ...e, used: 27 } : e);
    expect(assessLootSequence(changed).violations).toContain('missing-food-reclaim');
});
test('rejects bury calls without a real prayer-XP increase', () => {
    expect(assessLootSequence(good.map(e => ({ ...e, prayerXp: 0 }))).violations).toContain('burial-unconfirmed');
});
test('rejects a hide Take without an inventory increase', () => {
    expect(assessLootSequence(good.map(e => ({ ...e, hideCount: 0 }))).violations).toContain('hide-unconfirmed');
});
test('rejects other loot before hide', () => {
    expect(assessLootSequence([...good, event(4.5, 'Take', 'Coins')].sort((a, b) => a.at - b.at)).violations).toContain('other-before-hide');
});
test('does not require reclaiming unrelated food at the anchor', () => {
    const changed = good.map(e => ({ ...e, groundSharks: 1, used: e.at >= 7 ? 27 : e.used }));
    expect(assessLootSequence(changed).violations).not.toContain('missing-food-reclaim');
});
test('rejects reclaiming food and dropping it again within one corpse run', () => {
    const cycle = [...good.slice(0, -1), { ...event(7.1, 'Take', 'Shark'), used: 27 }, event(7.2, 'Drop', 'Shark'), event(8, 'Attack')];
    expect(assessLootSequence(cycle).violations).toContain('food-drop-reclaim-loop');
});
test('requires an actual inventory gain after a safe food reclaim', () => {
    const reclaim = { ...event(7.1, 'Take', 'Shark'), used: 27 };
    expect(assessLootSequence([...good.slice(0, -1), reclaim, event(8, 'Attack')]).violations).toContain('food-reclaim-unconfirmed');
    expect(assessLootSequence([...good.slice(0, -1), reclaim, { ...event(8, 'Attack'), sharks: 23 }]).violations).toEqual([]);
});
