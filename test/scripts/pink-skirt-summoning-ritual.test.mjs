import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import test from 'node:test';

Reflect.set(globalThis, '__rs2b0t', { apiVersion: 1, LoopingBot: class {}, defineBot: x => x });
const base = new URL('../../src/bot/scripts/PinkSkirtSummoningRitual/', import.meta.url);
const logic = readFileSync(new URL('RitualLogic.js', base), 'utf8');
const native = readFileSync(new URL('PinkSkirtSummoningRitual.js', base), 'utf8');
const source =
    'const { LoopingBot, Game, Execution, Inventory, Equipment, Npcs, Shop, Skills, Traversal, DirectNavigator, Reachability, Tile, ChatDialog, Bank, nearestBank, reader } = globalThis.__rs2b0t;\n' +
    logic +
    native.slice(native.indexOf('function visiblePink()')).replace('export default class', 'class') +
    '\nexport default { create: () => new PinkSkirtSummoningRitual() };';
const mod = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const { FormationPeer, PATTERNS, CAPACITY, poseTile, queueTile, stagingTile, nextStep } = mod;
const anchor = { x: 100, z: 100, level: 0 };
const eq = (a, b) => mod.distance(a, b) === 0;
class World {
    constructor(n) {
        this.tick = 0;
        this.bots = new Map();
        this.random = [];
        this.history = [];
        for (let i = 0; i < n; i++) this.add(`bot${String(i).padStart(2, '0')}`);
    }
    add(name) {
        this.bots.set(name, { name, tile: queueTile(anchor), peer: new FormationPeer(name, anchor), offset: 7919 * this.bots.size, phases: new Set() });
    }
    step() {
        this.tick++;
        const rows = [...this.bots.values(), ...this.random].map(b => ({ name: b.name, tile: { ...b.tile } }));
        this.history.push(rows);
        const changes = [];
        for (const b of this.bots.values()) {
            if (b.paused) continue;
            const snapshot = b.delay ? this.history[Math.max(0, this.history.length - 1 - b.delay)] : rows;
            b.plan = b.peer.step(this.tick + b.offset, snapshot);
            if (b.plan.overflow) {
                changes.push([b, null]);
                continue;
            }
            if (b.plan.holding) b.phases.add(b.plan.phase);
            if (!b.blocked) changes.push([b, nextStep(b.tile, b.plan.target, anchor)]);
        }
        for (const [b, tile] of changes)
            if (tile) b.tile = tile;
            else this.bots.delete(b.name);
    }
    run(n) {
        for (let i = 0; i < n; i++) this.step();
    }
    cycling() {
        for (const b of this.bots.values()) b.phases.clear();
        this.run(250);
        for (const b of this.bots.values()) assert.deepEqual([...b.phases].sort(), [0, 1, 2, 3, 4], `${b.name}: phase ${b.plan.phase}, roster ${b.peer.roster}, resets ${b.peer.resetCount}`);
    }
}

