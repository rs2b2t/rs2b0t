import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Loc } from '#/bot/api/model/Loc.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { DirectNavigator } from '#/bot/event/webwalk/DirectNavigator.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import BrimhavenAgility from '#/bot/scripts/BrimhavenAgility/BrimhavenAgility.js';
import {
    ARENA_EDGES,
    ARENA_VARP,
    PILLARS,
    PLANK_BRIDGES,
    PLANK_BROKEN_LOC,
    PLANK_INTACT_LOCS,
    TICKET_NAME,
    intactPlankRows,
    isPlankEntry,
    plankBridgeOf,
    type PlankBridge
} from '#/bot/scripts/BrimhavenAgility/BrimhavenAgilityLogic.js';
import { loadLocTypes } from '../../../tools/nav/lib.js';

// Why: the layouts are copied from `agilityarena_change_planks` in agilityarena_clerk.rs2, lines 139-232, with absolute x = 43 * 64 + x and z = 149 * 64 + z.
// Why: F is ~random_fixed_bridge (intact), B is agilityarena_plank_broke1 and A is ~random_any_bridge (either), with columns in the clerk's order from its highest x.
type Cell = 'F' | 'B' | 'A';
const OUTER_BROKEN: Cell[] = ['B', 'A', 'A', 'B'];
const ALL_FIXED: Cell[] = ['F', 'F', 'F', 'F'];
interface ClerkSet {
    bridge: PlankBridge;
    /** Clerk-local x of each column. */
    xs: number[];
    /** Clerk-local z of each row, in the order the clerk lists them. */
    zs: number[];
    /** One entry per `$rand` branch: the cells of each row in `zs` order. */
    layouts: Cell[][][];
}
const SETS: ClerkSet[] = [
    {
        bridge: PLANK_BRIDGES.find(b => b.a === 24)!,
        xs: [49, 48, 47, 46],
        zs: [55, 54, 53],
        layouts: [
            [ALL_FIXED, OUTER_BROKEN, OUTER_BROKEN],
            [OUTER_BROKEN, ALL_FIXED, OUTER_BROKEN],
            [OUTER_BROKEN, OUTER_BROKEN, ALL_FIXED]
        ]
    },
    {
        bridge: PLANK_BRIDGES.find(b => b.a === 5)!,
        xs: [16, 15, 14, 13],
        zs: [22, 21, 20],
        layouts: [
            [ALL_FIXED, OUTER_BROKEN, OUTER_BROKEN],
            [OUTER_BROKEN, ALL_FIXED, OUTER_BROKEN],
            [OUTER_BROKEN, OUTER_BROKEN, ALL_FIXED]
        ]
    }
];

type Plank = { id: number; x: number; z: number };

/** The plank locs one clerk rebuild leaves, with every `A` cell resolved to broken or intact. */
function rebuilt(set: ClerkSet, layout: Cell[][], any: 'broken' | 'intact'): Plank[] {
    const planks: Plank[] = [];
    layout.forEach((cells, row) => {
        cells.forEach((cell, col) => {
            const intact = PLANK_INTACT_LOCS[(col + row) % PLANK_INTACT_LOCS.length];
            const id = cell === 'B' || (cell === 'A' && any === 'broken') ? PLANK_BROKEN_LOC : intact;
            planks.push({ id, x: 43 * 64 + set.xs[col], z: 149 * 64 + set.zs[row] });
        });
    });
    return planks;
}

/** Walk-on entry locs the map places one tile outside each end of each row (agilityarena_plank, _plank2, _plank3). */
function entries(bridge: PlankBridge): Plank[] {
    return bridge.rows.flatMap((z, i) => [bridge.outerX[0] - 1, bridge.outerX[1] + 1].map(x => ({ id: 3570 + ((i + x) % 3), x, z })));
}

const intactRowOf = (set: ClerkSet, layout: Cell[][]): number => 149 * 64 + set.zs[layout.findIndex(cells => cells.every(c => c === 'F'))];

