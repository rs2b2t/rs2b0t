import { describe, expect, test } from 'bun:test';
import { Game } from '#/bot/api/game/Game.js';
import ChaosDruidKiller, { SETTINGS } from '#/bot/scripts/ChaosDruidKiller/ChaosDruidKiller.js';
import {
    CHAOS_DRUID_FIELD,
    CHAOS_DRUID_FIELD_RADIUS,
    chaosDruidArea,
    chaosDruidBankReason,
    chaosDruidBankRunReady,
    chaosDruidDropMerges,
    chaosDruidEatReady,
    chaosDruidFoodShortfall,
    chaosDruidLootSpaceAction,
    chaosDruidRespawned,
    DRUID_SPOTS,
    inChaosDruidField,
    inChaosDruidTower,
    inEdgevilleDungeon,
    shouldExitTowerForSwarm,
    swarmNpcNearby,
    TOWER_SWARM_FLEE,
    isChaosDruidLoot,
    yanilleZone
} from '#/bot/scripts/ChaosDruidKiller/ChaosDruidLogic.js';

const trip = (overrides: Partial<Parameters<typeof chaosDruidBankReason>[0]> = {}) => ({
    tripPrepared: true,
    inventoryFull: false,
    wantedLootVisible: false,
    foodCount: 12,
    hpFraction: 1,
    panicHpFraction: 0.35,
    ...overrides
});

describe('ChaosDruid settings', () => {
    test('takes its food from the loadout, with a bounded selectable trip amount', () => {
        expect(SETTINGS.food).toBeUndefined();
        expect(SETTINGS.loadout).toMatchObject({ optionsFrom: 'loadouts' });
        expect(SETTINGS.foodWithdraw).toMatchObject({ default: 12, min: 1, max: 27 });
    });

    test('exposes no-food retreat threshold (eat threshold is food-heal based)', () => {
        expect(SETTINGS.eatAtHp).toBeUndefined();
        expect(SETTINGS.panicHp).toMatchObject({ default: 35, min: 1, max: 98 });
    });
});

describe('ChaosDruid trip lifecycle', () => {
    test('a surface start always prepares a clean, configured trip at the bank', () => {
        expect(chaosDruidBankReason(trip({ tripPrepared: false }))).toBe('prepare-trip');
    });

    test('a prepared surface trip does not loop back into banking', () => {
        expect(chaosDruidBankReason(trip({ tripPrepared: true }))).toBeNull();
    });

    test('an underfed dungeon start leaves immediately to prepare a trip', () => {
        expect(chaosDruidBankReason(trip({ tripPrepared: false, foodCount: 0 }))).toBe('prepare-trip');
    });

    test('a full pack ends the trip after all food slots became loot slots', () => {
        expect(chaosDruidBankReason(trip({ inventoryFull: true, foodCount: 0 }))).toBe('loot-full');
    });

    test('a full pack banks when no wanted drop can consume excess food', () => {
        expect(chaosDruidBankReason(trip({ inventoryFull: true, foodCount: 2, wantedLootVisible: false }))).toBe('loot-full');
        expect(chaosDruidBankReason(trip({ inventoryFull: true, foodCount: 2, wantedLootVisible: true }))).toBeNull();
    });

    test('running out of food alone is not an early retreat while HP is safe', () => {
        expect(chaosDruidBankReason(trip({ foodCount: 0, hpFraction: 0.36 }))).toBeNull();
    });

    test('running out of food at or below the threshold ends the trip', () => {
        expect(chaosDruidBankReason(trip({ foodCount: 0, hpFraction: 0.35 }))).toBe('low-health');
        expect(chaosDruidBankReason(trip({ foodCount: 0, hpFraction: 0.2 }))).toBe('low-health');
    });

    test('food keeps a low-HP trip active so the higher-priority eater can heal', () => {
        expect(chaosDruidBankReason(trip({ foodCount: 1, hpFraction: 0.1 }))).toBeNull();
    });

    test('an already-open bank is always recovered, even after the logical trigger cleared', () => {
        expect(chaosDruidBankRunReady(true, null)).toBe(true);
        expect(chaosDruidBankRunReady(false, 'low-health')).toBe(true);
        expect(chaosDruidBankRunReady(false, null)).toBe(false);
    });

    test('the eater never selects while the bank side-backpack is authoritative', () => {
        expect(chaosDruidEatReady({ bankOpen: true, needEat: true })).toBe(false);
        expect(chaosDruidEatReady({ bankOpen: false, needEat: true })).toBe(true);
        expect(chaosDruidEatReady({ bankOpen: false, needEat: false })).toBe(false);
    });
});

