import { describe, expect, test } from 'bun:test';
import {
    DEFAULT_CHASE_RADIUS,
    HOME_ARRIVE_RADIUS,
    LOCAL_MINE_PREFER_RADIUS,
    NAMED_CAMP_LEASH_FLOOR,
    effectiveGatherLeash,
    fishingSessionBroken,
    gatherHuntRadius,
    gatherSpotRangeOrigin,
    hostileAttackerNearby,
    shouldFleeCombat,
    isAutoLocation,
    pickNearestPreferLocal,
    resourceWithinCamp,
    shouldCooldownGatherTile,
    shouldSoftHomeFromGatherMiss,
    shouldWalkHomeToGatherAnchor,
    shouldYieldGathering,
    spotWithinGatherRange
} from '#/bot/scripts/GatheringBot.js';
import { AXE_BAR_FOR } from '#/bot/api/ToolAcquire.js';
import { DEFAULT_CAMP_RADIUS, resolveCampRadius, resolveChaseRadius } from '#/bot/api/GatheringLocations.js';
import Tile from '#/bot/api/Tile.js';

describe('HOME_ARRIVE_RADIUS (soft home after bank/shop)', () => {
    test('is a camp disk, not a single pin tile', () => {
        expect(HOME_ARRIVE_RADIUS).toBe(8);
        const anchor = new Tile(2845, 3431, 0);
        // Inside disk → walkHomeIfNeeded short-circuits (no robotic pin).
        expect(anchor.distanceTo(new Tile(2845 + 8, 3431, 0))).toBe(8);
        expect(anchor.distanceTo(new Tile(2845 + 9, 3431, 0))).toBe(9);
    });
});

describe('shouldWalkHomeToGatherAnchor (#154 post-bank)', () => {
    // Catherby pier anchor + bank stand (FishingLocations).
    const catherbySpot = new Tile(2845, 3431, 0);
    const catherbyBank = new Tile(2809, 3441, 0);

    test('Catherby bank is inside named-camp leash but outside soft arrive disk', () => {
        const bankDist = catherbySpot.distanceTo(catherbyBank);
        expect(bankDist).toBe(36);
        expect(bankDist).toBeLessThanOrEqual(NAMED_CAMP_LEASH_FLOOR);
        expect(bankDist).toBeGreaterThan(HOME_ARRIVE_RADIUS);
        // Full-leash "already home" was the bug — bank must still request a walk.
        expect(shouldWalkHomeToGatherAnchor(bankDist)).toBe(true);
        expect(shouldWalkHomeToGatherAnchor(bankDist, NAMED_CAMP_LEASH_FLOOR)).toBe(false);
    });

    test('skips walk only inside the soft arrive disk', () => {
        expect(shouldWalkHomeToGatherAnchor(0)).toBe(false);
        expect(shouldWalkHomeToGatherAnchor(HOME_ARRIVE_RADIUS)).toBe(false);
        expect(shouldWalkHomeToGatherAnchor(HOME_ARRIVE_RADIUS + 1)).toBe(true);
        // Draynor bank ~12 from willows — short walk into arrive disk is correct.
        expect(shouldWalkHomeToGatherAnchor(12)).toBe(true);
    });

    test('null / non-finite distance does not force a walk', () => {
        expect(shouldWalkHomeToGatherAnchor(null)).toBe(false);
        expect(shouldWalkHomeToGatherAnchor(undefined)).toBe(false);
        expect(shouldWalkHomeToGatherAnchor(Number.NaN)).toBe(false);
    });
});