describe('Brimhaven plank row chooser', () => {
    test('the clerk fixtures sit on the two plank bridges', () => {
        for (const set of SETS) {
            for (const layout of set.layouts) {
                for (const plank of rebuilt(set, layout, 'intact')) {
                    expect(set.bridge.rows, `row ${plank.z}`).toContain(plank.z);
                    expect(plank.x, `column ${plank.x}`).toBeGreaterThanOrEqual(set.bridge.outerX[0]);
                    expect(plank.x).toBeLessThanOrEqual(set.bridge.outerX[1]);
                }
            }
        }
    });

    test('picks the row with no broken plank for each of the three clerk layouts, on both bridges', () => {
        for (const set of SETS) {
            set.layouts.forEach((layout, rand) => {
                for (const any of ['broken', 'intact'] as const) {
                    const planks = rebuilt(set, layout, any);
                    expect(intactPlankRows(set.bridge, planks), `bridge ${set.bridge.a}-${set.bridge.b} rand ${rand} inner ${any}`).toEqual([
                        intactRowOf(set, layout)
                    ]);
                }
            });
        }
    });

    test('the three layouts pick three different rows, and only one of them is the middle row', () => {
        for (const set of SETS) {
            const picked = set.layouts.map(layout => intactPlankRows(set.bridge, rebuilt(set, layout, 'broken'))[0]);
            expect(new Set(picked).size).toBe(3);
            expect(picked.filter(z => z === set.bridge.rows[1])).toHaveLength(1);
        }
    });

    test('refuses a row as soon as one outer tile is a broken plank', () => {
        for (const set of SETS) {
            set.layouts.forEach(layout => {
                const intactRow = intactRowOf(set, layout);
                for (const x of set.bridge.outerX) {
                    const damaged = rebuilt(set, layout, 'intact').map(p => (p.x === x && p.z === intactRow ? { ...p, id: PLANK_BROKEN_LOC } : p));
                    expect(intactPlankRows(set.bridge, damaged), `outer ${x} of ${intactRow}`).toEqual([]);
                }
            });
        }
    });

    test('a broken inner tile does not refuse a row whose outer tiles are intact', () => {
        const set = SETS[0];
        const layout = set.layouts[1];
        const planks = rebuilt(set, layout, 'intact').map(p => (p.x === 43 * 64 + 48 && p.z === intactRowOf(set, layout) ? { ...p, id: PLANK_BROKEN_LOC } : p));
        expect(intactPlankRows(set.bridge, planks)).toEqual([intactRowOf(set, layout)]);
    });

    test('an outer tile that is not in view never counts as intact', () => {
        const set = SETS[1];
        const planks = rebuilt(set, set.layouts[0], 'broken');
        expect(intactPlankRows(set.bridge, [])).toEqual([]);
        const intactRow = intactRowOf(set, set.layouts[0]);
        expect(intactPlankRows(set.bridge, planks.filter(p => !(p.z === intactRow && p.x === set.bridge.outerX[1])))).toEqual([]);
    });

    test('every plank edge has a bridge and its entries sit one tile outside the outer planks', () => {
        const edges = ARENA_EDGES.filter(e => e.kind === 'plank');
        expect(edges).toHaveLength(PLANK_BRIDGES.length);
        for (const edge of edges) {
            const bridge = plankBridgeOf(edge);
            expect(bridge, `${edge.a}-${edge.b}`).not.toBeNull();
            const a = PILLARS[edge.a];
            const b = PILLARS[edge.b];
            // The bridge runs along the platforms' row, between their x.
            expect(bridge!.rows).toContain(a.z);
            expect(a.z).toBe(b.z);
            expect(bridge!.outerX[0]).toBeGreaterThan(Math.min(a.x, b.x));
            expect(bridge!.outerX[1]).toBeLessThan(Math.max(a.x, b.x));
            for (const entry of entries(bridge!)) {
                expect(isPlankEntry(bridge!, entry.x, entry.z)).toBe(true);
            }
            expect(isPlankEntry(bridge!, bridge!.outerX[0], bridge!.rows[0])).toBe(false);
            expect(isPlankEntry(bridge!, bridge!.outerX[0] - 1, bridge!.rows[2] + 1)).toBe(false);
        }
        expect(plankBridgeOf(ARENA_EDGES.find(e => e.kind === 'swing')!)).toBeNull();
    });
});

const engine = process.env.ENGINE_DIR ?? join(homedir(), 'code/rs2b2t-engine');
const packed = [join(engine, 'data/pack/server/loc.dat'), join(engine, 'data/pack/client/config')].every(existsSync);

