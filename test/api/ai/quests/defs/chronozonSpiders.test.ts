import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'fflate';
import { reader, type NpcSnapshot, type WorldTile } from '#/bot/adapter/ClientAdapter.js';
import { fightChronozon, SAFESPOT, BLASTS } from '#/bot/api/ai/quests/defs/familycrest/chronozon.js';
import { FC_ID } from '#/bot/api/ai/quests/defs/familycrest/areas.js';
import { GameMessages } from '#/bot/api/chatbox/gameMessages.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { InvItem } from '#/bot/api/inventory/Inventory.js';
import { GroundItem } from '#/bot/api/grounditems/GroundItems.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { WalkExecutor } from '#/bot/event/webwalk/WalkExecutor.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { emptyWorldStateData } from '#/bot/event/webwalk/worldStateData.js';
import Tile from '#/bot/geometry/Tile.js';

afterEach(() => { mock.restore(); GameMessages.reset(); });

test('moves away from an approaching spider during a blast and waits to loot a guarded crest', async () => {
    let me = SAFESPOT;
    const demon = new Tile(3087, 9937, 0);
    let spider: Tile | null = null;
    let dropped = false;
    let held = false;
    let guardedTicks = 0;
    let casts = 0;
    let stoppedShort = false;
    let retaliate = true;
    const spells: string[] = [];
    const destinations: WorldTile[] = [];
    const npc = (id: number, tile: Tile, size: number): NpcSnapshot => ({
        id, index: id, size, tile, distance: tile.distanceTo(me), name: String(id), ops: ['Attack'],
        anim: -1, level: 1, inCombat: false, health: 1, totalHealth: 1, faceEntity: -1
    });
    const tick = () => {
        if (casts === 1) spider = SAFESPOT;
        if (dropped && ++guardedTicks > 4) spider = null;
    };
    spyOn(EventSignal, 'pending').mockReturnValue(false);
    spyOn(Sustain, 'run').mockResolvedValue(undefined);
    spyOn(Game, 'autoRetaliateOn').mockImplementation(() => retaliate);
    spyOn(Game, 'setAutoRetaliate').mockImplementation(on => { retaliate = on; return true; });
    spyOn(Game, 'tile').mockImplementation(() => me);
    spyOn(Reachability, 'lineOfSight').mockReturnValue(true);
    spyOn(reader, 'npcs').mockImplementation(() => [...(dropped ? [] : [npc(667, demon, 3)]), ...(spider ? [npc(134, spider, 1)] : [])]);
    spyOn(reader, 'groundItems').mockImplementation(() => dropped && !held ? [{
        id: FC_ID.CREST_FROM_CHRONOZON, tile: demon, count: 1, distance: demon.distanceTo(me), ops: ['Take'], name: 'Crest part'
    }] : []);
    spyOn(reader, 'inventory').mockImplementation(() => held ? [{
        slot: 0, comId: 3214, id: FC_ID.CREST_FROM_CHRONOZON, name: 'Crest part', ops: [], count: 1
    }] : []);
    spyOn(Execution, 'delayTicks').mockImplementation(async n => { for (let i = 0; i < n; i++) tick(); });
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async (cond, n) => {
        for (let i = 0; !cond() && i < n; i++) tick();
        return cond();
    });
    spyOn(WalkExecutor, 'walkTo').mockImplementation(async (dest, opts) => {
        if (spider) expect(opts?.avoidZones).toContainEqual({ minX: spider.x - 1, maxX: spider.x + 1, minZ: spider.z - 1, maxZ: spider.z + 1, level: 0 });
        destinations.push(dest);
        if (dropped && !stoppedShort) { stoppedShort = true; return true; }
        me = Tile.from(dest);
        return true;
    });
    spyOn(Game, 'castOnNpc').mockImplementation(async spell => {
        expect(retaliate).toBe(false);
        if (spider) expect(me.distanceTo(spider)).toBeGreaterThan(2);
        spells.push(spell);
        if (++casts > 1) GameMessages.record('Chronozon weakens...');
        if (casts === 6) { dropped = true; spider = demon; }
        return true;
    });
    spyOn(GroundItem.prototype, 'interact').mockImplementation(() => {
        expect(spider).toBeNull();
        expect(me).toEqual(demon);
        held = true;
        return true;
    });
    expect(await fightChronozon(() => {})).toBe(true);
    expect(spells).toEqual(['Wind blast', ...BLASTS, 'Fire blast']);
    expect(destinations[0]).not.toEqual(demon);
    expect(destinations.at(-1)).toEqual(demon);
    expect(retaliate).toBe(false);
});