describe('making space for wanted loot', () => {
    test('takes immediately when a backpack slot is free', () => {
        expect(chaosDruidLootSpaceAction({ inventoryFull: false, foodCount: 12, hp: 1, maxHp: 10 })).toBe('take');
    });

    test('eats excess food first when that also heals damage', () => {
        expect(chaosDruidLootSpaceAction({ inventoryFull: true, foodCount: 2, hp: 9, maxHp: 10 })).toBe('eat-food');
    });

    test('drops one excess food at full HP instead of abandoning the drop', () => {
        expect(chaosDruidLootSpaceAction({ inventoryFull: true, foodCount: 2, hp: 10, maxHp: 10 })).toBe('drop-food');
    });

    test('banks a full, foodless pack rather than dropping loot', () => {
        expect(chaosDruidLootSpaceAction({ inventoryFull: true, foodCount: 0, hp: 10, maxHp: 10 })).toBe('bank');
    });

    test('takes a Law rune into its existing exact stack without sacrificing food', () => {
        expect(chaosDruidDropMerges('Law rune', ['Lobster', 'law RUNE'])).toBe(true);
        expect(chaosDruidLootSpaceAction({
            inventoryFull: true,
            mergesIntoExistingStack: true,
            foodCount: 27,
            hp: 10,
            maxHp: 10
        })).toBe('take');
    });

    test('does not treat a same-name unstackable Herb or an inexact rune name as mergeable', () => {
        expect(chaosDruidDropMerges('Herb', ['Herb'])).toBe(false);
        expect(chaosDruidDropMerges('Law rune', ['Law runes'])).toBe(false);
        expect(chaosDruidDropMerges('Law rune', ['Nature rune'])).toBe(false);
    });
});

describe('restock arithmetic', () => {
    test('withdraws only the configured shortfall', () => {
        expect(chaosDruidFoodShortfall(12, 0)).toBe(12);
        expect(chaosDruidFoodShortfall(12, 5)).toBe(7);
        expect(chaosDruidFoodShortfall(12, 12)).toBe(0);
        expect(chaosDruidFoodShortfall(12, 20)).toBe(0);
    });

    test('normalizes fractional and negative inputs', () => {
        expect(chaosDruidFoodShortfall(12.9, -4)).toBe(12);
        expect(chaosDruidFoodShortfall(12.9, 2.9)).toBe(10);
    });
});

describe('Chaos-druid loot and field', () => {
    test('herbs and the stackable rune drops count as trip loot', () => {
        expect(isChaosDruidLoot('Herb')).toBe(true);
        expect(isChaosDruidLoot('law RUNE')).toBe(true);
        expect(isChaosDruidLoot('Nature rune')).toBe(true);
        expect(isChaosDruidLoot('Uncut emerald')).toBe(false);
        expect(isChaosDruidLoot(null)).toBe(false);
    });

    test('uses the actual Edgeville-dungeon Chaos-druid cluster as its fixed camp', () => {
        const staticSpawns = [
            [3104, 9942], [3105, 9936], [3106, 9940], [3107, 9943], [3109, 9931],
            [3110, 9941], [3111, 9936], [3111, 9939], [3114, 9929], [3115, 9925], [3115, 9932]
        ];
        for (const [x, z] of staticSpawns) {
            expect(inChaosDruidField({ x, z, level: 0 })).toBe(true);
        }
        expect(CHAOS_DRUID_FIELD).toEqual({ x: 3110, z: 9936, level: 0 });
        expect(CHAOS_DRUID_FIELD_RADIUS).toBe(14);
    });

    test('does not confuse surface coordinates with the instanced dungeon plane', () => {
        expect(inEdgevilleDungeon({ x: 3109, z: 9937, level: 0 })).toBe(true);
        expect(inEdgevilleDungeon({ x: 3096, z: 3468, level: 0 })).toBe(false);
        expect(inChaosDruidField({ x: 3109, z: 3537, level: 0 })).toBe(false);
        expect(inChaosDruidField(null)).toBe(false);
    });

    test('classifies other underground maps explicitly instead of using their Edgeville exit', () => {
        const waterfallDungeon = { x: 2575, z: 9861, level: 0 };
        const taverleyDungeon = { x: 2884, z: 9798, level: 0 };
        expect(chaosDruidArea(waterfallDungeon)).toBe('other-underground');
        expect(chaosDruidArea(taverleyDungeon)).toBe('other-underground');
        expect(inEdgevilleDungeon(waterfallDungeon)).toBe(false);
        expect(inEdgevilleDungeon(taverleyDungeon)).toBe(false);
        expect(chaosDruidArea({ x: 3096, z: 3468, level: 0 })).toBe('surface');
        expect(chaosDruidArea(null)).toBe('unknown');
    });

    test('detects a missed death message from an unexpected surface respawn', () => {
        expect(chaosDruidRespawned('druid-dungeon', 'surface', true)).toBe(true);
        expect(chaosDruidRespawned('druid-dungeon', 'surface', false)).toBe(false);
        expect(chaosDruidRespawned('druid-dungeon', 'druid-dungeon', true)).toBe(false);
    });
});