describe.skipIf(!packed)('Brimhaven plank loc ids against the packed content', () => {
    test('the ids are the content pack ids of the broken and the intact planks', () => {
        const { names } = loadLocTypes(engine);
        expect(names.get('agilityarena_plank_broke1')).toBe(PLANK_BROKEN_LOC);
        expect([names.get('agilityarena_plank_middle'), names.get('agilityarena_plank2_middle'), names.get('agilityarena_plank3_middle')]).toEqual([
            ...PLANK_INTACT_LOCS
        ]);
    });

    test('the broken plank shares the name of the intact ones, so only the id tells them apart', () => {
        const { configs, names } = loadLocTypes(engine);
        const broken = configs[names.get('agilityarena_plank_broke1')!];
        const intact = configs[names.get('agilityarena_plank_middle')!];
        expect(broken.name).toBe('Plank');
        expect(intact.name).toBe('Plank');
    });
});

const original = {
    varp: reader.varp,
    locs: reader.locs,
    delayUntil: Execution.delayUntil,
    delayTicks: Execution.delayTicks,
    ingame: Game.ingame,
    sceneReady: Game.sceneReady,
    tile: Game.tile,
    animating: Game.animating,
    runEnabled: Game.runEnabled,
    inventoryItems: Inventory.items,
    inventoryCount: Inventory.count,
    skillLevel: Skills.level,
    skillEffective: Skills.effective,
    skillXp: Skills.xp,
    walkResilient: Traversal.walkResilient,
    walkTo: DirectNavigator.walkTo,
    walkable: Reachability.walkable,
    canReach: Reachability.canReach
};

afterEach(() => {
    mock.restore();
    reader.varp = original.varp;
    reader.locs = original.locs;
    Execution.delayUntil = original.delayUntil;
    Execution.delayTicks = original.delayTicks;
    Game.ingame = original.ingame;
    Game.sceneReady = original.sceneReady;
    Game.tile = original.tile;
    Game.animating = original.animating;
    Game.runEnabled = original.runEnabled;
    Inventory.items = original.inventoryItems;
    Inventory.count = original.inventoryCount;
    Skills.level = original.skillLevel;
    Skills.effective = original.skillEffective;
    Skills.xp = original.skillXp;
    Traversal.walkResilient = original.walkResilient;
    DirectNavigator.walkTo = original.walkTo;
    Reachability.walkable = original.walkable;
    Reachability.canReach = original.canReach;
});

/** Runs the bot's CrossObstacle task from `from` toward `goal` against a scene of the given plank locs and returns the Walk-on tiles clicked. */
async function crossFrom(
    from: number,
    goal: number,
    agility: number,
    planks: Plank[],
    bridge: PlankBridge,
    logs: string[],
    /** When set, the first click does not start the crossing and the clerk then rebuilds the bridge into these planks. */
    rebuiltAfterFirstClick?: Plank[]
): Promise<Array<{ x: number; z: number }>> {
    let here = { x: PILLARS[from].x, z: PILLARS[from].z, level: 3 };
    const sceneOf = (current: Plank[]) =>
        [...current, ...entries(bridge)].map(p => {
            const walkOn = p.id >= 3570 && p.id <= 3572;
            return {
                typecode: p.id << 14,
                id: p.id,
                name: 'Plank',
                ops: walkOn ? ['Walk-on'] : [],
                tile: { x: p.x, z: p.z, level: 3 },
                distance: 3
            };
        });
    let scene = sceneOf(planks);
    Game.ingame = () => true;
    Game.sceneReady = () => true;
    Game.tile = () => here;
    Game.animating = () => false;
    Game.runEnabled = () => true;
    Execution.delayUntil = async condition => condition();
    Execution.delayTicks = async () => {};
    reader.varp = id => (id === ARENA_VARP ? 2 : 0);
    reader.locs = () => scene;
    Inventory.items = () => [{ name: 'Lobster', slot: 0 }] as never;
    Inventory.count = name => (name === 'Coins' ? 1000 : name === TICKET_NAME ? 0 : name === 'Lobster' ? 1 : 0);
    Skills.level = name => (name === 'agility' ? agility : 20);
    Skills.effective = name => (name === 'hitpoints' ? 40 : name === 'agility' ? agility : 1);
    Skills.xp = () => 0;
    Traversal.walkResilient = async () => true;
    DirectNavigator.walkTo = async () => true;
    Reachability.walkable = () => true;
    Reachability.canReach = () => true;
    const clicked: Array<{ x: number; z: number }> = [];
    spyOn(Loc.prototype, 'interact').mockImplementation(function (this: Loc) {
        clicked.push({ x: this.tile().x, z: this.tile().z });
        if (rebuiltAfterFirstClick === undefined) {
            here = { x: PILLARS[goal].x, z: PILLARS[goal].z, level: 3 };
        } else if (clicked.length === 1) {
            scene = sceneOf(rebuiltAfterFirstClick);
        } else {
            here = { x: PILLARS[goal].x, z: PILLARS[goal].z, level: 3 };
        }
        return true;
    });
    const bot = new BrimhavenAgility();
    bot.settings = new SettingsBag({ food: 'Lobster', foodWithdraw: 10, bankAtTickets: 1000, stealRestock: false });
    bot.bindLog(msg => logs.push(msg));
    await bot.onStart();
    bot.targetPillar = () => goal;
    const cross = bot['tasks'].find(task => task.constructor.name === 'CrossObstacle');
    if (!cross) {
        throw new Error('CrossObstacle missing');
    }
    expect(cross.validate()).toBe(true);
    await cross.execute();
    bot.disposeSubscriptions();
    return clicked;
}

