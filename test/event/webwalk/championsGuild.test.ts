import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'fflate';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { decide } from '#/bot/api/ai/quests/defs/dragonslayer/index.js';
import { gotoNpc } from '#/bot/api/ai/quests/exec/primitives.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { Input } from '#/bot/input/Input.js';
import { DirectNavigator } from '#/bot/event/webwalk/DirectNavigator.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { WalkExecutor } from '#/bot/event/webwalk/WalkExecutor.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { emptyWorldStateData } from '#/bot/event/webwalk/worldStateData.js';

const outside = { x: 3191, z: 3363, level: 0 };
const inside = { x: 3191, z: 3362, level: 0 };
const shop = { x: 3191, z: 3352, level: 1 };
const transport = { locId: 1805, locX: outside.x, locZ: outside.z, locName: 'Door', action: 'Open', kind: 'door' as const };

afterEach(() => mock.restore());

test.skipIf(!existsSync('out/collision.lcnav.gz'))('routes to Scavvo through the guild door and up the stairs at 32 quest points', () => {
    const finder = new PathFinder(gunzipSync(readFileSync('out/collision.lcnav.gz')));
    loadDefaultNavEdges(finder);
    const west = { x: 3187, z: 3355, level: 0 };
    const route = (questPoints: number, from = west, to = shop) => finder.findPath(from, to, {
        state: { ...emptyWorldStateData(), questPoints }, useTeleportCatalog: false, maxExpansions: 20_000
    });
    expect(route(31).ok).toBe(false);
    const eligible = route(32);
    expect(eligible.ok).toBe(true);
    if (eligible.ok) expect(eligible.hops.filter(h => h.kind !== 'walk').map(h => h.locId)).toEqual([1805, 1722]);
    const back = route(32, shop, west);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.hops.filter(h => h.kind !== 'walk').map(h => h.locId)).toEqual([1723, 1805]);
});

test('starting Dragon Slayer on the doorstep still walks inside to the Guild master', async () => {
    const step = decide({ journal: 'notStarted', inv: new Map(), worn: new Set(), bankCoins: 0, noProgress: 0,
        progress: { stage: 0, flags: new Set() } });
    expect(step.kind).toBe('talk');
    if (step.kind !== 'talk') return;
    let here = outside;
    spyOn(reader, 'worldTile').mockImplementation(() => here);
    spyOn(reader, 'npcs').mockReturnValue([{ id: 198, index: 1, name: 'Guild master', anim: -1, level: 0, size: 1,
        tile: inside, distance: 1, ops: ['Talk-to'], inCombat: false, health: 1, totalHealth: 1, faceEntity: -1 }]);
    const walk = spyOn(Traversal, 'walkResilient').mockImplementation(async dest => {
        here = dest;
        return true;
    });
    expect(await gotoNpc(step.stop, [], () => {})).toBe(true);
    expect(walk).toHaveBeenCalledTimes(1);
    expect(here.z).toBeLessThan(outside.z);
});

test.each([
    { entering: true, points: 32 },
    { entering: false, points: 32 },
    { entering: true, points: 31 }
])('executes the guild door with %j', async ({ entering, points }) => {
    const from = entering ? outside : inside;
    const to = entering ? inside : outside;
    let here = from;
    let prompt = false;
    let queuedGreeting = false;
    spyOn(Quests, 'points').mockReturnValue(points);
    spyOn(reader, 'worldTile').mockImplementation(() => here);
    spyOn(reader, 'serverTile').mockImplementation(() => here);
    spyOn(reader, 'locs').mockReturnValue([{ id: 1805, typecode: 0, tile: outside, name: 'Door', ops: ['Open'], distance: 1 }]);
    spyOn(reader, 'toLocal').mockImplementation((x, z) => ({ lx: x, lz: z }));
    spyOn(Reachability, 'canStep').mockReturnValue(false);
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    spyOn(Execution, 'delayTicks').mockImplementation(async () => {
        if (queuedGreeting) prompt = true;
        queuedGreeting = false;
    });
    spyOn(ChatDialog, 'isOpen').mockImplementation(() => prompt);
    spyOn(ChatDialog, 'canContinue').mockImplementation(() => prompt);
    const next = spyOn(ChatDialog, 'continue').mockImplementation(async () => { prompt = false; return true; });
    const move = spyOn(DirectNavigator, 'walk').mockReturnValue(true);
    const open = spyOn(Input, 'interactLoc').mockImplementation(() => {
        if (points < 32) throw new Error('attempted a locked door');
        here = to;
        queuedGreeting = entering;
        return true;
    });
    expect(await WalkExecutor['handleTransport'](from, { ...to, transport }, () => {})).toBe(points >= 32);
    expect(here).toEqual(points >= 32 ? to : from);
    expect(open).toHaveBeenCalledTimes(points >= 32 ? 1 : 0);
    expect(move).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(entering && points >= 32 ? 1 : 0);
    expect(prompt || queuedGreeting).toBe(false);
});
