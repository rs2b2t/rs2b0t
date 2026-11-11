import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'fflate';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Input } from '#/bot/input/Input.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { WalkExecutor } from '#/bot/event/webwalk/WalkExecutor.js';
import { emptyWorldStateData } from '#/bot/event/webwalk/worldStateData.js';
import { stubProps } from '../../lib/stubSingletons.js';

const outside = { x: 2924, z: 9803, level: 0 };
const inside = { x: 2923, z: 9803, level: 0 };
const bank = { x: 2946, z: 3369, level: 0 };
const camp = { x: 2897, z: 9765, level: 0 };
const packPath = 'out/collision.lcnav.gz';

describe.skipIf(!existsSync(packPath))('Taverley dusty-key gate routes', () => {
    const finder = existsSync(packPath) ? new PathFinder(gunzipSync(readFileSync(packPath))) : undefined;
    if (finder) loadDefaultNavEdges(finder);
    test('routes from Falador bank to the southern babies using the Dusty key', () => {
        const out = finder!.findPath(bank, camp, {
            state: { ...emptyWorldStateData(), items: { 'Dusty key': 1 } }, useTeleportCatalog: false
        });
        expect(out.ok).toBe(true);
        if (out.ok) expect(out.hops).toContainEqual(expect.objectContaining({ locId: 2623, from: outside, to: inside }));
    }, 30_000);
    test('cannot enter the adult lair or southern baby room without the key', () => {
        const state = emptyWorldStateData();
        expect(finder!.findPath(outside, inside, { state, useTeleportCatalog: false }).ok).toBe(false);
        expect(finder!.findPath(bank, camp, { state, useTeleportCatalog: false }).ok).toBe(false);
    }, 30_000);
    test('can leave the baby room and bank without a key', () => {
        const back = finder!.findPath(camp, bank, { state: emptyWorldStateData(), useTeleportCatalog: false });
        expect(back.ok).toBe(true);
        if (back.ok) expect(back.hops).toContainEqual(expect.objectContaining({ locId: 2623, from: inside, to: outside }));
    }, 30_000);
    test.each([{ x: 2895, z: 9765, level: 0 }, { x: 2895, z: 9769, level: 0 }, { x: 2900, z: 9763, level: 0 }])('the southern camp reaches baby spawn %j on foot', spawn => {
        expect(finder!.walkable(camp.x, camp.z, camp.level)).toBe(true);
        const path = finder!.findPath(camp, spawn, { state: emptyWorldStateData(), useTeleportCatalog: false });
        expect(path.ok).toBe(true);
        if (path.ok) expect(path.hops.every(hop => hop.kind === 'walk')).toBe(true);
    });
});

describe('Taverley dusty-key gate execution', () => {
    let here = outside, inventory: InvItemSnapshot[], restores: (() => void)[], opened: number, used: number;
    const cross = (entering: boolean) => WalkExecutor['handleTransport'](entering ? outside : inside, {
        ...(entering ? inside : outside),
        transport: { locId: 2623, locName: 'Gate', action: 'Open', kind: 'dungeon', locX: 2924, locZ: 9803, toTile: entering ? inside : outside }
    }, () => {});
    beforeEach(() => {
        here = outside;
        opened = 0;
        used = 0;
        inventory = [{ id: 1590, name: 'Dusty key', slot: 0, count: 1, ops: [], comId: 3214 }];
        restores = [
            stubProps(reader, {
                worldTile: () => here, inventory: () => inventory, bankComId: () => -1,
                locs: () => [{ id: 2623, name: 'Gate', typecode: 0, ops: ['Open'], tile: outside, distance: 1 }],
                toLocal: (x, z) => ({ lx: x, lz: z })
            }),
            stubProps(Execution, { delayTicks: async () => {}, delayUntil: async predicate => predicate() }),
            stubProps(ChatDialog, { isOpen: () => false, canContinue: () => false, options: () => [] }),
            stubProps(Input, {
                useItemOnLoc: (id, slot, comId, x, z, typecode) => {
                    if (id !== 1590 || slot !== 0 || comId !== 3214 || x !== 2924 || z !== 9803 || typecode !== 0 || here.x !== 2924) return false;
                    used++;
                    here = inside;
                    return true;
                },
                interactLoc: (x, z, typecode, op) => {
                    if (x !== 2924 || z !== 9803 || typecode !== 0 || op !== 1 || here.x !== 2923) return false;
                    opened++;
                    here = outside;
                    return true;
                }
            })
        ];
    });
    afterEach(() => { for (const restore of restores.reverse()) restore(); });
    test('uses and retains the Dusty key entering from the east', async () => {
        expect(await cross(true)).toBe(true);
        expect(here).toEqual(inside);
        expect(used).toBe(1);
        expect(opened).toBe(0);
        expect(inventory[0]?.count).toBe(1);
    });
    test('refuses the locked entrance without a key', async () => {
        inventory = [];
        expect(await cross(true)).toBe(false);
        expect(here).toEqual(outside);
        expect(used).toBe(0);
    });
    test('opens the exit from the west with an empty inventory', async () => {
        here = inside;
        inventory = [];
        expect(await cross(false)).toBe(true);
        expect(here).toEqual(outside);
        expect(opened).toBe(1);
        expect(used).toBe(0);
    });
});