describe('Brimhaven plank crossing uses the intact row', () => {
    test('the landing plank 24 to 23 is entered on the intact row for each clerk layout', async () => {
        const set = SETS[0];
        for (const [rand, layout] of set.layouts.entries()) {
            const logs: string[] = [];
            const clicked = await crossFrom(24, 23, 75, rebuilt(set, layout, 'broken'), set.bridge, logs);
            expect(clicked, `rand ${rand}: ${logs.join(' | ')}`).toEqual([{ x: set.bridge.outerX[1] + 1, z: intactRowOf(set, layout) }]);
            expect(logs.some(line => line.includes(`rows with intact outer planks: ${intactRowOf(set, layout)})`))).toBe(true);
        }
    });

    test('the 5 to 6 plank is entered on the intact row for each clerk layout, at agility 1', async () => {
        const set = SETS[1];
        for (const [rand, layout] of set.layouts.entries()) {
            const logs: string[] = [];
            const clicked = await crossFrom(5, 6, 1, rebuilt(set, layout, 'intact'), set.bridge, logs);
            expect(clicked, `rand ${rand}: ${logs.join(' | ')}`).toEqual([{ x: set.bridge.outerX[0] - 1, z: intactRowOf(set, layout) }]);
        }
    });

    test('walking back from 6 to 5 enters on the east side of the intact row', async () => {
        const set = SETS[1];
        const layout = set.layouts[0];
        const clicked = await crossFrom(6, 5, 1, rebuilt(set, layout, 'broken'), set.bridge, []);
        expect(clicked).toEqual([{ x: set.bridge.outerX[1] + 1, z: intactRowOf(set, layout) }]);
    });

    test('a re-click after the clerk rebuilds the bridge goes to the new intact row, not the old one', async () => {
        const set = SETS[0];
        const logs: string[] = [];
        const clicked = await crossFrom(24, 23, 75, rebuilt(set, set.layouts[1], 'broken'), set.bridge, logs, rebuilt(set, set.layouts[2], 'broken'));
        expect(clicked, logs.join(' | ')).toEqual([
            { x: set.bridge.outerX[1] + 1, z: intactRowOf(set, set.layouts[1]) },
            { x: set.bridge.outerX[1] + 1, z: intactRowOf(set, set.layouts[2]) }
        ]);
    });

    test('a re-click while the bridge is out of view does not reuse the first row', async () => {
        const set = SETS[0];
        const logs: string[] = [];
        const clicked = await crossFrom(24, 23, 75, rebuilt(set, set.layouts[1], 'broken'), set.bridge, logs, []);
        expect(clicked, logs.join(' | ')).toEqual([{ x: set.bridge.outerX[1] + 1, z: intactRowOf(set, set.layouts[1]) }]);
        expect(logs.some(line => line.includes('no plank row with intact outer planks in view (attempt 2)'))).toBe(true);
    });

    test('with no plank row in view the bot does not click a plank', async () => {
        const logs: string[] = [];
        const clicked = await crossFrom(24, 23, 75, [], SETS[0].bridge, logs);
        expect(clicked).toEqual([]);
        expect(logs.some(line => line.includes('no plank row with intact outer planks in view'))).toBe(true);
    });
});