describe('gatherSpotRangeOrigin (Auto freeform fish vs named camp)', () => {
    test('freeform fish with a live player tile measures from the player', () => {
        // Ardougne river: after hunting toward a hop, spots near the player must
        // still count even when far from the start-tile anchor.
        expect(gatherSpotRangeOrigin(true, true)).toBe('player');
        expect(gatherSpotRangeOrigin(true, true, false)).toBe('player');
    });

    test('named camp measures from the player (pier hop chase)', () => {
        // Spot beside the player mid-pier must count even when far from the home pin.
        expect(gatherSpotRangeOrigin(false, true, true)).toBe('player');
        // Freeform flag false + named still player.
        expect(gatherSpotRangeOrigin(false, true, true)).toBe('player');
    });

    test('loc freeform (non-fish) without named camp pins the anchor', () => {
        expect(gatherSpotRangeOrigin(false, true, false)).toBe('anchor');
    });

    test('without a player tile falls back to anchor', () => {
        expect(gatherSpotRangeOrigin(true, false)).toBe('anchor');
        expect(gatherSpotRangeOrigin(false, false, true)).toBe('anchor');
    });

    test('spotWithinGatherRange is inclusive Chebyshev disk', () => {
        // Stuck tile 2582,3353 vs start 2566,3374 is cheb 21 — outside a 10 leash
        // from start, but a spot 3 tiles from the player is still fishable freeform.
        expect(spotWithinGatherRange(3, 40)).toBe(true);
        expect(spotWithinGatherRange(40, 40)).toBe(true);
        expect(spotWithinGatherRange(41, 40)).toBe(false);
        expect(spotWithinGatherRange(21, 10)).toBe(false);
        expect(spotWithinGatherRange(Number.NaN, 40)).toBe(false);
    });
});

describe('resourceWithinCamp + chase (named camp hop fence)', () => {
    test('camp membership is inclusive Chebyshev from home pin', () => {
        expect(resourceWithinCamp(0, NAMED_CAMP_LEASH_FLOOR)).toBe(true);
        expect(resourceWithinCamp(64, NAMED_CAMP_LEASH_FLOOR)).toBe(true);
        expect(resourceWithinCamp(65, NAMED_CAMP_LEASH_FLOOR)).toBe(false);
        // Spot 72 from pin (old "leash+8" stuck) is outside default membership.
        expect(resourceWithinCamp(72, NAMED_CAMP_LEASH_FLOOR)).toBe(false);
        // Wider per-camp membership covers long piers.
        expect(resourceWithinCamp(72, 80)).toBe(true);
    });

    test('named camps accept any spot inside membership (no player-distance wall)', () => {
        // Spot 50 from player is still valid if within camp membership of home.
        expect(resourceWithinCamp(50, NAMED_CAMP_LEASH_FLOOR)).toBe(true);
        expect(resourceWithinCamp(64, NAMED_CAMP_LEASH_FLOOR)).toBe(true);
        // Outside membership → wrong coastline / off-camp.
        expect(resourceWithinCamp(70, NAMED_CAMP_LEASH_FLOOR)).toBe(false);
        // Wider per-camp membership covers long piers past the old ~72 stuck.
        expect(resourceWithinCamp(72, 80)).toBe(true);
    });

    test('resolveCampRadius / freeform hunt defaults', () => {
        expect(DEFAULT_CAMP_RADIUS).toBe(64);
        expect(DEFAULT_CHASE_RADIUS).toBe(40);
        expect(resolveCampRadius(undefined)).toBe(64);
        expect(resolveCampRadius(48)).toBe(48);
        expect(resolveChaseRadius(undefined)).toBe(40);
        expect(resolveChaseRadius(30)).toBe(30);
        // Freeform hunt: L+24 floor 48 — leash 28 → 52, not the old "40 of you" wall.
        expect(gatherHuntRadius(28)).toBe(52);
        expect(gatherHuntRadius(18)).toBe(48);
        expect(gatherHuntRadius(40)).toBe(64);
    });
});

