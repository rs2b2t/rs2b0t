import { expect, test, describe } from 'bun:test';
import { GearLossTracker, handleLocation, isEntHijack, isHostileEventNpc, pickSacrificial, RandomEvents } from '#/bot/runtime/randomevents/RandomEvents.js';

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
    const ids = [391, 392, 393, 394, 395, 396, 408, 411, 413, 414, 415, 416, 417, 418,
        419, 420, 421, 422, 423, 424, 425, 426, 427, 428, 429, 430, 431, 432, 433, 434,
        435, 436, 438, 439, 440, 441, 442, 443];
    const hostile = (id: number, faceEntity = 32771, distance = 4, inCombat = false) => ({
        id, inCombat, distance, faceEntity
    });

    test.each(ids)('NPC %i waits for damage even when adjacent, targeting us, or in combat', id => {
        expect(isHostileEventNpc(hostile(id, -1, 1), 3, false)).toBe(false);
        expect(isHostileEventNpc(hostile(id), 3, false)).toBe(false);
        expect(isHostileEventNpc(hostile(id, 32771, 1, true), 3, false)).toBe(false);
    });

    test.each(ids)('NPC %i triggers after damaging us without needing to receive a hit itself', id => {
        expect(isHostileEventNpc(hostile(id), 3, true)).toBe(true);
    });

    test.each(ids)('NPC %i does not inherit damage from an unrelated fight', id => {
        expect(isHostileEventNpc(hostile(id, -1), 3, true)).toBe(false);
        expect(isHostileEventNpc(hostile(id, 32777, 1, true), 3, true)).toBe(false);
    });

    test('the attacker must be within range and the local slot must be known', () => {
        expect(isHostileEventNpc(hostile(431, 32771, 8), 3, true)).toBe(true);
        expect(isHostileEventNpc(hostile(431, 32771, 9), 3, true)).toBe(false);
        expect(isHostileEventNpc(hostile(431, 32767), -1, true)).toBe(false);
    });

    test.each([1, 407, 409, 412, 437, 444, 452, 453])('non-hostile NPC %i never triggers evasion', id => {
        expect(isHostileEventNpc(hostile(id), 3, true)).toBe(false);
    });
});

describe('isEntHijack', () => {
    const ent = (over: Partial<{ id: number; index: number; distance: number }> = {}) => ({
        id: 444,
        index: 12,
        distance: 1,
        ...over
    });

    test('facing the Ent while chopping it is a hijack', () => {
        expect(isEntHijack(ent(), 12, true)).toBe(true);
        expect(isEntHijack(ent({ id: 452, index: 7 }), 7, true)).toBe(true);
    });

    test('a neighbour loc chop (not facing the Ent) is not a hijack', () => {
        expect(isEntHijack(ent(), -1, true)).toBe(false);
        expect(isEntHijack(ent(), 99, true)).toBe(false);
    });

    test('standing next to an Ent after cancelling is not a hijack', () => {
        expect(isEntHijack(ent(), 12, false)).toBe(false);
    });

    test('an Ent more than one tile away is not our loc', () => {
        expect(isEntHijack(ent({ distance: 2 }), 12, true)).toBe(false);
    });

    test('tree spirit and suit of armour ids are outside the Ent range', () => {
        expect(isEntHijack(ent({ id: 443 }), 12, true)).toBe(false);
        expect(isEntHijack(ent({ id: 453 }), 12, true)).toBe(false);
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
