import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { gunzipSync } from 'fflate';
import { reader, type WorldTile } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Banking } from '#/bot/api/bank/Banking.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { Navigator } from '#/bot/event/webwalk/Navigator.js';
import { PathFinder, type Waypoint } from '#/bot/event/webwalk/PathFinder.js';
import { WalkExecutor } from '#/bot/event/webwalk/WalkExecutor.js';
import * as liveState from '#/bot/event/webwalk/worldStateLive.js';
import { emptyWorldStateData } from '#/bot/event/webwalk/worldStateData.js';

const draynor = { x: 3093, z: 3243, level: 0 };
const ardougne = { x: 2655, z: 3283, level: 0 };

let here: WorldTile;
let coins: number;
let withdrawn: number;
let crossings: number;
let bankOpens: boolean;
let withdrawalLands: boolean;
let bankOpen: boolean;
const packExists = existsSync('out/collision.lcnav.gz');
const finder = packExists ? new PathFinder(gunzipSync(readFileSync('out/collision.lcnav.gz'))) : null;
if (finder) loadDefaultNavEdges(finder);

beforeEach(() => {
    here = { ...draynor };
    coins = 30;
    withdrawn = 0;
    crossings = 0;
    bankOpens = true;
    withdrawalLands = true;
    bankOpen = false;
    spyOn(reader, 'worldTile').mockImplementation(() => here);
    spyOn(reader, 'combatLevel').mockReturnValue(3);
    spyOn(liveState, 'snapshotWorldStateData').mockImplementation(() => ({
        ...emptyWorldStateData(), skills: { agility: 1, magic: 1 }, items: { Coins: coins }, canSlashWeb: false
    }));
    spyOn(Inventory, 'count').mockImplementation(name => name === 'Coins' ? coins : 0);
    spyOn(Skills, 'level').mockReturnValue(1);
    spyOn(Quests, 'status').mockReturnValue('notStarted');
    spyOn(Navigator, 'findPath').mockImplementation(async (from, to, opts) => finder!.findPath(from, to, { ...opts, avoidDoors: new Set(opts?.avoidDoors?.map(t => `${t.x}|${t.z}`)) }));
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => { await Promise.resolve(); return predicate(); });
    spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
    spyOn(Bank, 'isOpen').mockImplementation(() => bankOpen);
    spyOn(Banking, 'open').mockImplementation(async () => { bankOpen = bankOpens; return bankOpen; });
    spyOn(Bank, 'withdrawX').mockImplementation(async (name, amount) => {
        if (name !== 'Coins' || !withdrawalLands) return false;
        withdrawn += amount;
        coins += amount;
        return true;
    });
    spyOn(Bank, 'close').mockImplementation(async () => { bankOpen = false; return true; });
    spyOn(Object.getPrototypeOf(WalkExecutor), 'followPath').mockImplementation(async (tiles: Waypoint[], dest: WorldTile) => {
        for (const tile of tiles) {
            const ship = tile.transport?.kind === 'ship';
            const fare = ship ? 30 : tile.transport?.locId === 2882 ? 10 : 0;
            if (coins < fare) return 'failed';
            coins -= fare;
            if (ship) crossings++;
            here = tile;
        }
        here = dest;
        return 'arrived';
    });
});

afterEach(() => mock.restore());

describe.skipIf(!packExists)('route funding with the real navigation pack', () => {
    test('funds both ship fares before leaving Draynor with one fare held', async () => {
        expect(await WalkExecutor.walkTo(ardougne, { useTeleportCatalog: false })).toBe(true);
        expect(withdrawn).toBe(30);
        expect(crossings).toBe(2);
        expect(here).toEqual(ardougne);
    });

    test('does not board the first ship when the missing fare cannot be withdrawn', async () => {
        withdrawalLands = false;
        expect(await WalkExecutor.walkTo(ardougne, { useTeleportCatalog: false })).toBe(false);
        expect(crossings).toBe(0);
        expect(here).toEqual(draynor);
        expect(WalkExecutor.lastMissingGateItems).toEqual([{ name: 'Coins', count: 30 }]);
    });

    test('checks the inventory after a partially successful withdrawal', async () => {
        spyOn(Bank, 'withdrawX').mockImplementation(async () => { coins += 20; return true; });
        expect(await WalkExecutor.walkTo(ardougne, { useTeleportCatalog: false })).toBe(false);
        expect(crossings).toBe(0);
        expect(here).toEqual(draynor);
        expect(WalkExecutor.lastMissingGateItems).toEqual([{ name: 'Coins', count: 10 }]);
    });

    test('does not board the first ship when the bank cannot open', async () => {
        bankOpens = false;
        expect(await WalkExecutor.walkTo(ardougne, { useTeleportCatalog: false })).toBe(false);
        expect(crossings).toBe(0);
        expect(here).toEqual(draynor);
    });

    test('funds the bank-origin route after paying the toll to reach the bank', async () => {
        here = { x: 3267, z: 3227, level: 0 };
        expect(await WalkExecutor.walkTo(ardougne, { useTeleportCatalog: false })).toBe(true);
        expect(withdrawn).toBe(50);
        expect(crossings).toBe(2);
        expect(coins).toBe(0);
        expect(here).toEqual(ardougne);
    });

    test('keeps an already funded route', async () => {
        coins = 60;
        expect(await WalkExecutor.walkTo(ardougne, { useTeleportCatalog: false })).toBe(true);
        expect(withdrawn).toBe(0);
        expect(crossings).toBe(2);
    });
});