describe('shouldSoftHomeFromGatherMiss (gather no-target thrash)', () => {
    test('does not thrash on freeform pier-hops just outside the 8-tile disk', () => {
        // Bank/restock still use the tight disk; gather miss must not.
        expect(shouldWalkHomeToGatherAnchor(12)).toBe(true);
        expect(shouldSoftHomeFromGatherMiss(12)).toBe(false);
        expect(shouldSoftHomeFromGatherMiss(HOME_ARRIVE_RADIUS + 1)).toBe(false);
        expect(shouldSoftHomeFromGatherMiss(19)).toBe(false);
    });

    test('pulls home from bank square / long wander', () => {
        // Default leash = NAMED_CAMP_LEASH_FLOOR → threshold max(20, min(L,28)) = 28.
        expect(shouldSoftHomeFromGatherMiss(20)).toBe(false);
        expect(shouldSoftHomeFromGatherMiss(28)).toBe(false);
        expect(shouldSoftHomeFromGatherMiss(29)).toBe(true);
        // Catherby bank ~36 from pier — clearly off-camp.
        expect(shouldSoftHomeFromGatherMiss(36)).toBe(true);
        // Varrock W bank → SW mine is far past any camp disk.
        expect(shouldSoftHomeFromGatherMiss(69)).toBe(true);
    });

    test('respects a tight freeform leash without using the soft disk', () => {
        // leash 12 → threshold max(20, min(12,28)) = 20 (HOME+12 floor).
        expect(shouldSoftHomeFromGatherMiss(15, 12)).toBe(false);
        expect(shouldSoftHomeFromGatherMiss(21, 12)).toBe(true);
        // Huge leash still caps threshold at 28.
        expect(shouldSoftHomeFromGatherMiss(28, 64)).toBe(false);
        expect(shouldSoftHomeFromGatherMiss(29, 64)).toBe(true);
    });

    test('null / non-finite distance does not force a walk', () => {
        expect(shouldSoftHomeFromGatherMiss(null)).toBe(false);
        expect(shouldSoftHomeFromGatherMiss(undefined)).toBe(false);
        expect(shouldSoftHomeFromGatherMiss(Number.NaN)).toBe(false);
    });
});

describe('hostileAttackerNearby (post-kite camp suppress)', () => {
    const npc = (partial: {
        dist: number;
        attack?: boolean;
        targetsMe?: boolean;
        inCombat?: boolean;
        targetsAnother?: boolean;
    }) => ({
        inCombat: partial.inCombat ?? false,
        targetsMe: () => partial.targetsMe ?? false,
        targetsAnotherPlayer: () => partial.targetsAnother ?? false,
        actions: () => (partial.attack === false ? ['Talk-to'] : ['Attack']),
        distance: () => partial.dist
    });

    test('empty / non-attackers are clear', () => {
        expect(hostileAttackerNearby([])).toBe(false);
        expect(hostileAttackerNearby([npc({ dist: 2, attack: false, targetsMe: true })])).toBe(false);
        expect(hostileAttackerNearby([npc({ dist: 20, targetsMe: true })])).toBe(false);
    });

    test('attacker targeting us within radius is hostile', () => {
        expect(hostileAttackerNearby([npc({ dist: 5, targetsMe: true })])).toBe(true);
        expect(hostileAttackerNearby([npc({ dist: 5, targetsMe: true })], 4)).toBe(false);
    });

    test('adjacent multi-combat pack member counts even if not on us', () => {
        expect(
            hostileAttackerNearby([npc({ dist: 2, inCombat: true, targetsAnother: false })])
        ).toBe(true);
        // Fighting someone else a bit further out is not our problem.
        expect(
            hostileAttackerNearby([npc({ dist: 5, inCombat: true, targetsAnother: false })])
        ).toBe(false);
        expect(
            hostileAttackerNearby([npc({ dist: 1, inCombat: true, targetsAnother: true })])
        ).toBe(false);
    });
});

describe('shouldFleeCombat (no blind kite on sticky combatCycle)', () => {
    test('requires combat + real attacker, not sticky flag alone', () => {
        expect(shouldFleeCombat({ inCombat: true, eventPending: false, hasAttacker: true })).toBe(true);
        expect(shouldFleeCombat({ inCombat: true, eventPending: false, hasAttacker: false })).toBe(false);
        expect(shouldFleeCombat({ inCombat: false, eventPending: false, hasAttacker: true })).toBe(false);
    });

    test('yields while a random event is pending', () => {
        expect(shouldFleeCombat({ inCombat: true, eventPending: true, hasAttacker: true })).toBe(false);
    });
});

