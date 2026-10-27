import { afterEach, expect, spyOn, test } from 'bun:test';
import { reader, type LocSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Banking } from '#/bot/api/bank/Banking.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Navigator } from '#/bot/event/webwalk/Navigator.js';
import { Input } from '#/bot/input/Input.js';
import { gameSupplyPort } from '#/bot/scripts/AccountLeveler/supplies.js';

const restores: (() => void)[] = [];
afterEach(() => { for (const restore of restores.splice(0).reverse()) restore(); });

function fixture(distance: number, fishing = 1, guild = 'Fishing Guild') {
    const booth: LocSnapshot = {
        id: 2213, typecode: 0, name: 'Bank booth', ops: ['Use-quickly'], distance,
        tile: guild === 'Fishing Guild' ? { x: 2585, z: 3419, level: 0 } : { x: 3512, z: 3481, level: 0 }
    };
    let here = { ...booth.tile, x: booth.tile.x + distance };
    let walked = false;
    const logs: string[] = [];
    const patches = [
        spyOn(reader, 'locs').mockImplementation(() => walked ? [] : [booth]),
        spyOn(reader, 'worldTile').mockImplementation(() => here),
        spyOn(Game, 'tile').mockImplementation(() => here),
        spyOn(Skills, 'level').mockImplementation(name => name === 'fishing' ? fishing : 1),
        spyOn(Quests, 'status').mockReturnValue('notStarted'),
        spyOn(Bank, 'isOpen').mockReturnValue(false),
        spyOn(Bank, 'waitReady').mockResolvedValue(true),
        spyOn(Navigator, 'findPath').mockImplementation(async (_from, to) =>
            to.x === 2616 && to.z === 3332 ? { ok: true, cost: 100, waypoints: [], expanded: 1, hops: [] } : { ok: false, reason: 'unreachable', expanded: 1 }),
        spyOn(Traversal, 'walkResilient').mockImplementation(async tile => { here = tile; walked = true; return true; }),
        spyOn(Bank, 'openNearestAccess').mockResolvedValue(true)
    ];
    restores.push(...patches.map(patch => () => patch.mockRestore()));
    return { logs, booth, here: () => here, walked: () => walked };
}

test.each([10, 40])('leveler skips a locked Fishing Guild booth visible %s tiles away and logs its alternative', async distance => {
    const f = fixture(distance);
    expect(await gameSupplyPort(message => f.logs.push(message)).bank()).toBe(true);
    expect(f.here()).toMatchObject({ x: 2616, z: 3332, level: 0 });
    expect(f.logs.some(message => /skip.*Fishing Guild/i.test(message))).toBe(true);
    expect(f.logs.some(message => message.includes('Ardougne West'))).toBe(true);
});

test.each([67, 68])('Fishing %s controls whether a visible guild booth can shortcut bank routing', async fishing => {
    const f = fixture(10, fishing);
    expect(await Banking.open()).toBe(true);
    expect(f.walked()).toBe(fishing < 68);
});

test('visible Canifis booths cannot bypass Priest in Peril', async () => {
    const f = fixture(10, 1, 'Canifis');
    expect(await Banking.open()).toBe(true);
    expect(f.here()).toMatchObject({ x: 2616, z: 3332, level: 0 });
});

test('failed bank travel returns without trying the inaccessible booth still in the scene', async () => {
    fixture(40);
    const walk = spyOn(Traversal, 'walkResilient').mockResolvedValue(false);
    const open = spyOn(Bank, 'openNearestAccess').mockImplementation(async () => { throw new Error('must not open after failed travel'); });
    restores.push(() => walk.mockRestore(), () => open.mockRestore());
    expect(await Banking.open()).toBe(false);
});

test('the low-level bank opener never clicks a locked guild booth', async () => {
    fixture(10);
    const clicks: number[] = [];
    const patches = [
        spyOn(reader, 'toLocal').mockReturnValue({ lx: 10, lz: 10 }),
        spyOn(Input, 'interactLoc').mockImplementation((x) => { clicks.push(x); return false; }),
        spyOn(Execution, 'delayUntil').mockResolvedValue(false),
        spyOn(Traversal, 'walkTo').mockResolvedValue(false)
    ];
    restores.push(...patches.map(patch => () => patch.mockRestore()));
    expect(await Bank.openNearest('Bank booth', 'Use-quickly')).toBe(false);
    expect(clicks).toEqual([]);
});