test.skipIf(!existsSync('out/collision.lcnav.gz'))('the gate approach and spider exclusions lead through the dungeon to a casting tile', async () => {
    const finder = new PathFinder(gunzipSync(readFileSync('out/collision.lcnav.gz')));
    loadDefaultNavEdges(finder);
    const options = { state: { ...emptyWorldStateData(), members: true }, useTeleportCatalog: false };
    let me = new Tile(3093, 3493, 0);
    let crossed = false;
    let atBend = false;
    let dose = Number(FC_ID.ANTIPOISON_2);
    spyOn(reader, 'inventory').mockImplementation(() => [{ id: dose, slot: 0, count: 1, name: 'Antipoison', comId: 3214, ops: ['Drink'] }]);
    spyOn(InvItem.prototype, 'interact').mockImplementation(action => {
        expect(action).toBe('Drink');
        expect(me.z).toBeGreaterThan(9955);
        dose = FC_ID.ANTIPOISON_1;
        return true;
    });
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async cond => cond());
    spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
    const spider = new Tile(3089, 9945, 0);
    spyOn(reader, 'npcs').mockImplementation(() => atBend ? [{ id: 134, index: 1, size: 1, tile: spider,
        distance: spider.distanceTo(me), name: 'Poison spider', ops: [], anim: -1, level: 64,
        inCombat: false, health: 1, totalHealth: 1, faceEntity: -1 }] : []);
    spyOn(Game, 'tile').mockImplementation(() => me);
    spyOn(Game, 'autoRetaliateOn').mockReturnValue(false);
    spyOn(Game, 'runEnabled').mockReturnValue(true);
    spyOn(EventSignal, 'pending').mockImplementation(() => crossed);
    spyOn(Sustain, 'run').mockResolvedValue(undefined);
    const approach = spyOn(Traversal, 'walkResilient').mockImplementation(async dest => {
        expect(finder.findPath(me, dest, options).ok).toBe(true);
        expect(dest.z).toBeGreaterThan(9955);
        me = Tile.from(dest);
        return true;
    });
    const cross = spyOn(WalkExecutor, 'walkTo').mockImplementation(async (dest, opts) => {
        const avoidZones = (opts?.avoidZones ?? []).filter(z => typeof z !== 'string');
        const route = finder.findPath(me, dest, { ...options, avoidZones });
        expect(dose).toBe(FC_ID.ANTIPOISON_1);
        if (!atBend) {
            expect(avoidZones).toHaveLength(3);
            expect(route.ok).toBe(true);
            expect(dest.z).toBeGreaterThan(9945);
            atBend = true;
            me = Tile.from(dest);
            return true;
        }
        expect(avoidZones).toHaveLength(4);
        if (avoidZones.at(-1)!.minX === spider.x - 1) {
            expect(route.ok).toBe(false);
            WalkExecutor.lastOutcome = 'unreachable';
            return false;
        }
        expect(avoidZones.at(-1)!.minX).toBe(spider.x);
        expect(route.ok).toBe(true);
        expect(dest.z).toBeLessThan(9934);
        me = Tile.from(dest);
        crossed = true;
        return true;
    });
    const outcome = WalkExecutor.lastOutcome;
    try {
        expect(await fightChronozon(() => {})).toBe(false);
        expect(approach).toHaveBeenCalledTimes(1);
        expect(cross).toHaveBeenCalledTimes(3);
    } finally {
        WalkExecutor.lastOutcome = outcome;
    }
});
