import { expect, test, describe } from 'bun:test';
import { GearLossTracker, handleLocation, isHostileEventNpc, pickSacrificial, RandomEvents } from '#/bot/runtime/randomevents/RandomEvents.js';

describe('handleLocation', () => {
    test('worn handle wins (the wielded-pick case the old scan missed)', () => {
        expect(handleLocation(['Iron ore'], ['Pickaxe handle'])).toBe('worn');
        expect(handleLocation(['Pickaxe handle'], ['Pickaxe handle'])).toBe('worn');
    });

    test('inventory handle (tool was carried, not wielded)', () => {
        expect(handleLocation(['Axe handle', 'Logs'], [])).toBe('inventory');
        expect(handleLocation(['Pickaxe handle'], ['Amulet of power'])).toBe('inventory');
    });

    test('null when no handle anywhere', () => {
        expect(handleLocation(['Iron ore', null], ['Rune pickaxe'])).toBeNull();
    });
});

describe('pickSacrificial', () => {
    test('most-duplicated non-protected item wins (the mined ore)', () => {
        expect(pickSacrificial(['Rune pickaxe', 'Iron ore', 'Iron ore', 'Uncut sapphire', 'Iron ore'])).toBe('Iron ore');
    });

    test('never drops tools or the event pieces', () => {
        expect(pickSacrificial(['Pickaxe head', 'Pickaxe handle', 'Rune pickaxe', 'Bronze axe', 'Hammer', 'Knife', 'Tinderbox'])).toBeNull();
        expect(pickSacrificial(['Fishing rod', 'Small net', 'Harpoon', 'Chisel'])).toBeNull();
    });

    test('null-safe and null on empty', () => {
        expect(pickSacrificial([null, null])).toBeNull();
        expect(pickSacrificial([])).toBeNull();
    });
});

describe('GearLossTracker', () => {
    test('gear vanishing from the pack records a recent loss', () => {
        const t = new GearLossTracker(90_000);
        t.update(['Harpoon', 'Big fishing net'], false, 1000);
        t.update(['Harpoon'], false, 2000);
        expect(t.recentlyLost('big fishing net', 2500)).toBe(true);
        expect(t.recentlyLost('harpoon', 2500)).toBe(false);
    });

    test('losses expire after the window (the ground drop despawns)', () => {
        const t = new GearLossTracker(90_000);
        t.update(['Harpoon'], false, 0);
        t.update([], false, 1000);
        expect(t.recentlyLost('harpoon', 91_001)).toBe(false);
    });

    test('bank/shop suppression covers the open AND the following update (deposits are noticed after the bank closes)', () => {
        const t = new GearLossTracker(90_000);
        t.update(['Lobster pot'], false, 0);
        t.update(['Lobster pot'], true, 1000);
        t.update([], false, 2000);
        expect(t.recentlyLost('lobster pot', 2500)).toBe(false);
    });

    test('a knock-off never seen as held records nothing (guild ground spawns)', () => {
        const t = new GearLossTracker(90_000);
        t.update([], false, 0);
        t.update([], false, 1000);
        expect(t.recentlyLost('big fishing net', 1500)).toBe(false);
    });
});

describe('isHostileEventNpc', () => {
    // River troll level-1 id = 391; faceEntity player encoding = 32768 + slot
    const riverTroll = (over: Partial<{ id: number; inCombat: boolean; distance: number; faceEntity: number }> = {}) => ({
        id: 391,
        inCombat: false,
        distance: 4,
        faceEntity: -1,
        ...over
    });

    test('adjacent hostile is always an event', () => {
        expect(isHostileEventNpc(riverTroll({ distance: 1 }), 3, false)).toBe(true);
    });

    test('hostile id within engage range is an event even with no combat/face flags (#422 Swarm)', () => {
        // Soft flags lag for 0-damage Swarm; antimacro ids only exist for the victim.
        expect(isHostileEventNpc(riverTroll({ distance: 5, faceEntity: -1, inCombat: false }), 3, false)).toBe(true);
        expect(isHostileEventNpc(riverTroll({ id: 411, distance: 4, faceEntity: -1 }), 3, false)).toBe(true);
    });

    test('hostile already in combat within engage range is an event', () => {
        expect(isHostileEventNpc(riverTroll({ distance: 6, inCombat: true }), 3, false)).toBe(true);
    });

    test('hostile far away is ignored until it closes', () => {
        expect(isHostileEventNpc(riverTroll({ distance: 12, faceEntity: 32768 + 3 }), 3, false)).toBe(false);
    });

    test('non-hostile id is never an event', () => {
        expect(isHostileEventNpc(riverTroll({ id: 1, distance: 1, inCombat: true }), 3, true)).toBe(false);
    });
});

describe('ignored randoms (#597)', () => {
    test('setIgnoredRandoms matches names case-insensitively', () => {
        RandomEvents.setIgnoredRandoms(['Swarm']);
        expect(RandomEvents.isIgnored('swarm')).toBe(true);
        expect(RandomEvents.isIgnored('SWARM')).toBe(true);
        expect(RandomEvents.isIgnored('genie')).toBe(false);
        RandomEvents.setIgnoredRandoms([]);
        expect(RandomEvents.isIgnored('swarm')).toBe(false);
    });

    test('a live provider is re-read so arena entry can start ignoring Swarm', () => {
        let inArena = false;
        RandomEvents.setIgnoredRandoms(() => (inArena ? ['swarm'] : []));
        expect(RandomEvents.isIgnored('swarm')).toBe(false);
        inArena = true;
        expect(RandomEvents.isIgnored('swarm')).toBe(true);
        RandomEvents.setIgnoredRandoms([]);
    });
});