describe('alternate druid locations', () => {
    test('offers the three locations with their entry requirements', () => {
        expect(SETTINGS.location).toMatchObject({ default: 'Edgeville Dungeon' });
        expect(SETTINGS.location.options).toEqual(['Edgeville Dungeon', 'Chaos Druid Tower', 'Yanille Dungeon']);
        expect(DRUID_SPOTS['Edgeville Dungeon'].requires).toBeNull();
        expect(DRUID_SPOTS['Chaos Druid Tower'].requires).toEqual({ skill: 'thieving', level: 46 });
        expect(DRUID_SPOTS['Yanille Dungeon'].requires).toEqual({ skill: 'agility', level: 40 });
    });

    test('the tower camp covers all four ground-floor spawns behind the picklocked door', () => {
        const spot = DRUID_SPOTS['Chaos Druid Tower'];
        for (const [x, z] of [[2561, 3355], [2561, 3357], [2563, 3355], [2563, 3358]]) {
            expect(inChaosDruidField({ x, z, level: 0 }, spot)).toBe(true);
        }
        expect(spot.npc).toBe('Chaos druid');
        expect(inChaosDruidField({ x: 2561, z: 9855, level: 0 }, spot)).toBe(false);
        expect(inChaosDruidTower({ x: 2562, z: 3356, level: 0 })).toBe(true);
        expect(inChaosDruidTower({ x: 2565, z: 3356, level: 0 })).toBe(false);
    });

    test('Swarm in the tower must be walked out, not evaded in place (#497)', () => {
        expect(shouldExitTowerForSwarm(true, true)).toBe(true);
        expect(shouldExitTowerForSwarm(true, false)).toBe(false);
        expect(shouldExitTowerForSwarm(false, true)).toBe(false);
        expect(swarmNpcNearby([{ name: 'Swarm', id: 411, distance: 2 }])).toBe(true);
        expect(swarmNpcNearby([{ name: 'Chaos druid', id: 1, distance: 1 }])).toBe(false);
        expect(inChaosDruidTower(TOWER_SWARM_FLEE)).toBe(false);
        const orig = Game.tile;
        const bot = new ChaosDruidKiller();
        try {
            Game.tile = () => ({ x: 2616, z: 3332, level: 0 });
            expect(bot.ignoredRandoms()).toEqual([]);
            Game.tile = () => ({ x: 2562, z: 3356, level: 0 });
            expect(bot.ignoredRandoms()).toEqual(['swarm']);
        } finally {
            Game.tile = orig;
        }
    });

    test('the Yanille camp covers the dense western Chaos-druid-warrior cluster', () => {
        const spot = DRUID_SPOTS['Yanille Dungeon'];
        for (const [x, z] of [[2576, 9501], [2578, 9500], [2579, 9508], [2580, 9497], [2580, 9502], [2583, 9499], [2588, 9498]]) {
            expect(inChaosDruidField({ x, z, level: 0 }, spot)).toBe(true);
        }
        expect(spot.npc).toBe('Chaos druid warrior');
        expect(chaosDruidArea({ x: 2580, z: 9501, level: 0 }, spot.dungeon)).toBe('druid-dungeon');
    });

    test('splits the Yanille dungeon into ledge-defined zones including the fall pit', () => {
        expect(yanilleZone({ x: 2569, z: 9525, level: 0 })).toBe('north');
        expect(yanilleZone({ x: 2580, z: 9520, level: 0 })).toBe('north');
        expect(yanilleZone({ x: 2580, z: 9512, level: 0 })).toBe('warrior');
        expect(yanilleZone({ x: 2580, z: 9501, level: 0 })).toBe('warrior');
        expect(yanilleZone({ x: 2578, z: 9580, level: 0 })).toBe('pit');
        expect(yanilleZone({ x: 2612, z: 3092, level: 0 })).toBe('outside');
        expect(yanilleZone({ x: 3110, z: 9936, level: 0 })).toBe('outside');
    });
});