describe('effectiveGatherLeash', () => {
    test('Auto keeps the UI setting (freeform / unverified snaps)', () => {
        expect(effectiveGatherLeash(12, 'Auto')).toBe(12);
        expect(effectiveGatherLeash(18, 'auto')).toBe(18);
        expect(effectiveGatherLeash(40, 'Auto')).toBe(40);
        expect(effectiveGatherLeash(64, 'Auto')).toBe(64);
    });

    test('named camps floor to NAMED_CAMP_LEASH_FLOOR (Fishing Guild / Catherby-scale)', () => {
        expect(effectiveGatherLeash(10, 'Catherby')).toBe(NAMED_CAMP_LEASH_FLOOR);
        expect(effectiveGatherLeash(18, 'Catherby')).toBe(NAMED_CAMP_LEASH_FLOOR);
        expect(effectiveGatherLeash(12, 'Southwest Varrock Mine')).toBe(NAMED_CAMP_LEASH_FLOOR);
        expect(effectiveGatherLeash(18, 'Fishing Guild')).toBe(NAMED_CAMP_LEASH_FLOOR);
        expect(effectiveGatherLeash(40, 'Draynor Village')).toBe(NAMED_CAMP_LEASH_FLOOR);
        expect(effectiveGatherLeash(64, 'Draynor Village')).toBe(64);
    });

    test('None (power) also floors — start-tile clusters need width', () => {
        expect(effectiveGatherLeash(10, 'None')).toBe(NAMED_CAMP_LEASH_FLOOR);
        expect(effectiveGatherLeash(8, 'none')).toBe(NAMED_CAMP_LEASH_FLOOR);
    });
});

describe('isAutoLocation', () => {
    test('only Auto is expert freeform (no mob flee)', () => {
        expect(isAutoLocation('Auto')).toBe(true);
        expect(isAutoLocation(' auto ')).toBe(true);
        expect(isAutoLocation('Fishing Guild')).toBe(false);
        expect(isAutoLocation('None')).toBe(false);
    });
});

describe('gatherHuntRadius', () => {
    test('extends past freeform leash without a hard 40 cap', () => {
        expect(gatherHuntRadius(18)).toBe(48);
        expect(gatherHuntRadius(28)).toBe(52);
        expect(gatherHuntRadius(40)).toBe(64);
        expect(gatherHuntRadius(NAMED_CAMP_LEASH_FLOOR)).toBe(NAMED_CAMP_LEASH_FLOOR + 24);
    });
});

describe('pickNearestPreferLocal (mine/chop target pick)', () => {
    const rock = (id: string, dist: number) => ({ id, dist });

    test('prefers local cluster when any rock is within prefer radius', () => {
        // Dwarven-style: iron 3 tiles away and iron 28 tiles across the tunnel.
        const near = rock('near', 3);
        const far = rock('far', 28);
        expect(LOCAL_MINE_PREFER_RADIUS).toBe(12);
        expect(pickNearestPreferLocal([far, near], r => r.dist)?.id).toBe('near');
        // Far alone still returns far when nothing local is up.
        expect(pickNearestPreferLocal([far], r => r.dist)?.id).toBe('far');
    });

    test('among local rocks picks the closest', () => {
        const a = rock('a', 5);
        const b = rock('b', 2);
        const far = rock('far', 40);
        expect(pickNearestPreferLocal([a, far, b], r => r.dist)?.id).toBe('b');
    });

    test('empty candidates → null', () => {
        expect(pickNearestPreferLocal([], () => 0)).toBe(null);
    });

    test('preferRadius 0 falls back to global nearest', () => {
        const near = rock('near', 3);
        const far = rock('far', 28);
        expect(pickNearestPreferLocal([far, near], r => r.dist, 0)?.id).toBe('near');
    });
});

describe('shouldCooldownGatherTile (iron respawn thrash)', () => {
    test('does not cooldown after a successful ore/log', () => {
        // Iron respawn ~6t; old always-cooldown 8t sent the bot across the mine.
        expect(shouldCooldownGatherTile(true, true)).toBe(false);
        expect(shouldCooldownGatherTile(true, false)).toBe(false);
    });

    test('cools only failed clicks when other targets exist', () => {
        expect(shouldCooldownGatherTile(false, true)).toBe(true);
        expect(shouldCooldownGatherTile(false, false)).toBe(false);
    });
});