test('five patterns include dot, filled 3x3 and complete 5x5 outline', () => {
    assert.equal(CAPACITY, 16);
    assert.deepEqual(
        PATTERNS.map(p => new Set(p.map(JSON.stringify)).size),
        [9, 9, 9, 16, 1]
    );
    for (const p of PATTERNS) {
        assert.equal(p.length, CAPACITY);
        for (const [x, z] of p) assert.ok(Math.abs(x) <= 2 && Math.abs(z) <= 2);
    }
    assert.ok(PATTERNS[4].every(([x, z]) => x === 0 && z === 0));
});
test('independent peers keep cycling with unrelated local clocks and no repeated assembly', () => {
    for (const n of [1, 5, 16]) {
        const w = new World(n);
        w.run(100);
        const resets = [...w.bots.values()].map(b => b.peer.resetCount);
        w.cycling();
        assert.deepEqual(
            [...w.bots.values()].map(b => b.peer.resetCount),
            resets
        );
        assert.ok([...w.bots.values()].every(b => b.peer.completed >= 10));
    }
});
test('random pink skirts crossing poses, queue and assembly never enter the roster or reset dancers', () => {
    const w = new World(5);
    w.run(100);
    const resets = [...w.bots.values()].map(b => b.peer.resetCount);
    w.random = [
        { name: 'standing', tile: stagingTile(anchor) },
        { name: 'queue sitter', tile: queueTile(anchor) },
        { name: 'centre sitter', tile: anchor }
    ];
    for (let t = 0; t < 180; t++) {
        w.random[3] = { name: `passer${Math.floor(t / 20)}`, tile: { x: anchor.x + (t % 9) - 4, z: anchor.z, level: 0 } };
        w.step();
    }
    for (const b of w.bots.values()) assert.equal(b.peer.roster.length, 5);
    assert.deepEqual(
        [...w.bots.values()].map(b => b.peer.resetCount),
        resets
    );
});
test('late arrivals wait through the current cycle and join together at its boundary', () => {
    const w = new World(5);
    w.run(85);
    w.add('aaaa');
    w.add('zzzz');
    const existing = w.bots.get('bot00');
    const resets = existing.peer.resetCount;
    w.run(22);
    assert.equal(existing.peer.resetCount, resets);
    assert.equal(existing.peer.roster.length, 5);
    w.run(180);
    w.cycling();
    for (const b of w.bots.values()) assert.equal(b.peer.roster.length, 7);
    assert.equal(existing.peer.resetCount, resets + 1);
});
test('overflow admits sixteen and late arrivals cannot displace incumbents', () => {
    const w = new World(18);
    w.run(120);
    assert.equal(w.bots.size, 16);
    w.add('aaaa');
    w.run(200);
    assert.equal(w.bots.has('aaaa'), false);
    w.cycling();
});
test('joins near the boundary and staggered newcomers share the admission barrier', () => {
    for (const at of [42, 60, 70, 78]) {
        const w = new World(5);
        w.run(at);
        w.add('first arrival');
        w.run(8);
        w.add('second arrival');
        w.run(180);
        w.cycling();
        for (const b of w.bots.values()) assert.equal(b.peer.roster.length, 7, `arrival at ${at}`);
    }
});
test('departure, pause and delayed observer recover without a leader', () => {
    const w = new World(8);
    w.run(110);
    w.bots.delete('bot00');
    w.cycling();
    w.bots.get('bot04').paused = true;
    w.run(20);
    w.bots.get('bot04').paused = false;
    w.cycling();
    const delayed = new World(5);
    delayed.bots.get('bot03').delay = 1;
    delayed.cycling();
});
test('duplicate observations do not advance and every target uses legal one-tile steps', () => {
    const p = new FormationPeer('solo', anchor),
        rows = [{ name: 'solo', tile: queueTile(anchor) }];
    p.step(999, rows);
    assert.equal(p.step(999, rows).fresh, false);
    const points = [queueTile(anchor), stagingTile(anchor), ...PATTERNS.flatMap((_, p) => Array.from({ length: CAPACITY }, (_, r) => poseTile(anchor, p, r)))];
    for (const from of points)
        for (const to of points) {
            let here = from;
            for (let i = 0; i < 20 && !eq(here, to); i++) {
                const next = nextStep(here, to, anchor);
                assert.ok(mod.distance(here, next) <= 1);
                here = next;
            }
            assert.ok(eq(here, to));
        }
});

