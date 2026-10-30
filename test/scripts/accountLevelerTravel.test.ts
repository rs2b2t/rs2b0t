import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { reader, type WorldTile } from '#/bot/adapter/ClientAdapter.js';
import { Traversal, type WalkResilientOptions } from '#/bot/api/walking/Traversal.js';
import { Banking, type OpenBankOpts } from '#/bot/api/bank/Banking.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { resolveDangerZones, tileInDangerZones } from '#/bot/event/webwalk/data/dangerZones.js';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { wildernessLevelAt } from '#/bot/event/webwalk/wilderness.js';
import { emptyWorldStateData } from '#/bot/event/webwalk/worldStateData.js';
import AccountLeveler from '#/bot/scripts/AccountLeveler/AccountLeveler.js';
import { gameSupplyPort } from '#/bot/scripts/AccountLeveler/supplies.js';
import { stubProps } from '../lib/stubSingletons.js';

const seers = { x: 2725, z: 3492, level: 0 };
const lowe = { x: 3231, z: 3421, level: 0 };
const wild = { x: 3154, z: 3924, level: 0 };

async function travelOptions(destination: WorldTile, wilderness = true): Promise<WalkResilientOptions> {
    let options: WalkResilientOptions = { radius: 0 };
    const restore = [
        stubProps(reader, { worldTile: () => seers }),
        stubProps(Traversal, { walkResilient: async (_, opts) => { options = opts; return true; } })
    ];
    try {
        const bot = new AccountLeveler();
        bot['wilderness'] = wilderness;
        expect(await bot['supplies'].walk(destination)).toBe(true);
        return options;
    } finally {
        restore.reverse().forEach(fn => fn());
    }
}

test('routine Leveler travel excludes surface and underground Wilderness even when training there is enabled', async () => {
    const zones = resolveDangerZones((await travelOptions(lowe)).avoidZones);
    expect(tileInDangerZones(wild.x, wild.z, 0, zones)).toBe(true);
    expect(tileInDangerZones(3100, 10000, 0, zones)).toBe(true);
});

test('only explicitly enabled Wilderness destinations permit entry', async () => {
    const allowed = resolveDangerZones((await travelOptions(wild)).avoidZones);
    const denied = resolveDangerZones((await travelOptions(wild, false)).avoidZones);
    expect(tileInDangerZones(wild.x, wild.z, 0, allowed)).toBe(false);
    expect(tileInDangerZones(wild.x, wild.z, 0, denied)).toBe(true);
});

test.skipIf(!existsSync('out/collision.lcnav.gz'))('Seers to Lowe uses a reachable route without the deep Wilderness lever shortcut', async () => {
    const finder = new PathFinder(gunzipSync(readFileSync('out/collision.lcnav.gz')));
    loadDefaultNavEdges(finder);
    const route = finder.findPath(seers, lowe, {
        state: { ...emptyWorldStateData(), members: true, items: { Coins: 150000 }, skills: { agility: 49 }, canSlashWeb: true, entranaRestrictedGear: true },
        avoidZones: resolveDangerZones((await travelOptions(lowe)).avoidZones), useTeleportCatalog: false
    });
    expect(route.ok).toBe(true);
    if (!route.ok) return;
    expect(route.waypoints.at(-1)).toMatchObject(lowe);
    expect(route.waypoints.some(tile => wildernessLevelAt(tile) > 0)).toBe(false);
}, 20000);

test.skipIf(!existsSync('out/collision.lcnav.gz'))('Leveler banking preserves a route out of the Wilderness', async () => {
    let options: OpenBankOpts = {};
    const restore = [
        stubProps(reader, { worldTile: () => wild }),
        stubProps(Banking, { open: async opts => { options = opts ?? {}; return true; } }),
        stubProps(Bank, { waitReady: async () => true, setNoteMode: async () => {} })
    ];
    try {
        expect(await gameSupplyPort(() => {}).bank()).toBe(true);
    } finally {
        restore.reverse().forEach(fn => fn());
    }
    const zones = resolveDangerZones(options.avoidZones);
    expect(tileInDangerZones(wild.x, wild.z, 0, zones)).toBe(true);
    const finder = new PathFinder(gunzipSync(readFileSync('out/collision.lcnav.gz')));
    loadDefaultNavEdges(finder);
    const bank = { x: 3094, z: 3492, level: 0 };
    const route = finder.findPath(wild, bank, {
        state: { ...emptyWorldStateData(), members: true, canSlashWeb: true }, avoidZones: zones, useTeleportCatalog: false
    });
    expect(route.ok).toBe(true);
    if (!route.ok) return;
    expect(route.waypoints.at(-1)).toMatchObject(bank);
    const outside = route.waypoints.findIndex(tile => wildernessLevelAt(tile) === 0);
    expect(outside).toBeGreaterThanOrEqual(0);
    expect(route.waypoints.slice(outside).some(tile => wildernessLevelAt(tile) > 0)).toBe(false);
}, 20000);

test('Banking forwards caller travel exclusions to the bank walk', async () => {
    const options = await travelOptions(lowe);
    let walked: WalkResilientOptions = { radius: 0 };
    const restore = [
        stubProps(reader, { worldTile: () => seers, locs: () => [] }),
        stubProps(Bank, { isOpen: () => false, openBooth: async () => true }),
        stubProps(Traversal, { walkResilient: async (_, opts) => { walked = opts; return true; } })
    ];
    try {
        expect(await Banking.open({ stand: { x: 3094, z: 3492, level: 0 }, preferNearby: false, avoidZones: options.avoidZones })).toBe(true);
        expect(walked.avoidZones).toEqual(options.avoidZones);
    } finally {
        restore.reverse().forEach(fn => fn());
    }
});
