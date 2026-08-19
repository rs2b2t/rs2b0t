import { describe, expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';
import fs from 'node:fs';
import path from 'node:path';

import rawDoors from '#/bot/event/webwalk/data/doors.json';
import { SPECIAL_CROSSINGS, specialCrossingForTransport } from '#/bot/event/webwalk/data/specialCrossings.js';
import { arrivalDialogueResolved, shouldSceneStepToTile } from '#/bot/event/webwalk/exec/specialCrossing.js';
import { DESERT_MINING_CAMP_REPLACED_DOOR_IDS, DESERT_MINING_CAMP_SCRIPTED_DOOR_IDS } from '#/bot/event/webwalk/desertMiningCampDoors.js';
import { allDoorRows, allTransportRows, loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { PathFinder, type DoorEdgeData, type TransportEdgeData } from '#/bot/event/webwalk/PathFinder.js';
import { meetsRequires } from '#/bot/event/webwalk/requires.js';
import { specialRequiresAt } from '#/bot/event/webwalk/specialRequires.js';
import { desertMiningCampEdges } from '#/bot/event/webwalk/travelCatalog.js';
import { emptyWorldStateData, worldStateFromData } from '#/bot/event/webwalk/worldStateData.js';

const PACK_PATH = path.join(process.cwd(), 'out/collision.lcnav.gz');
const HAS_COLLISION_PACK = fs.existsSync(PACK_PATH);

function loadFinder(): PathFinder {
    let bytes = new Uint8Array(fs.readFileSync(PACK_PATH));
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        bytes = new Uint8Array(gunzipSync(bytes));
    }
    const finder = new PathFinder(bytes);
    loadDefaultNavEdges(finder);
    return finder;
}

function edge(debugName: string): TransportEdgeData {
    const found = desertMiningCampEdges().find(candidate => candidate.debugName === debugName);
    if (!found) throw new Error(`missing Desert Mining Camp edge '${debugName}'`);
    return found;
}

const completeData = {
    ...emptyWorldStateData(),
    members: true,
    quests: { 'The Tourist Trap': 'complete' },
    items: { 'Metal key': 1, 'Wrought iron key': 1 },
    worn: { "Slaves' shirt": 1, 'Slave robe': 1, 'Slave boots': 1 }
} as const;
const complete = worldStateFromData(completeData);

describe('Desert Mining Camp shared transports', () => {
    test('only Desert Mining Camp recipes wait for post-arrival dialogue to settle', () => {
        const campRecipes = SPECIAL_CROSSINGS.filter(recipe => recipe.label.startsWith('Desert Mining Camp '));
        expect(campRecipes).toHaveLength(12);
        expect(campRecipes.every(recipe => recipe.settleDialogueAfterArrival === true)).toBe(true);

        const ordinary = SPECIAL_CROSSINGS.find(recipe => recipe.label === 'Shantay Pass -> Kharidian desert');
        expect(ordinary?.settleDialogueAfterArrival).toBeUndefined();
        expect(arrivalDialogueResolved(ordinary?.settleDialogueAfterArrival, true)).toBe(true);
        expect(arrivalDialogueResolved(campRecipes[0]?.settleDialogueAfterArrival, true)).toBe(false);
        expect(arrivalDialogueResolved(campRecipes[0]?.settleDialogueAfterArrival, false)).toBe(true);
    });

    test('replaces every non-local scripted door row', () => {
        const raw = rawDoors as DoorEdgeData[];
        expect(raw.filter(door => DESERT_MINING_CAMP_REPLACED_DOOR_IDS.has(door.locId))).toHaveLength(6);
        expect(raw).toContainEqual({ x: 3322, z: 9448, level: 0, locId: 2687, locName: 'Gate', dir: 'N' });
        expect(raw).toContainEqual({ x: 3323, z: 9448, level: 0, locId: 2688, locName: 'Gate', dir: 'N' });
        expect(allDoorRows().some(door => DESERT_MINING_CAMP_REPLACED_DOOR_IDS.has(door.locId))).toBe(false);

        const curated = desertMiningCampEdges();
        expect(curated).toHaveLength(9);
        expect(curated.every(candidate => allTransportRows().some(row => row.debugName === candidate.debugName))).toBe(true);
        expect([...DESERT_MINING_CAMP_REPLACED_DOOR_IDS].every(id => DESERT_MINING_CAMP_SCRIPTED_DOOR_IDS.has(id))).toBe(true);
        expect(DESERT_MINING_CAMP_SCRIPTED_DOOR_IDS.has(2673)).toBe(true);
        expect(DESERT_MINING_CAMP_SCRIPTED_DOOR_IDS.has(2674)).toBe(true);
    });

    test('bridges the lower and deep mine collision components by mine cart', () => {
        expect(edge('desert_mining_camp_cart_in')).toMatchObject({
            from: { x: 3303, z: 9416, level: 0 },
            to: { x: 3319, z: 9431, level: 0 },
            locId: 2684,
            locX: 3303,
            locZ: 9417,
            action: 'Search'
        });
        expect(edge('desert_mining_camp_cart_out')).toMatchObject({
            from: { x: 3319, z: 9430, level: 0 },
            to: { x: 3302, z: 9417, level: 0 },
            locId: 2684,
            locX: 3318,
            locZ: 9430,
            action: 'Search'
        });

        for (const debug of ['desert_mining_camp_cart_in', 'desert_mining_camp_cart_out']) {
            const candidate = edge(debug);
            const recipe = specialCrossingForTransport({ locX: candidate.locX!, locZ: candidate.locZ!, locName: candidate.locName }, candidate.from, candidate.to);
            expect(recipe?.dialogue?.choose).toEqual(['Yes, of course.']);
            expect(recipe?.toTile).toEqual(candidate.to);
            expect(recipe?.retryOnGameMessage?.attempts).toBe(6);
            expect(recipe?.retryOnGameMessage?.reason).toBe('Agility roll failed');
            expect(recipe?.retryOnGameMessage?.message.test('You fail to fit yourself into the cart in time before it starts its journey.')).toBe(true);
            expect(recipe?.retryOnGameMessage?.message.test('You succeed!')).toBe(false);
            // Failed Agility rolls leave the player near `from`, outside the zero-radius
            // destination; handleSpecialCrossing therefore returns false and repaths.
            expect(recipe?.arrivalRadius).toBe(0);
        }
    });

    test('models the mine door and guarded cave as exact directed teleports', () => {
        expect(edge('desert_mining_camp_door_in')).toMatchObject({
            from: { x: 3301, z: 3036, level: 0 },
            to: { x: 3278, z: 9427, level: 0 },
            locId: 2675,
            locX: 3301,
            locZ: 3036
        });
        expect(edge('desert_mining_camp_door_out')).toMatchObject({
            from: { x: 3278, z: 9427, level: 0 },
            to: { x: 3301, z: 3036, level: 0 },
            locId: 2690,
            locX: 3278,
            locZ: 9426
        });
        expect(edge('desert_mining_camp_cave_in')).toMatchObject({
            from: { x: 3278, z: 9415, level: 0 },
            to: { x: 3286, z: 9415, level: 0 },
            action: 'Walk through'
        });
        expect(edge('desert_mining_camp_cave_out')).toMatchObject({
            from: { x: 3286, z: 9415, level: 0 },
            to: { x: 3278, z: 9415, level: 0 },
            action: 'Walk through'
        });
        for (const label of ['Desert Mining Camp guarded cave in', 'Desert Mining Camp guarded cave out']) {
            const recipe = SPECIAL_CROSSINGS.find(candidate => candidate.label === label);
            expect(recipe?.retryIfUnacknowledged).toEqual({
                attempts: 3,
                reason: 'interaction interrupted'
            });
        }
        const inbound = edge('desert_mining_camp_door_in');
        const recipe = specialCrossingForTransport({ locX: inbound.locX!, locZ: inbound.locZ!, locName: inbound.locName }, inbound.from, inbound.to);
        expect(recipe?.arrivalRadius).toBe(0);
        expect(recipe?.sceneStepFromTile).toEqual({ x: 3278, z: 9426, level: 0 });

        const outbound = edge('desert_mining_camp_door_out');
        const outboundRecipe = specialCrossingForTransport({ locX: outbound.locX!, locZ: outbound.locZ!, locName: outbound.locName }, outbound.from, outbound.to);
        expect(outboundRecipe?.sceneStepFromTile).toBeUndefined();
    });

    test('scene-steps only after the server opens the edge from the staging tile', () => {
        const to = { x: 3278, z: 9427, level: 0 };
        const staging = { x: 3278, z: 9426, level: 0 };
        expect(shouldSceneStepToTile(staging, false, true, staging, to)).toBe(true);
        expect(shouldSceneStepToTile(staging, false, false, staging, to)).toBe(false);
        expect(shouldSceneStepToTile(staging, true, true, staging, to)).toBe(false);
        expect(shouldSceneStepToTile(undefined, false, true, staging, to)).toBe(false);
        expect(shouldSceneStepToTile(staging, false, true, to, to)).toBe(false);
        expect(shouldSceneStepToTile(staging, false, true, { x: 3301, z: 3036, level: 0 }, to)).toBe(false);
    });

    test.skipIf(!HAS_COLLISION_PACK)('rejects the server staging tile before the real mine landing', () => {
        const finder = loadFinder();
        const deepMine = { x: 3323, z: 9458, level: 0 };
        const options = { state: completeData, useTeleportCatalog: false } as const;
        expect(finder.findPath({ x: 3278, z: 9426, level: 0 }, deepMine, options).ok).toBe(false);
        expect(finder.findPath({ x: 3278, z: 9427, level: 0 }, deepMine, options).ok).toBe(true);
    });

    test.skipIf(!HAS_COLLISION_PACK)('uses the exact wrought-gate row as the south component', () => {
        const finder = loadFinder();
        const south = { x: 3322, z: 9448, level: 0 };
        const north = { x: 3322, z: 9449, level: 0 };
        const deepMine = { x: 3323, z: 9458, level: 0 };
        const lowerMine = { x: 3303, z: 9416, level: 0 };
        const withoutKey = { ...completeData, items: {} };

        expect(finder.findPath(south, deepMine, { state: withoutKey, useTeleportCatalog: false }).ok).toBe(false);
        const inward = finder.findPath(south, deepMine, { state: completeData, useTeleportCatalog: false });
        const outward = finder.findPath(north, lowerMine, { state: withoutKey, useTeleportCatalog: false });
        expect(inward.ok).toBe(true);
        expect(outward.ok).toBe(true);
        if (inward.ok && outward.ok) {
            expect(inward.hops[0]).toMatchObject({ from: south, to: north, locId: 2687 });
            expect(outward.hops[0]).toMatchObject({ from: north, to: south, locId: 2687 });
        }
    });

    test('keeps direction-specific requirements separate', () => {
        const doorIn = edge('desert_mining_camp_door_in');
        const doorOut = edge('desert_mining_camp_door_out');
        const caveIn = edge('desert_mining_camp_cave_in');
        const caveOut = edge('desert_mining_camp_cave_out');
        const caveOutDisguised = edge('desert_mining_camp_cave_out_disguised');
        const cartIn = edge('desert_mining_camp_cart_in');
        const wroughtIn = edge('desert_mining_camp_wrought_in');
        const wroughtOut = edge('desert_mining_camp_wrought_out');

        expect(doorIn.requires?.worn).toHaveLength(3);
        expect(doorOut.requires?.worn).toHaveLength(3);
        expect(doorIn.requires?.quests).toBeUndefined();
        expect(doorOut.requires?.quests).toBeUndefined();
        expect(caveIn.requires?.worn).toHaveLength(3);
        expect(caveIn.requires?.quests).toEqual([{ quest: 'The Tourist Trap', minStatus: 'complete' }]);
        expect(caveOut.requires?.worn).toBeUndefined();
        expect(caveOutDisguised.requires?.worn).toHaveLength(3);
        expect(caveOutDisguised.requires?.quests).toBeUndefined();
        expect(cartIn.requires).toBeUndefined();
        expect(wroughtIn.requires?.items).toEqual([{ name: 'Wrought iron key', count: 1, consumed: false }]);
        expect(wroughtIn.requires?.quests).toBeUndefined();
        expect(wroughtOut.requires?.items).toBeUndefined();
        expect(wroughtOut.requires?.quests).toBeUndefined();

        expect(wroughtIn.from).toEqual({ x: 3322, z: 9448, level: 0 });
        expect(wroughtIn.to).toEqual({ x: 3322, z: 9449, level: 0 });
        expect(wroughtOut.from).toEqual(wroughtIn.to);
        expect(wroughtOut.to).toEqual(wroughtIn.from);
        expect(wroughtIn).toMatchObject({ locId: 2687, locX: 3322, locZ: 9448, kind: 'gate', action: 'Open' });
        expect(wroughtOut).toMatchObject({ locId: 2687, locX: 3322, locZ: 9448, kind: 'gate', action: 'Open' });

        const inwardRecipe = specialCrossingForTransport({ locX: wroughtIn.locX!, locZ: wroughtIn.locZ!, locName: wroughtIn.locName }, wroughtIn.from, wroughtIn.to);
        const outwardRecipe = specialCrossingForTransport({ locX: wroughtOut.locX!, locZ: wroughtOut.locZ!, locName: wroughtOut.locName }, wroughtOut.from, wroughtOut.to);
        expect(inwardRecipe?.arrivalRadius).toBe(0);
        expect(inwardRecipe?.sceneStepFromTile).toEqual({ x: 3322, z: 9448, level: 0 });
        expect(outwardRecipe?.arrivalRadius).toBe(0);
        expect(outwardRecipe?.sceneStepFromTile).toBeUndefined();

        const bare = worldStateFromData({
            ...emptyWorldStateData(),
            members: true,
            quests: { 'The Tourist Trap': 'complete' }
        });
        expect(meetsRequires(caveIn.requires, bare).ok).toBe(false);
        expect(meetsRequires(caveOut.requires, bare).ok).toBe(true);
        expect(meetsRequires(wroughtIn.requires, bare).ok).toBe(false);
        expect(meetsRequires(wroughtOut.requires, bare).ok).toBe(true);

        const startedAndDisguised = worldStateFromData({
            ...emptyWorldStateData(),
            members: true,
            quests: { 'The Tourist Trap': 'started' },
            worn: { "Slaves' shirt": 1, 'Slave robe': 1, 'Slave boots': 1 }
        });
        expect(meetsRequires(caveIn.requires, startedAndDisguised).ok).toBe(false);
        expect(meetsRequires(caveOutDisguised.requires, startedAndDisguised).ok).toBe(true);
        expect(desertMiningCampEdges().every(candidate => meetsRequires(candidate.requires, complete).ok)).toBe(true);
    });

    test('outer gate requires the retained Metal key at every quest stage', () => {
        for (const x of [3273, 3274]) {
            for (const z of [3028, 3029]) {
                const requires = specialRequiresAt(x, z, 0);
                expect(requires?.quests).toBeUndefined();
                expect(requires?.items).toEqual([{ name: 'Metal key', count: 1, consumed: false }]);
                expect(meetsRequires(requires, complete).ok).toBe(true);
            }
        }

        const startedWithKey = worldStateFromData({
            ...emptyWorldStateData(),
            members: true,
            quests: { 'The Tourist Trap': 'started' },
            items: { 'Metal key': 1 }
        });
        const noQuestWithKey = worldStateFromData({
            ...emptyWorldStateData(),
            members: true,
            items: { 'Metal key': 1 }
        });
        const completeWithoutKey = worldStateFromData({
            ...emptyWorldStateData(),
            members: true,
            quests: { 'The Tourist Trap': 'complete' }
        });
        expect(meetsRequires(specialRequiresAt(3273, 3029, 0), startedWithKey).ok).toBe(true);
        expect(meetsRequires(specialRequiresAt(3273, 3029, 0), noQuestWithKey).ok).toBe(true);
        expect(meetsRequires(specialRequiresAt(3274, 3029, 0), completeWithoutKey).ok).toBe(false);
    });

    test('approaches each inbound outer-gate leaf from the exact direction tile', () => {
        const recipes = [
            [
                { x: 3273, z: 3028, level: 0 },
                { x: 3274, z: 3028, level: 0 }
            ],
            [
                { x: 3273, z: 3029, level: 0 },
                { x: 3274, z: 3029, level: 0 }
            ]
        ] as const;
        for (const [from, to] of recipes) {
            const inward = specialCrossingForTransport({ locX: from.x, locZ: from.z, locName: 'Gate' }, from, to);
            const outward = specialCrossingForTransport({ locX: from.x, locZ: from.z, locName: 'Gate' }, to, from);
            expect(inward?.exactApproach).toBe(true);
            expect(outward?.exactApproach).toBeUndefined();
        }
    });

    test.skipIf(!HAS_COLLISION_PACK)('attaches the Metal-key gate to both inside-origin path edges', () => {
        const finder = loadFinder();
        const withoutKey = emptyWorldStateData(true);

        for (const z of [3028, 3029]) {
            const inside = { x: 3274, z, level: 0 };
            const outside = { x: 3273, z, level: 0 };
            expect(finder.findPath(inside, outside, { state: withoutKey, useTeleportCatalog: false }).ok).toBe(false);

            const withKey = { ...withoutKey, items: { 'Metal key': 1 } };
            const route = finder.findPath(inside, outside, { state: withKey, useTeleportCatalog: false });
            expect(route.ok).toBe(true);
            if (route.ok) {
                expect(route.hops).toEqual([expect.objectContaining({ kind: 'door', from: inside, to: outside, locName: 'Gate' })]);
            }
        }
    });

    test('matches exact inward and outward dialogue recipes', () => {
        const cases = [
            edge('desert_mining_camp_door_in'),
            edge('desert_mining_camp_door_out'),
            edge('desert_mining_camp_cave_in'),
            edge('desert_mining_camp_cave_out'),
            edge('desert_mining_camp_cave_out_disguised'),
            edge('desert_mining_camp_cart_in'),
            edge('desert_mining_camp_cart_out'),
            edge('desert_mining_camp_wrought_in'),
            edge('desert_mining_camp_wrought_out')
        ];
        for (const candidate of cases) {
            const recipe = specialCrossingForTransport(
                {
                    locX: candidate.locX ?? candidate.from.x,
                    locZ: candidate.locZ ?? candidate.from.z,
                    locName: candidate.locName
                },
                candidate.from,
                candidate.to
            );
            expect(recipe?.toTile).toEqual(candidate.to);
        }

        const outerIn = specialCrossingForTransport({ locX: 3273, locZ: 3029, locName: 'Gate' }, { x: 3273, z: 3029, level: 0 }, { x: 3274, z: 3029, level: 0 });
        const outerOut = specialCrossingForTransport({ locX: 3273, locZ: 3029, locName: 'Gate' }, { x: 3274, z: 3029, level: 0 }, { x: 3273, z: 3029, level: 0 });
        expect(outerIn?.label).toMatch(/outer gate in/);
        expect(outerOut?.label).toMatch(/outer gate out/);
        expect(outerIn?.toTile).not.toEqual(outerOut?.toTile);
    });
});