let serial = 0;
async function fixture() {
    const s = { tick: 1, gp: 99, skirt: 1, worn: false, hp: 10, free: 20, shop: false, bank: false, depositWorks: true, events: [], steps: [], logs: [] };
    const raw = { name: 'Test dancer', ready: true, appearance: [], routeX: [3222], routeZ: [3218] };
    s.tile = () => ({ x: raw.routeX[0], z: raw.routeZ[0], level: 0 });
    s.move = t => {
        raw.routeX[0] = t.x;
        raw.routeZ[0] = t.z;
    };
    const npc = {
        tile: () => ({ x: 3222, z: 3218, level: 0 }),
        async interact() {
            s.events.push('pick');
            s.gp += 3;
            s.free = 27;
        }
    };
    const query = {
        name() {
            return this;
        },
        action() {
            return this;
        },
        where() {
            return this;
        },
        nearest() {
            return npc;
        }
    };
    const mocked = {
        apiVersion: 1,
        LoopingBot: class {
            log(m) {
                s.logs.push(m);
            }
            on() {}
        },
        defineBot: x => x,
        reader: { serverTile: s.tile, visiblePlayerStates: () => (s.worn ? [{ name: raw.name, networkTile: s.tile(), equipmentIds: [1013] }] : []) },
        Game: { ingame: () => true, sceneReady: () => true, tick: () => s.tick, tile: s.tile, myName: () => raw.name, setAutoRetaliate: () => true, autoRetaliateOn: () => false },
        Execution: { delayUntil: async fn => fn(), delayTicks: async () => {} },
        Inventory: { count: n => (n === 'Coins' ? s.gp : s.skirt), contains: () => s.skirt > 0, free: () => s.free },
        Equipment: {
            contains: () => s.worn,
            equip: async () => {
                s.events.push('equip');
                s.worn = true;
                s.skirt--;
                raw.appearance = [1525];
                return true;
            }
        },
        Bank: {
            isOpen: () => s.bank,
            loaded: () => s.bank,
            openNearestAccess: async () => {
                s.events.push('open bank');
                s.bank = true;
            },
            depositInventory: async () => {
                s.events.push('deposit');
                if (s.depositWorks) {
                    s.gp = 0;
                    s.skirt = 0;
                    s.free = 28;
                }
            },
            close: async () => {
                s.events.push('close bank');
                s.bank = false;
                return true;
            }
        },
        nearestBank: () => ({ name: 'Nearest', tile: { x: 3093, z: 3244, level: 0 } }),
        Npcs: { query: () => query },
        Skills: { effective: () => s.hp },
        ChatDialog: { canContinue: () => false },
        Shop: {
            isOpen: () => s.shop,
            close: async () => {
                s.shop = false;
            },
            open: async () => {
                s.shop = true;
                return true;
            },
            stock: () => [{ name: 'Pink skirt', count: 5 }],
            buy: async () => {
                s.events.push('buy');
                s.gp -= 2;
                s.skirt++;
                return 1;
            }
        },
        Traversal: {
            walkTo: async (t, opts) => {
                assert.equal(opts.useTeleportCatalog, false);
                s.move(t);
                return true;
            }
        },
        DirectNavigator: {
            walk: async t => {
                s.steps.push({ ...t });
                s.move(t);
                return true;
            }
        },
        Reachability: { walkable: () => true, canStep: (a, b) => mod.distance(a, b) === 1 },
        Tile: class {
            constructor(x, z, level) {
                Object.assign(this, { x, z, level });
            }
        }
    };
    Reflect.set(globalThis, '__rs2b0t', mocked);
    const fresh = await import(`data:text/javascript;base64,${Buffer.from(source + `\n// ${serial++}`).toString('base64')}`);
    s.bot = fresh.default.create();
    await s.bot.onStart();
    s.run = async n => {
        for (let i = 0; i < n; i++) {
            s.tick++;
            await s.bot.loop();
        }
    };
    return s;
}
test('startup banks everything before funding, buying, equipping and counting completed patterns', async () => {
    const s = await fixture();
    await s.run(200);
    assert.deepEqual(s.events.slice(0, 7), ['open bank', 'deposit', 'close bank', 'pick', 'pick', 'buy', 'equip']);
    assert.equal(s.bot.startupBanked, true);
    assert.ok(s.bot.patternsFormed >= 5);
    assert.equal(s.bot.citiesVisited.size, 1);
    assert.equal(s.events.filter(e => e === 'deposit').length, 1);
    const text = [];
    s.bot.onPaint({
        save() {},
        restore() {},
        fillRect() {},
        fillText(t) {
            text.push(t);
        }
    });
    assert.ok(text.some(t => /Running \d+:\d+:\d+.*cities visited 1.*patterns formed/.test(t)));
});
test('unsuccessful banking retries without pickpocketing or losing the startup stage', async () => {
    const s = await fixture();
    s.depositWorks = false;
    await s.run(8);
    assert.equal(s.bot.startupBanked, false);
    assert.equal(s.events.includes('pick'), false);
    s.depositWorks = true;
    await s.run(150);
    assert.equal(s.bot.startupBanked, true);
    assert.ok(s.bot.patternsFormed > 0);
});