describe('shouldYieldGathering', () => {
    test('a pending random event interrupts an active gather loop', () => {
        expect(shouldYieldGathering(true, false, false, false)).toBe(true);
    });

    test('an uninterrupted gather loop keeps waiting', () => {
        expect(shouldYieldGathering(false, false, false, false)).toBe(false);
    });

    test('existing full-pack, dialog, and missing-target exits remain intact', () => {
        expect(shouldYieldGathering(false, true, false, false)).toBe(true);
        expect(shouldYieldGathering(false, false, true, false)).toBe(true);
        expect(shouldYieldGathering(false, false, false, true)).toBe(true);
    });

    test('combat yields so river troll / swarm can be handled', () => {
        expect(shouldYieldGathering(false, false, false, false, true)).toBe(true);
        expect(shouldYieldGathering(false, false, false, false, false)).toBe(false);
    });

    test('allowCombat keeps gathering during retaliate tick-manip (#160)', () => {
        expect(shouldYieldGathering(false, false, false, false, true, true)).toBe(false);
        expect(shouldYieldGathering(false, false, false, false, true, false)).toBe(true);
        // Non-combat exits still win even when combat is allowed.
        expect(shouldYieldGathering(true, false, false, false, true, true)).toBe(true);
        expect(shouldYieldGathering(false, true, false, false, true, true)).toBe(true);
        expect(shouldYieldGathering(false, false, true, false, true, true)).toBe(true);
        expect(shouldYieldGathering(false, false, false, true, true, true)).toBe(true);
    });
});

describe('AXE_BAR_FOR (smith restock keep)', () => {
    test('maps every smithable axe to a bar name restock must retain', () => {
        expect(AXE_BAR_FOR['Rune axe']).toBe('Runite bar');
        expect(AXE_BAR_FOR['Mithril axe']).toBe('Mithril bar');
        expect(Object.values(AXE_BAR_FOR).length).toBeGreaterThanOrEqual(6);
        expect(new Set(Object.values(AXE_BAR_FOR)).has('Runite bar')).toBe(true);
    });
});

describe('fishingSessionBroken', () => {
    const calm = {
        eventPending: false,
        inventoryFull: false,
        dialogPending: false,
        inCombat: false,
        spotGone: false,
        spotMoved: false,
        becameWhirlpool: false
    };

    test('calm session keeps fishing', () => {
        expect(fishingSessionBroken(calm)).toBe(false);
    });

    test('spot hop ends the session even while animating', () => {
        expect(fishingSessionBroken({ ...calm, spotMoved: true })).toBe(true);
    });

    test('whirlpool swap ends the session', () => {
        expect(fishingSessionBroken({ ...calm, becameWhirlpool: true })).toBe(true);
    });

    test('spot despawn ends the session', () => {
        expect(fishingSessionBroken({ ...calm, spotGone: true })).toBe(true);
    });

    test('combat / event / full pack / dialog all break', () => {
        expect(fishingSessionBroken({ ...calm, inCombat: true })).toBe(true);
        expect(fishingSessionBroken({ ...calm, eventPending: true })).toBe(true);
        expect(fishingSessionBroken({ ...calm, inventoryFull: true })).toBe(true);
        expect(fishingSessionBroken({ ...calm, dialogPending: true })).toBe(true);
    });

    test('allowCombat keeps fishing during Tannerfishing / retaliate (#160)', () => {
        expect(fishingSessionBroken({ ...calm, inCombat: true, allowCombat: true })).toBe(false);
        expect(fishingSessionBroken({ ...calm, inCombat: true, allowCombat: false })).toBe(true);
        // Spot/event exits still break even when combat is allowed.
        expect(fishingSessionBroken({ ...calm, inCombat: true, allowCombat: true, spotGone: true })).toBe(true);
        expect(fishingSessionBroken({ ...calm, inCombat: true, allowCombat: true, eventPending: true })).toBe(true);
        expect(fishingSessionBroken({ ...calm, inCombat: true, allowCombat: true, inventoryFull: true })).toBe(true);
    });
});
