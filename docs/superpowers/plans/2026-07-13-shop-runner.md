# ShopRunner (world shop-run supply loop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `ShopRunner` TaskBot that cycles shop clusters buying feathers, runes, and arrows/arrowtips, banking between clusters with capped gp withdrawals, skipping shops until the engine's per-item restock makes a stop worth the walk.

**Architecture:** Three layers per the spec (`docs/superpowers/specs/2026-07-13-shop-runner-design.md`): (1) a **generated shop DB** (`tools/shops/gen-shopdb.ts` parses the content pack's `.inv`/`.npc`/`.obj` into committed `src/bot/shops/data/shopdb.ts`, with a `--check` drift gate); (2) **curated route data** (`src/bot/shops/data/route.ts` clusters + `NAV_TARGETS` stand entries validated by the offline nav-coverage gate); (3) a **pure StockModel + Planner** (client-free, unit-tested) driving a thin `ShopRunner` TaskBot that executes decisions with the existing `Shop`/`Bank`/`Traversal` primitives.

**Tech Stack:** TypeScript (bun), bun:test, playwright-core smoke vs the local engine, content pack at `~/code/rs2b2t-content`.

## Global Constraints

- Engine facts (verified): tick = 600 ms; restock = ±1 per item-slot `stockrate` ticks toward baseline; buy price per unit = `max(1, floor(max(100, sell − clamp((stock−baseline)·delta, −5000, 1000)) · cost / 1000))`, repriced per unit as stock falls; stock is world-shared.
- Pure modules (`types.ts`, `StockModel.ts`, `Planner.ts`, `tools/shops/parse.ts`) are client-free: no client imports, no `Date.now()` — callers pass `nowMs`.
- Op labels come off the live item, never hard-coded hyphen forms (the `'Withdraw-1'` default matches nothing; see `withdrawOneOp` pattern).
- Scripts stop via `ScriptRunner.stop()` (there is no `this.stop()`); task fields are `validate`/`execute`; tasks are added with `this.add(...)`.
- Settings are read with typed accessors (`this.settings.str/num/bool`); smoke overrides settings by writing raw strings to `localStorage['rs2b0t:set:ShopRunner:<key>']` before start.
- Every code task leaves `bunx tsc --noEmit`, `bunx eslint <touched files>`, and `bun test` clean before its commit (baseline: 319 tests green).
- Commit straight to `main`, conventional subjects (`feat(shops): ...`), and end every commit message with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Comments state constraints the code can't show — no narration.
- Settings defaults (spec): strategy `Buyout` (options `Buyout`/`Floor %`), floorPct `50`, haulThreshold `25`, maxGpPerLeg `100000`, stopFloorGp `5000`, membersWorld `true`, route `live` (options `live`/`smoke-varrock`).
- Content root for the generator: `process.env.CONTENT_DIR ?? ~/code/rs2b2t-content`. Never hand-edit `src/bot/shops/data/shopdb.ts` — regenerate.
- The smoke needs the local engine running (see `docs/DEV.md`); smokes default to `http://localhost:8888` like `tools/shop-test.ts`.

## File Structure

- `src/bot/shops/types.ts` — shared pure types (ShopRecord, Route, BuyPolicy, GateSpec, SeenMap, AccountView).
- `tools/shops/parse.ts` — pure content-pack parsers + join (unit-tested via fixtures).
- `tools/shops/gen-shopdb.ts` — CLI: scan content, emit `shopdb.ts`, `--check` drift mode.
- `src/bot/shops/data/shopdb.ts` — GENERATED, committed.
- `src/bot/shops/StockModel.ts` — pure: expected stock, price curve, policy units, buy cost.
- `src/bot/shops/Planner.ts` — pure: eligibility, cluster plans, budgets, `decide()`.
- `src/bot/shops/data/route.ts` — curated `ROUTE` + `SMOKE_ROUTE`.
- `src/bot/scripts/ShopRunner.ts` — the TaskBot (settings, tasks, persistence, overlay).
- `src/bot/scripts/index.ts` — register ShopRunner.
- `src/bot/nav/data/navTargets.ts` — 8 new stand entries (7 shop stands + Draynor bank).
- `tools/shoprun-test.ts` — local-engine smoke (auto-discovered by run-all-smokes).
- Tests: `test/tools/shops-parse.test.ts`, `test/shops/stockmodel.test.ts`, `test/shops/planner.test.ts`, `test/shops/route.test.ts`.

## Pinned content data (from `~/code/rs2b2t-content`, verified)

V1 clusters (obj ids exact; display names from `.obj` `name=`; spawns from `.jm2` maps; abs = msX·64+localX):

| Cluster | Shop inv | Keeper (display) | Keeper spawn | Buys (obj ids) | Bank (stand) | Gates |
|---|---|---|---|---|---|---|
| varrock | `runeshop` (sell 1000, delta 10) | Aubury | (3253,3402) | all 8 runes | Varrock East (3251,3420) — existing NAV_TARGET | none (F2P) |
| varrock | `archeryshop` (sell 1000, delta 10) | Lowe | (3232,3423) | bronze/iron/steel_arrow | same | none |
| portsarim | `magicshop` (sell 1000, delta 10) | Betty | (3012,3259) | all 8 runes | Draynor (3092,3243) — NEW | none (F2P) |
| portsarim | `fishingshop` (sell 1000, delta 10) | Gerrant | (3013,3225) | feather | same | none |
| catherby | `archeryshop2` (sell 1000, delta 10) | Hickton | (2822,3442) | bronze/iron_arrow + all 6 `*_arrowheads` | Catherby (2809,3441) — existing | members |
| fishingguild | `fishingguild` (sell 1000, delta 10) | Roachey | (2596,3400) | feather | Fishing Guild (2586,3420) — existing | members + fishing ≥ 68 |
| rangingguild | `ranging_guild_bowshop` (sell 1000, delta 10) | Bow and Arrow salesman | (2673,3434) | all 6 arrows + all 6 `*_arrowheads` | Seers (2725,3493) — existing | members + ranged ≥ 40 |

Stock baselines/rates (per stock line, `obj,baseline,rateTicks`): runeshop `firerune,2000,10 … chaosrune,1000,100 deathrune,1000,150`; magicshop runes all 1000 (chaos 100, death 150 rates); fishingshop `feather,1000,1`; fishingguild `feather,1500,1`; archeryshop `bronze_arrow,2000,10 iron_arrow,1500,15 steel_arrow,1000,20`; archeryshop2 `bronze_arrow,1000,10 iron_arrow,800,20 bronze_arrowheads,1000,10 iron_arrowheads,800,20 steel_arrowheads,600,40 mithril_arrowheads,400,40 adamant_arrowheads,200,40 rune_arrowheads,100,40` (steel/mith/adamant/rune_arrow baseline 0 — never planned); ranging_guild_bowshop `bronze_arrow,1000,10 iron_arrow,500,20 steel_arrow,500,40 mithril_arrow,500,60 adamant_arrow,450,120 rune_arrow,400,130 bronze_arrowheads,500,10 iron_arrowheads,400,20 steel_arrowheads,300,30 mithril_arrowheads,200,40 adamant_arrowheads,200,50 rune_arrowheads,150,60`.

Obj costs: feather 2, fire/water/air/earth 4, mind/body 3, chaos 15, death 30, bronze/iron/steel_arrow 1/3/12, mithril/adamant/rune_arrow 32/80/400, arrowheads bronze→rune 1/2/6/16/40/200. All stackable. Arrowtip display names are `Bronze arrowtips` etc. (obj id `*_arrowheads`).

Deferred clusters (data ships in shopdb; add to route later): Magic Guild Yanille (upstairs level-1 + magic 66 — needs stairs handling), Shilo (no standard bank booth + Shilo Village quest), Mage Arena (deep wilderness), Ardougne/Gnome general stores (baselines ≤ 30).

Shop-side interaction stands (adjacent to spawns, subject to the coverage gate's `nearest connected` correction in Task 6): aubury (3253,3401), lowe (3232,3422), betty (3012,3258), gerrant (3013,3224), hickton (2821,3442), roachey (2596,3399), dargaud (2672,3434).

---

### Task 1: Shared types + pure content-pack parsers (TDD)

**Files:**
- Create: `src/bot/shops/types.ts`
- Create: `tools/shops/parse.ts`
- Test: `test/tools/shops-parse.test.ts`

**Interfaces:**
- Consumes: nothing (types.ts is import-free; `NavPointLike` is structurally compatible with the nav layer's `NavPoint`).
- Produces (every later task consumes these):
  - types.ts: `NavPointLike { x; z; level }`, `ShopItemDef { obj; name; baseline; restockTicks; cost; stackable; members }`, `ShopRecord { inv; title; keepers: string[]; sell; buy; delta; scope; allstock; items: ShopItemDef[] }`, `BuyPolicy = { kind: 'buyout' } | { kind: 'floor'; pct: number }`, `GateSpec { quest?; skill?: { name; level }; qp?; members? }`, `RouteShop { shopId; keeperNpc; stand: NavPointLike; buys: { obj: string; policy?: BuyPolicy }[] }`, `RouteCluster { id; bank: { stand: NavPointLike; boothName: string; boothOp: string }; shops: RouteShop[]; gates: GateSpec[] }`, `Route { clusters: RouteCluster[]; ring: string[] }`, `Seen { count: number; atMs: number }`, `SeenMap = Record<string, Record<string, Seen>>`, `AccountView { members: boolean; qp: number; quests: Record<string, boolean>; skills: Record<string, number> }`
  - parse.ts: `parseInvShops(text: string): { inv: string; scope: string; allstock: boolean; stock: { obj: string; baseline: number; restockTicks: number }[] }[]`, `parseNpcKeepers(text: string): { npc: string; name: string; ownedShops: string[]; sell: number; buy: number; delta: number; title: string }[]`, `parseObjDefs(text: string): Record<string, { name: string; cost: number; stackable: boolean; members: boolean }>`, `joinShopDb(invs, keepers, objs): Record<string, ShopRecord>`

- [ ] **Step 1: Write types.ts** (no test — types only)

```ts
/** Structural tile — keeps pure shop modules free of nav/client imports.
 *  The nav layer's NavPoint satisfies it. */
export interface NavPointLike { x: number; z: number; level: number }

/** One stocked item of a shop, from the content pack (authoritative). */
export interface ShopItemDef {
    obj: string;           // content obj id, e.g. 'deathrune'
    name: string;          // display name, e.g. 'Death rune' — what Shop.buy() takes
    baseline: number;      // stock converges here (±1 per restockTicks)
    restockTicks: number;  // engine ticks (600ms) per unit toward baseline
    cost: number;          // obj cost= — base value the price curve scales
    stackable: boolean;
    members: boolean;
}

export interface ShopRecord {
    inv: string;           // content inv id, e.g. 'runeshop'
    title: string;         // shop_title param (may be '')
    keepers: string[];     // display names; any of them opens this shop
    sell: number;          // shop_sell_multiplier, 1000 = 100% (price player pays)
    buy: number;           // shop_buy_multiplier (price player gets)
    delta: number;         // shop_delta per unit of stock deviation
    scope: string;         // 'shared' expected for world shops
    allstock: boolean;     // general store: accepts arbitrary player items
    items: ShopItemDef[];
}

export type BuyPolicy = { kind: 'buyout' } | { kind: 'floor'; pct: number };

export interface GateSpec {
    quest?: string;                            // journal name, needs 'complete'
    skill?: { name: string; level: number };   // base level requirement
    qp?: number;                               // minimum quest points
    members?: boolean;                         // needs a members world
}

export interface RouteShop {
    shopId: string;     // ShopRecord.inv
    keeperNpc: string;  // display name for Shop.open()
    stand: NavPointLike;
    /** Priority order — budget is allocated greedily in this order. */
    buys: { obj: string; policy?: BuyPolicy }[];
}

export interface RouteCluster {
    id: string;
    bank: { stand: NavPointLike; boothName: string; boothOp: string };
    shops: RouteShop[];
    gates: GateSpec[];  // ALL must pass
}

export interface Route {
    clusters: RouteCluster[];
    ring: string[];     // cluster ids in fixed cycle order
}

/** Last observed stock of one item at one shop (persisted per account). */
export interface Seen { count: number; atMs: number }
export type SeenMap = Record<string, Record<string, Seen>>;

/** Pure snapshot of the account, built by the runner from live APIs. */
export interface AccountView {
    members: boolean;
    qp: number;
    quests: Record<string, boolean>;    // journal name -> complete
    skills: Record<string, number>;     // lowercase skill -> base level
}
```

- [ ] **Step 2: Write the failing parser tests**

Create `test/tools/shops-parse.test.ts` with fixtures cut from real content:

```ts
import { describe, expect, test } from 'bun:test';
import { joinShopDb, parseInvShops, parseNpcKeepers, parseObjDefs } from '../../tools/shops/parse.js';

const INV_FIXTURE = `
[runeshop]
scope=shared
size=40
restock=yes
stackall=yes
allstock=no
stock1=firerune,2000,10
stock2=mindrune,1000,10
stock7=chaosrune,1000,100
stock8=deathrune,1000,150

[skill_guide]
size=10
stock1=firerune,1

[adventurershop]
scope=shared
size=40
restock=yes
stackall=yes
allstock=yes
stock7=bronze_arrow,500,10
`;

const NPC_FIXTURE = `
[aubury]
name=Aubury
vislevel=hide
category=shop_keeper
op3=Trade
param=owned_shop,runeshop
param=shop_sell_multiplier,1000
param=shop_buy_multiplier,550
param=shop_delta,10
param=shop_title,Aubury's Rune Shop.

[aemad]
name=Aemad
category=shop_keeper
param=owned_shop,adventurershop
param=shop_sell_multiplier,1300
param=shop_buy_multiplier,400
param=shop_delta,20
param=shop_title,Aemad's Adventuring Supplies.

[kortan]
name=Kortan
category=shop_keeper
param=owned_shop,adventurershop
param=shop_sell_multiplier,1300
param=shop_buy_multiplier,400
param=shop_delta,20
param=shop_title,Aemad's Adventuring Supplies.

[guard]
name=Guard
op1=Attack
`;

const OBJ_FIXTURE = `
[deathrune]
cost=30
name=Death rune
stackable=yes
category=category_1289

[bronze_arrowheads]
name=Bronze arrowtips
members=yes
cost=1
stackable=yes

[bronze_pickaxe]
name=Bronze pickaxe
cost=1
`;

describe('parseInvShops', () => {
    test('parses 3-field stock lines with flags; skips 2-field non-shop invs', () => {
        const shops = parseInvShops(INV_FIXTURE);
        expect(shops.map(s => s.inv)).toEqual(['runeshop', 'adventurershop']);
        const rune = shops[0];
        expect(rune.scope).toBe('shared');
        expect(rune.allstock).toBe(false);
        expect(rune.stock).toEqual([
            { obj: 'firerune', baseline: 2000, restockTicks: 10 },
            { obj: 'mindrune', baseline: 1000, restockTicks: 10 },
            { obj: 'chaosrune', baseline: 1000, restockTicks: 100 },
            { obj: 'deathrune', baseline: 1000, restockTicks: 150 }
        ]);
        expect(shops[1].allstock).toBe(true);
    });
});

describe('parseNpcKeepers', () => {
    test('extracts owned_shop npcs with params and title; skips non-keepers', () => {
        const keepers = parseNpcKeepers(NPC_FIXTURE);
        expect(keepers.map(k => k.npc)).toEqual(['aubury', 'aemad', 'kortan']);
        expect(keepers[0]).toEqual({
            npc: 'aubury', name: 'Aubury', ownedShops: ['runeshop'],
            sell: 1000, buy: 550, delta: 10, title: "Aubury's Rune Shop."
        });
    });
});

describe('parseObjDefs', () => {
    test('reads name/cost/stackable/members in any field order', () => {
        const objs = parseObjDefs(OBJ_FIXTURE);
        expect(objs['deathrune']).toEqual({ name: 'Death rune', cost: 30, stackable: true, members: false });
        expect(objs['bronze_arrowheads']).toEqual({ name: 'Bronze arrowtips', cost: 1, stackable: true, members: true });
        expect(objs['bronze_pickaxe'].stackable).toBe(false);
    });
});

describe('joinShopDb', () => {
    test('joins invs to keepers (shared inv gets both) and objs to items', () => {
        const db = joinShopDb(parseInvShops(INV_FIXTURE), parseNpcKeepers(NPC_FIXTURE), parseObjDefs(OBJ_FIXTURE));
        expect(db['runeshop'].keepers).toEqual(['Aubury']);
        expect(db['runeshop'].sell).toBe(1000);
        expect(db['runeshop'].delta).toBe(10);
        const death = db['runeshop'].items.find(i => i.obj === 'deathrune');
        expect(death).toEqual({ obj: 'deathrune', name: 'Death rune', baseline: 1000, restockTicks: 150, cost: 30, stackable: true, members: false });
        expect(db['adventurershop'].keepers).toEqual(['Aemad', 'Kortan']);
        // unknown obj (firerune/mindrune/chaosrune not in OBJ_FIXTURE) falls back to id-as-name, cost 1
        const fire = db['runeshop'].items.find(i => i.obj === 'firerune');
        expect(fire?.name).toBe('firerune');
        expect(fire?.cost).toBe(1);
    });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test test/tools/shops-parse.test.ts`
Expected: FAIL — cannot resolve `tools/shops/parse.js`.

- [ ] **Step 4: Implement `tools/shops/parse.ts`**

```ts
/**
 * Pure parsers for the 2004scape content pack's shop data. Line formats
 * (verified against rs2b2t-content):
 *   .inv : [name] + scope=/restock=/allstock= + stockN=<obj>,<baseline>,<rateTicks>
 *          (2-field stockN lines are crafting menus, not shops — excluded)
 *   .npc : [id] + name= + param=owned_shop,<inv> + param=shop_*_multiplier/delta/title
 *   .obj : [id] + name= + cost= + stackable=yes + members=yes (any field order)
 * Client-free and IO-free: callers feed file text in.
 */
import type { ShopRecord } from '#/bot/shops/types.js';

export interface ParsedInv {
    inv: string;
    scope: string;
    allstock: boolean;
    stock: { obj: string; baseline: number; restockTicks: number }[];
}

export interface ParsedKeeper {
    npc: string;
    name: string;
    ownedShops: string[];
    sell: number;
    buy: number;
    delta: number;
    title: string;
}

export interface ParsedObj { name: string; cost: number; stackable: boolean; members: boolean }

interface Block { id: string; lines: string[] }

function blocks(text: string): Block[] {
    const out: Block[] = [];
    let cur: Block | null = null;
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        const head = /^\[([a-z0-9_]+)\]$/.exec(line);
        if (head) {
            cur = { id: head[1], lines: [] };
            out.push(cur);
        } else if (cur && line.length > 0 && !line.startsWith('//')) {
            cur.lines.push(line);
        }
    }
    return out;
}

function field(lines: string[], key: string): string | undefined {
    const prefix = `${key}=`;
    const hit = lines.find(l => l.startsWith(prefix));
    return hit?.slice(prefix.length);
}

export function parseInvShops(text: string): ParsedInv[] {
    const out: ParsedInv[] = [];
    for (const b of blocks(text)) {
        const stock: ParsedInv['stock'] = [];
        for (const line of b.lines) {
            const m = /^stock\d+=([a-z0-9_]+),(\d+),(\d+)$/.exec(line);
            if (m) {
                stock.push({ obj: m[1], baseline: Number(m[2]), restockTicks: Number(m[3]) });
            }
        }
        if (stock.length > 0) {
            out.push({ inv: b.id, scope: field(b.lines, 'scope') ?? '', allstock: field(b.lines, 'allstock') === 'yes', stock });
        }
    }
    return out;
}

export function parseNpcKeepers(text: string): ParsedKeeper[] {
    const out: ParsedKeeper[] = [];
    for (const b of blocks(text)) {
        const owned = b.lines
            .map(l => /^param=owned_shop,([a-z0-9_]+)$/.exec(l)?.[1])
            .filter((s): s is string => s !== undefined);
        if (owned.length === 0) {
            continue;
        }
        const num = (key: string, fallback: number): number => {
            const m = b.lines.find(l => l.startsWith(`param=${key},`));
            return m ? Number(m.slice(`param=${key},`.length)) : fallback;
        };
        const title = b.lines.find(l => l.startsWith('param=shop_title,'))?.slice('param=shop_title,'.length) ?? '';
        out.push({
            npc: b.id,
            name: field(b.lines, 'name') ?? b.id,
            ownedShops: owned,
            // shopkeeper.param defaults: sell 100, buy 60, delta 10 (real shops override to the 1000 scale)
            sell: num('shop_sell_multiplier', 100),
            buy: num('shop_buy_multiplier', 60),
            delta: num('shop_delta', 10),
            title
        });
    }
    return out;
}

export function parseObjDefs(text: string): Record<string, ParsedObj> {
    const out: Record<string, ParsedObj> = {};
    for (const b of blocks(text)) {
        out[b.id] = {
            name: field(b.lines, 'name') ?? b.id,
            cost: Number(field(b.lines, 'cost') ?? '1'),
            stackable: field(b.lines, 'stackable') === 'yes',
            members: field(b.lines, 'members') === 'yes'
        };
    }
    return out;
}

export function joinShopDb(
    invs: ParsedInv[],
    keepers: ParsedKeeper[],
    objs: Record<string, ParsedObj>
): Record<string, ShopRecord> {
    const db: Record<string, ShopRecord> = {};
    for (const inv of invs) {
        const owners = keepers.filter(k => k.ownedShops.includes(inv.inv));
        if (owners.length === 0) {
            continue; // stocked inv with no shopkeeper is not a reachable shop
        }
        const first = owners[0];
        db[inv.inv] = {
            inv: inv.inv,
            title: first.title,
            keepers: owners.map(o => o.name),
            sell: first.sell,
            buy: first.buy,
            delta: first.delta,
            scope: inv.scope,
            allstock: inv.allstock,
            items: inv.stock.map(s => {
                const o = objs[s.obj] ?? { name: s.obj, cost: 1, stackable: false, members: false };
                return { obj: s.obj, name: o.name, baseline: s.baseline, restockTicks: s.restockTicks, cost: o.cost, stackable: o.stackable, members: o.members };
            })
        };
    }
    return db;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test test/tools/shops-parse.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Gate and commit**

Run: `bunx tsc --noEmit && bunx eslint src/bot/shops/types.ts tools/shops/parse.ts test/tools/shops-parse.test.ts && bun test`
Expected: all clean.

```bash
git add src/bot/shops/types.ts tools/shops/parse.ts test/tools/shops-parse.test.ts
git commit -m "feat(shops): shared shop types + pure content-pack parsers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: gen-shopdb CLI + generated, committed shop DB

**Files:**
- Create: `tools/shops/gen-shopdb.ts`
- Create: `src/bot/shops/data/shopdb.ts` (generated output, committed)
- Modify: `package.json` (add `gen:shopdb` script)

**Interfaces:**
- Consumes: `parseInvShops/parseNpcKeepers/parseObjDefs/joinShopDb` from Task 1.
- Produces: `SHOP_DB: Record<string, ShopRecord>` exported from `#/bot/shops/data/shopdb.js`; CLI `bun tools/shops/gen-shopdb.ts [--check]` (exit 1 on drift in `--check`).

- [ ] **Step 1: Implement the CLI**

Create `tools/shops/gen-shopdb.ts`:

```ts
/**
 * Regenerates src/bot/shops/data/shopdb.ts from the content pack.
 *   bun tools/shops/gen-shopdb.ts            # rewrite the file
 *   bun tools/shops/gen-shopdb.ts --check    # exit 1 if the committed file is stale
 * Content root: $CONTENT_DIR or ~/code/rs2b2t-content.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { joinShopDb, parseInvShops, parseNpcKeepers, parseObjDefs, type ParsedInv, type ParsedKeeper, type ParsedObj } from './parse.js';

const CONTENT = process.env.CONTENT_DIR ?? join(homedir(), 'code', 'rs2b2t-engine', '..', 'rs2b2t-content');
const OUT = 'src/bot/shops/data/shopdb.ts';

function filesUnder(root: string, ext: string): string[] {
    return (readdirSync(root, { recursive: true }) as string[])
        .filter(f => f.endsWith(ext))
        .map(f => join(root, f))
        .sort();
}

function generate(): string {
    const scripts = join(CONTENT, 'scripts');
    const invs: ParsedInv[] = filesUnder(scripts, '.inv').flatMap(f => parseInvShops(readFileSync(f, 'utf8')));
    const keepers: ParsedKeeper[] = filesUnder(scripts, '.npc').flatMap(f => parseNpcKeepers(readFileSync(f, 'utf8')));
    const objs: Record<string, ParsedObj> = {};
    for (const f of filesUnder(scripts, '.obj')) {
        Object.assign(objs, parseObjDefs(readFileSync(f, 'utf8')));
    }
    const db = joinShopDb(invs, keepers, objs);
    const ordered = Object.keys(db).sort().map(k => `    ${JSON.stringify(k)}: ${JSON.stringify(db[k])}`);
    console.log(`shops=${ordered.length} invsWithStock=${invs.length} keepers=${keepers.length}`);
    return [
        '/* eslint-disable */',
        '// GENERATED by tools/shops/gen-shopdb.ts — do not edit.',
        '// Regenerate: bun tools/shops/gen-shopdb.ts   (drift gate: --check)',
        "import type { ShopRecord } from '#/bot/shops/types.js';",
        '',
        'export const SHOP_DB: Record<string, ShopRecord> = {',
        ordered.join(',\n'),
        '};',
        ''
    ].join('\n');
}

const fresh = generate();
if (process.argv.includes('--check')) {
    let current = '';
    try {
        current = readFileSync(OUT, 'utf8');
    } catch {
        // missing file = drift
    }
    if (current !== fresh) {
        console.error(`STALE: ${OUT} does not match the content pack — run: bun tools/shops/gen-shopdb.ts`);
        process.exit(1);
    }
    console.log(`ok: ${OUT} matches the content pack`);
} else {
    writeFileSync(OUT, fresh);
    console.log(`wrote ${OUT}`);
}
```

- [ ] **Step 2: Add the package script**

In `package.json` scripts block, after `"smoke"`:

```json
"gen:shopdb": "bun tools/shops/gen-shopdb.ts"
```

- [ ] **Step 3: Generate and eyeball**

Run: `bun tools/shops/gen-shopdb.ts`
Expected: `shops=<n> ...` then `wrote src/bot/shops/data/shopdb.ts`, with n ≈ 100–110 (the content survey found 106 owned shop invs).

Run: `grep -c 'deathrune' src/bot/shops/data/shopdb.ts` → ≥ 4 (runeshop, magicshop, magicguildshop, magearena_runeshop).
Run: `grep -c '"runeshop"' src/bot/shops/data/shopdb.ts` → ≥ 1, and open the file to spot-check the runeshop record shows `"sell":1000` / `"buy":550` / `"delta":10` (Aubury).

- [ ] **Step 4: Verify the drift gate both ways**

Run: `bun tools/shops/gen-shopdb.ts --check`
Expected: `ok: ...`, exit 0.
Run: `echo '// tamper' >> src/bot/shops/data/shopdb.ts && bun tools/shops/gen-shopdb.ts --check; echo "exit=$?"`
Expected: `STALE: ...`, `exit=1`.
Run: `bun tools/shops/gen-shopdb.ts` (restore).

- [ ] **Step 5: Gate and commit**

Run: `bunx tsc --noEmit && bunx eslint tools/shops/gen-shopdb.ts && bun test`
Expected: clean (generated file must typecheck as `ShopRecord`s).

```bash
git add tools/shops/gen-shopdb.ts src/bot/shops/data/shopdb.ts package.json
git commit -m "feat(shops): shopdb generator + committed generated DB with --check drift gate

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: StockModel — restock prediction + engine price curve (TDD)

**Files:**
- Create: `src/bot/shops/StockModel.ts`
- Test: `test/shops/stockmodel.test.ts`

**Interfaces:**
- Consumes: `ShopItemDef`, `BuyPolicy`, `Seen` from types.ts.
- Produces (Planner and ShopRunner consume):
  - `TICK_MS = 600`
  - `expectedStock(item: ShopItemDef, seen: Seen | undefined, nowMs: number): number`
  - `unitPrice(item: ShopItemDef, shop: { sell: number; delta: number }, stock: number): number`
  - `buyCost(item: ShopItemDef, shop: { sell: number; delta: number }, fromStock: number, units: number): number`
  - `unitsUnderPolicy(policy: BuyPolicy, stock: number, baseline: number): number`

- [ ] **Step 1: Write the failing tests**

Create `test/shops/stockmodel.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import type { ShopItemDef } from '#/bot/shops/types.js';
import { TICK_MS, buyCost, expectedStock, unitPrice, unitsUnderPolicy } from '#/bot/shops/StockModel.js';

const death: ShopItemDef = { obj: 'deathrune', name: 'Death rune', baseline: 1000, restockTicks: 150, cost: 30, stackable: true, members: false };
const fire: ShopItemDef = { obj: 'firerune', name: 'Fire rune', baseline: 2000, restockTicks: 10, cost: 4, stackable: true, members: false };
const SHOP = { sell: 1000, delta: 10 };

describe('expectedStock', () => {
    test('never seen → assume baseline (first lap visits everything)', () => {
        expect(expectedStock(death, undefined, 0)).toBe(1000);
    });
    test('restocks +1 per restockTicks ticks, capped at baseline', () => {
        const seen = { count: 0, atMs: 0 };
        expect(expectedStock(death, seen, 150 * TICK_MS)).toBe(1);
        expect(expectedStock(death, seen, 149 * TICK_MS)).toBe(0);
        expect(expectedStock(death, seen, 10 * 150 * TICK_MS)).toBe(10);
        expect(expectedStock(death, seen, 100_000 * 150 * TICK_MS)).toBe(1000); // cap
    });
    test('overstock decays toward baseline at the same rate', () => {
        const seen = { count: 1010, atMs: 0 };
        expect(expectedStock(death, seen, 150 * TICK_MS * 3)).toBe(1007);
        expect(expectedStock(death, seen, 150 * TICK_MS * 100)).toBe(1000); // floor at baseline
    });
});

describe('unitPrice (engine formula)', () => {
    test('at baseline pays 100%: fire rune = 4gp, death rune = 30gp', () => {
        expect(unitPrice(fire, SHOP, 2000)).toBe(4);
        expect(unitPrice(death, SHOP, 1000)).toBe(30);
    });
    test('price rises ~1%/unit below baseline: death at −100 → 2× = 60gp', () => {
        expect(unitPrice(death, SHOP, 900)).toBe(60);
    });
    test('caps at 6× from −500 down (clamp −5000)', () => {
        expect(unitPrice(death, SHOP, 500)).toBe(180);
        expect(unitPrice(death, SHOP, 1)).toBe(180);
    });
    test('overstock floors at 10% (pct min 100), price min 1gp', () => {
        expect(unitPrice(death, SHOP, 100_000)).toBe(3);   // 10% of 30
        expect(unitPrice(fire, SHOP, 100_000)).toBe(1);    // floor(0.4) → min 1
    });
});

describe('buyCost', () => {
    test('sums per-unit repricing as stock falls', () => {
        // death from stock 1000: units at 1000, 999, 998 → 30 + 30 (pct 1010→30.3 floor 30) + 30
        expect(buyCost(death, SHOP, 1000, 3)).toBe(90);
        // fire whole-stack sanity: monotic, bounded by units × 6×cost
        const full = buyCost(fire, SHOP, 2000, 2000);
        expect(full).toBeGreaterThan(2000 * 4);
        expect(full).toBeLessThanOrEqual(2000 * 24);
    });
    test('more units from lower stock costs more per unit', () => {
        expect(buyCost(death, SHOP, 600, 100)).toBeGreaterThan(buyCost(death, SHOP, 1000, 100));
    });
});

describe('unitsUnderPolicy', () => {
    test('buyout takes everything', () => {
        expect(unitsUnderPolicy({ kind: 'buyout' }, 700, 1000)).toBe(700);
    });
    test('floor 50% buys down to ceil(50% of baseline)', () => {
        expect(unitsUnderPolicy({ kind: 'floor', pct: 50 }, 1000, 1000)).toBe(500);
        expect(unitsUnderPolicy({ kind: 'floor', pct: 50 }, 400, 1000)).toBe(0);   // already below floor
        expect(unitsUnderPolicy({ kind: 'floor', pct: 33 }, 1000, 1000)).toBe(670); // floorCount=ceil(330)=330
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/shops/stockmodel.test.ts`
Expected: FAIL — cannot resolve `#/bot/shops/StockModel.js`.

- [ ] **Step 3: Implement `src/bot/shops/StockModel.ts`**

```ts
/**
 * Pure stock/pricing math mirroring the engine exactly (client-free):
 *  - restock: ±1 per item-slot restockTicks toward baseline (World.ts processCleanup)
 *  - buy price: max(1, floor(max(100, sell − clamp((stock−baseline)·delta, −5000, 1000)) · cost / 1000)),
 *    repriced per unit as stock falls (shop/scripts/shop.rs2 calc_shop_value)
 * Predictions are optimistic upper bounds — stock is world-shared and other
 * players buy too; the runner corrects with observed stock on arrival.
 */
import type { BuyPolicy, Seen, ShopItemDef } from '#/bot/shops/types.js';

export const TICK_MS = 600;

export function expectedStock(item: ShopItemDef, seen: Seen | undefined, nowMs: number): number {
    if (!seen) {
        return item.baseline;
    }
    const steps = Math.floor((nowMs - seen.atMs) / TICK_MS / item.restockTicks);
    if (seen.count < item.baseline) {
        return Math.min(item.baseline, seen.count + steps);
    }
    return Math.max(item.baseline, seen.count - steps);
}

export function unitPrice(item: ShopItemDef, shop: { sell: number; delta: number }, stock: number): number {
    const d = stock - item.baseline;
    const haggle = Math.min(1000, Math.max(-5000, d * shop.delta));
    const pct = Math.max(100, shop.sell - haggle);
    return Math.max(1, Math.floor((pct * item.cost) / 1000));
}

export function buyCost(item: ShopItemDef, shop: { sell: number; delta: number }, fromStock: number, units: number): number {
    let total = 0;
    for (let i = 0; i < units; i++) {
        total += unitPrice(item, shop, fromStock - i);
    }
    return total;
}

export function unitsUnderPolicy(policy: BuyPolicy, stock: number, baseline: number): number {
    if (policy.kind === 'buyout') {
        return Math.max(0, stock);
    }
    const floorCount = Math.ceil((policy.pct / 100) * baseline);
    return Math.max(0, stock - floorCount);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/shops/stockmodel.test.ts`
Expected: PASS. (If the `buyCost 3-unit = 90` case fails by a hair, the per-unit floor differs — re-derive from the quoted formula, do NOT fudge the test: unit at stock 999 is `floor(1010·30/1000)=30`.)

- [ ] **Step 5: Gate and commit**

Run: `bunx tsc --noEmit && bunx eslint src/bot/shops/StockModel.ts test/shops/stockmodel.test.ts && bun test`

```bash
git add src/bot/shops/StockModel.ts test/shops/stockmodel.test.ts
git commit -m "feat(shops): pure StockModel — restock prediction + engine price curve

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Planner part A — eligibility + cluster plans + budgets (TDD)

**Files:**
- Create: `src/bot/shops/Planner.ts`
- Test: `test/shops/planner.test.ts`

**Interfaces:**
- Consumes: types.ts, StockModel (Task 3 signatures).
- Produces (decide() in Task 5 and ShopRunner consume):
  - `interface PlannerCfg { defaultPolicy: BuyPolicy; haulThresholdPct: number; maxGpPerLeg: number }`
  - `BUDGET_BUFFER = 1.25`
  - `interface BuyPlanItem { obj: string; name: string; units: number; estCost: number }`
  - `interface ShopPlan { shopId: string; keeperNpc: string; stand: NavPoint; items: BuyPlanItem[] }`
  - `interface ClusterPlan { clusterId: string; shops: ShopPlan[]; totalUnits: number; maxUnits: number; haulFraction: number; estCost: number; budget: number }`
  - `clusterEligible(cluster: RouteCluster, acct: AccountView): boolean`
  - `cheapestUnmetGate(route: Route, acct: AccountView): string` (human text for the stop message)
  - `planCluster(cluster: RouteCluster, db: Record<string, ShopRecord>, seen: SeenMap, nowMs: number, cfg: PlannerCfg, cooldowns: Record<string, number>): ClusterPlan`

- [ ] **Step 1: Write the failing tests**

Create `test/shops/planner.test.ts` (route fixtures kept tiny and local — NOT the real route):

```ts
import { describe, expect, test } from 'bun:test';
import { clusterEligible, planCluster, type PlannerCfg } from '#/bot/shops/Planner.js';
import type { AccountView, RouteCluster, SeenMap, ShopRecord } from '#/bot/shops/types.js';

const DB: Record<string, ShopRecord> = {
    runeshop: {
        inv: 'runeshop', title: 'T', keepers: ['Aubury'], sell: 1000, buy: 550, delta: 10, scope: 'shared', allstock: false,
        items: [
            { obj: 'mindrune', name: 'Mind rune', baseline: 1000, restockTicks: 10, cost: 3, stackable: true, members: false },
            { obj: 'deathrune', name: 'Death rune', baseline: 1000, restockTicks: 150, cost: 30, stackable: true, members: false }
        ]
    }
};

const CLUSTER: RouteCluster = {
    id: 'varrock',
    bank: { stand: { x: 3251, z: 3420, level: 0 }, boothName: 'Bank booth', boothOp: 'Use-quickly' },
    shops: [{
        shopId: 'runeshop', keeperNpc: 'Aubury', stand: { x: 3253, z: 3401, level: 0 },
        buys: [{ obj: 'mindrune' }, { obj: 'deathrune' }]
    }],
    gates: []
};

const CFG: PlannerCfg = { defaultPolicy: { kind: 'buyout' }, haulThresholdPct: 25, maxGpPerLeg: 100_000 };
const acct = (over: Partial<AccountView> = {}): AccountView => ({ members: true, qp: 0, quests: {}, skills: {}, ...over });

describe('clusterEligible', () => {
    const gated: RouteCluster = { ...CLUSTER, gates: [{ members: true }, { skill: { name: 'fishing', level: 68 } }, { quest: 'Shilo Village' }, { qp: 32 }] };
    test('all gates must pass', () => {
        expect(clusterEligible(gated, acct({ skills: { fishing: 68 }, quests: { 'Shilo Village': true }, qp: 32 }))).toBe(true);
    });
    test('any failing gate blocks: f2p world / low skill / missing quest / low qp', () => {
        expect(clusterEligible(gated, acct({ members: false, skills: { fishing: 68 }, quests: { 'Shilo Village': true }, qp: 32 }))).toBe(false);
        expect(clusterEligible(gated, acct({ skills: { fishing: 67 }, quests: { 'Shilo Village': true }, qp: 32 }))).toBe(false);
        expect(clusterEligible(gated, acct({ skills: { fishing: 68 }, qp: 32 }))).toBe(false);
        expect(clusterEligible(gated, acct({ skills: { fishing: 68 }, quests: { 'Shilo Village': true }, qp: 31 }))).toBe(false);
    });
    test('ungated cluster is always eligible', () => {
        expect(clusterEligible(CLUSTER, acct({ members: false }))).toBe(true);
    });
});

describe('planCluster', () => {
    // NOTE: a full death-rune buyout costs ~142k (price cap 6×30gp), so the
    // default 100k cap (spend cap 80k) ALWAYS trims death runes in these
    // fixtures. Use UNCAPPED where a test isolates policy math.
    const UNCAPPED: PlannerCfg = { ...CFG, maxGpPerLeg: 1_000_000 };

    test('unseen shop plans full baseline haul at fraction 1 (uncapped)', () => {
        const plan = planCluster(CLUSTER, DB, {}, 0, UNCAPPED, {});
        expect(plan.haulFraction).toBe(1);
        expect(plan.totalUnits).toBe(2000);
        const mind = plan.shops[0].items.find(i => i.obj === 'mindrune');
        expect(mind?.units).toBe(1000);
        expect(mind?.name).toBe('Mind rune');
        expect(plan.estCost).toBeGreaterThan(0);
        expect(plan.budget).toBeLessThanOrEqual(UNCAPPED.maxGpPerLeg);
    });
    test('default 100k cap trims the expensive tail (death runes) but not cheap items', () => {
        const plan = planCluster(CLUSTER, DB, {}, 0, CFG, {});
        const mind = plan.shops[0].items.find(i => i.obj === 'mindrune');
        const death = plan.shops[0].items.find(i => i.obj === 'deathrune');
        expect(mind?.units).toBe(1000);                    // ~10.6k — fits
        expect(death!.units).toBeGreaterThan(0);
        expect(death!.units).toBeLessThan(1000);           // trimmed by the cap
        expect(plan.estCost).toBeLessThanOrEqual(CFG.maxGpPerLeg / 1.25);
        expect(plan.budget).toBe(CFG.maxGpPerLeg);
        expect(plan.haulFraction).toBe(1);                 // fraction is PRE-trim
    });
    test('freshly bought-out shop has fraction 0 (skipped)', () => {
        const seen: SeenMap = { runeshop: { mindrune: { count: 0, atMs: 0 }, deathrune: { count: 0, atMs: 0 } } };
        const plan = planCluster(CLUSTER, DB, seen, 0, CFG, {});
        expect(plan.totalUnits).toBe(0);
        expect(plan.haulFraction).toBe(0);
    });
    test('floor policy per-item override wins over cfg default (uncapped)', () => {
        const cluster: RouteCluster = { ...CLUSTER, shops: [{ ...CLUSTER.shops[0], buys: [{ obj: 'mindrune', policy: { kind: 'floor', pct: 50 } }, { obj: 'deathrune' }] }] };
        const plan = planCluster(cluster, DB, {}, 0, UNCAPPED, {});
        expect(plan.shops[0].items.find(i => i.obj === 'mindrune')?.units).toBe(500);
        expect(plan.shops[0].items.find(i => i.obj === 'deathrune')?.units).toBe(1000);
    });
    test('budget = round1k(estCost × 1.25) capped at maxGpPerLeg; cap trims later buys first', () => {
        const small: PlannerCfg = { ...CFG, maxGpPerLeg: 5000 };
        const plan = planCluster(CLUSTER, DB, {}, 0, small, {});
        expect(plan.budget).toBe(5000);
        // greedy in buys[] order: mindrune (3gp base) fills first, deathrune gets the remainder
        const mind = plan.shops[0].items.find(i => i.obj === 'mindrune');
        const death = plan.shops[0].items.find(i => i.obj === 'deathrune');
        expect(mind!.units).toBeGreaterThan(0);
        expect(death!.units).toBeLessThan(1000);
        expect(plan.estCost).toBeLessThanOrEqual(5000 / 1.25);
        // haulFraction reflects PRE-trim availability (visit-worthiness), not the trim
        expect(plan.haulFraction).toBe(1);
    });
    test('budget rounds up to the next 1k', () => {
        // restrict to mindrune only, floor 99 → 10 units ≈ 30gp → budget 1000
        const cluster: RouteCluster = { ...CLUSTER, shops: [{ ...CLUSTER.shops[0], buys: [{ obj: 'mindrune', policy: { kind: 'floor', pct: 99 } }] }] };
        const plan = planCluster(cluster, DB, {}, 0, CFG, {});
        expect(plan.totalUnits).toBe(10);
        expect(plan.budget).toBe(1000);
    });
    test('cooled shop contributes nothing', () => {
        const plan = planCluster(CLUSTER, DB, {}, 0, CFG, { runeshop: 99_999 });
        expect(plan.totalUnits).toBe(0);
    });
    test('cooldown expiry restores the shop', () => {
        const plan = planCluster(CLUSTER, DB, {}, 100_000, CFG, { runeshop: 99_999 });
        expect(plan.totalUnits).toBe(2000);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/shops/planner.test.ts`
Expected: FAIL — cannot resolve `#/bot/shops/Planner.js`.

- [ ] **Step 3: Implement part A of `src/bot/shops/Planner.ts`**

```ts
/**
 * Pure planning over the shop DB + curated route (client-free; callers pass
 * nowMs). Budgets follow the spec: withdraw ≈ estCost × 1.25 rounded up to
 * 1k, hard-capped at maxGpPerLeg; when the cap binds, planned units are
 * trimmed greedily in buys[] priority order (haulFraction stays pre-trim —
 * it measures stock availability, not affordability).
 */
import { expectedStock, unitPrice, unitsUnderPolicy } from '#/bot/shops/StockModel.js';
import type { AccountView, BuyPolicy, NavPointLike, Route, RouteCluster, SeenMap, ShopItemDef, ShopRecord } from '#/bot/shops/types.js';

export const BUDGET_BUFFER = 1.25;

export interface PlannerCfg {
    defaultPolicy: BuyPolicy;
    haulThresholdPct: number;
    maxGpPerLeg: number;
}

export interface BuyPlanItem { obj: string; name: string; units: number; estCost: number }
export interface ShopPlan { shopId: string; keeperNpc: string; stand: NavPointLike; items: BuyPlanItem[] }
export interface ClusterPlan {
    clusterId: string;
    shops: ShopPlan[];
    totalUnits: number;    // post-trim planned units
    maxUnits: number;      // units if every item sat at baseline (under policy)
    haulFraction: number;  // pre-trim available units / maxUnits
    estCost: number;       // post-trim
    budget: number;        // gp to withdraw for this cluster
}

export function clusterEligible(cluster: RouteCluster, acct: AccountView): boolean {
    return cluster.gates.every(g => {
        if (g.members && !acct.members) { return false; }
        if (g.skill && (acct.skills[g.skill.name] ?? 0) < g.skill.level) { return false; }
        if (g.quest && !acct.quests[g.quest]) { return false; }
        if (g.qp !== undefined && acct.qp < g.qp) { return false; }
        return true;
    });
}

export function cheapestUnmetGate(route: Route, acct: AccountView): string {
    const unmet: string[] = [];
    for (const c of route.clusters) {
        for (const g of c.gates) {
            if (g.members && !acct.members) { unmet.push('members world'); }
            if (g.skill && (acct.skills[g.skill.name] ?? 0) < g.skill.level) { unmet.push(`${g.skill.name} ${g.skill.level}`); }
            if (g.quest && !acct.quests[g.quest]) { unmet.push(`quest ${g.quest}`); }
            if (g.qp !== undefined && acct.qp < g.qp) { unmet.push(`${g.qp} quest points`); }
        }
    }
    return unmet[0] ?? 'none';
}

export function planCluster(
    cluster: RouteCluster,
    db: Record<string, ShopRecord>,
    seen: SeenMap,
    nowMs: number,
    cfg: PlannerCfg,
    cooldowns: Record<string, number>
): ClusterPlan {
    interface Want { shopId: string; keeperNpc: string; stand: NavPointLike; obj: string; name: string; available: number; expected: number; item: ShopItemDef; shop: { sell: number; delta: number } }
    const wants: Want[] = [];
    let maxUnits = 0;
    let availableUnits = 0;
    for (const shop of cluster.shops) {
        const rec = db[shop.shopId];
        if (!rec || (cooldowns[shop.shopId] ?? 0) > nowMs) {
            continue;
        }
        for (const buy of shop.buys) {
            const item = rec.items.find(i => i.obj === buy.obj);
            if (!item || item.baseline === 0) {
                continue; // baseline-0 items never restock; not plannable
            }
            const policy = buy.policy ?? cfg.defaultPolicy;
            const expected = expectedStock(item, seen[shop.shopId]?.[buy.obj], nowMs);
            const available = unitsUnderPolicy(policy, expected, item.baseline);
            maxUnits += unitsUnderPolicy(policy, item.baseline, item.baseline);
            availableUnits += available;
            wants.push({ shopId: shop.shopId, keeperNpc: shop.keeperNpc, stand: shop.stand, obj: buy.obj, name: item.name, available, expected, item, shop: { sell: rec.sell, delta: rec.delta } });
        }
    }

    // greedy allocation in buys[] priority order under the spend cap
    const spendCap = cfg.maxGpPerLeg / BUDGET_BUFFER;
    let spent = 0;
    const allocated = wants.map(w => {
        let units = 0;
        let cost = 0;
        while (units < w.available) {
            const next = unitPrice(w.item, w.shop, w.expected - units);
            if (spent + cost + next > spendCap) {
                break;
            }
            cost += next;
            units += 1;
        }
        spent += cost;
        return { ...w, units, estCost: cost };
    });

    const shops: ShopPlan[] = cluster.shops
        .map(s => ({
            shopId: s.shopId,
            keeperNpc: s.keeperNpc,
            stand: s.stand,
            items: allocated.filter(a => a.shopId === s.shopId).map(a => ({ obj: a.obj, name: a.name, units: a.units, estCost: a.estCost }))
        }))
        .filter(s => s.items.some(i => i.units > 0));

    const estCost = allocated.reduce((sum, a) => sum + a.estCost, 0);
    const totalUnits = allocated.reduce((sum, a) => sum + a.units, 0);
    const budget = Math.min(cfg.maxGpPerLeg, Math.ceil((estCost * BUDGET_BUFFER) / 1000) * 1000);
    return {
        clusterId: cluster.id,
        shops,
        totalUnits,
        maxUnits,
        haulFraction: maxUnits === 0 ? 0 : availableUnits / maxUnits,
        estCost,
        budget
    };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/shops/planner.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate and commit**

Run: `bunx tsc --noEmit && bunx eslint src/bot/shops/Planner.ts src/bot/shops/types.ts test/shops/planner.test.ts && bun test`

```bash
git add src/bot/shops/Planner.ts src/bot/shops/types.ts test/shops/planner.test.ts
git commit -m "feat(shops): Planner part A — gate eligibility, cluster plans, capped budgets

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Planner part B — decide() + idle wake time (TDD)

**Files:**
- Modify: `src/bot/shops/Planner.ts` (append)
- Test: `test/shops/planner.test.ts` (append)

**Interfaces:**
- Consumes: Task 4 exports.
- Produces (ShopRunner consumes):
  - `type Decision = { kind: 'buy'; clusterId: string; shop: ShopPlan } | { kind: 'bank'; clusterId: string; stand: NavPointLike; boothName: string; boothOp: string; withdrawFor: ClusterPlan | null } | { kind: 'idle'; stand: NavPointLike; boothName: string; boothOp: string; untilMs: number; bestClusterId: string | null; bestFractionPct: number }`
  - `interface RuntimeState { pos: NavPointLike | null; gpHeld: number; carryingPurchases: boolean; fundedPlan: ClusterPlan | null; visited: string[]; lastClusterId: string | null }`
  - `interface PlanOutcome { decision: Decision; skipped: { clusterId: string; fractionPct: number }[] }`
  - `decide(route: Route, db, seen, nowMs, cfg: PlannerCfg, acct: AccountView, cooldowns, rt: RuntimeState): PlanOutcome`
  - `earliestQualifyMs(route, db, seen, nowMs, cfg, acct, cooldowns): number` (scan +1 min steps, 8 h horizon; `nowMs + 30·60_000` fallback)

- [ ] **Step 1: Append the failing tests**

Append to `test/shops/planner.test.ts`:

```ts
import { decide, earliestQualifyMs, type RuntimeState } from '#/bot/shops/Planner.js';
import type { Route } from '#/bot/shops/types.js';

const ROUTE_FX: Route = { clusters: [CLUSTER], ring: ['varrock'] };
const rt = (over: Partial<RuntimeState> = {}): RuntimeState => ({
    pos: { x: 3200, z: 3400, level: 0 }, gpHeld: 0, carryingPurchases: false,
    fundedPlan: null, visited: [], lastClusterId: null, ...over
});

describe('decide', () => {
    test('cold start, cluster qualifies → bank at nearest route bank, funding it', () => {
        const { decision } = decide(ROUTE_FX, DB, {}, 0, CFG, acct(), {}, rt());
        expect(decision.kind).toBe('bank');
        if (decision.kind === 'bank') {
            expect(decision.withdrawFor?.clusterId).toBe('varrock');
            expect(decision.stand).toEqual(CLUSTER.bank.stand);
        }
    });
    test('funded with unvisited shop → buy that shop', () => {
        const plan = planCluster(CLUSTER, DB, {}, 0, CFG, {});
        const { decision } = decide(ROUTE_FX, DB, {}, 0, CFG, acct(), {}, rt({ fundedPlan: plan, gpHeld: plan.budget }));
        expect(decision.kind).toBe('buy');
        if (decision.kind === 'buy') {
            expect(decision.shop.shopId).toBe('runeshop');
        }
    });
    test('funded, all shops visited → bank (deposit), no re-fund when nothing qualifies', () => {
        const plan = planCluster(CLUSTER, DB, {}, 0, CFG, {});
        const seen: SeenMap = { runeshop: { mindrune: { count: 0, atMs: 0 }, deathrune: { count: 0, atMs: 0 } } };
        const { decision } = decide(ROUTE_FX, DB, seen, 0, CFG, acct(), {}, rt({ fundedPlan: plan, visited: ['runeshop'], carryingPurchases: true }));
        expect(decision.kind).toBe('bank');
        if (decision.kind === 'bank') {
            expect(decision.withdrawFor).toBe(null);
        }
    });
    test('nothing qualifies, empty-handed → idle with wake time and skip diagnostics', () => {
        const seen: SeenMap = { runeshop: { mindrune: { count: 0, atMs: 0 }, deathrune: { count: 0, atMs: 0 } } };
        const { decision, skipped } = decide(ROUTE_FX, DB, seen, 0, CFG, acct(), {}, rt());
        expect(decision.kind).toBe('idle');
        if (decision.kind === 'idle') {
            expect(decision.untilMs).toBeGreaterThan(0);
            expect(decision.bestClusterId).toBe('varrock');
        }
        expect(skipped).toEqual([{ clusterId: 'varrock', fractionPct: 0 }]);
    });
    test('ineligible cluster is invisible (no skip entry, no target)', () => {
        const gated: Route = { clusters: [{ ...CLUSTER, gates: [{ members: true }] }], ring: ['varrock'] };
        const { decision, skipped } = decide(gated, DB, {}, 0, CFG, acct({ members: false }), {}, rt());
        expect(decision.kind).toBe('idle');
        expect(skipped).toEqual([]);
    });
    test('carrying purchases with no funded plan → bank first (deposit), fund target in same visit', () => {
        const { decision } = decide(ROUTE_FX, DB, {}, 0, CFG, acct(), {}, rt({ carryingPurchases: true }));
        expect(decision.kind).toBe('bank');
        if (decision.kind === 'bank') {
            expect(decision.withdrawFor?.clusterId).toBe('varrock');
        }
    });
    test('ring rotation: next target starts after lastClusterId', () => {
        const c2: RouteCluster = { ...CLUSTER, id: 'portsarim', bank: { ...CLUSTER.bank, stand: { x: 3092, z: 3243, level: 0 } } };
        const two: Route = { clusters: [CLUSTER, c2], ring: ['varrock', 'portsarim'] };
        const { decision } = decide(two, DB, {}, 0, CFG, acct(), {}, rt({ lastClusterId: 'varrock' }));
        expect(decision.kind).toBe('bank');
        if (decision.kind === 'bank') {
            expect(decision.withdrawFor?.clusterId).toBe('portsarim');
        }
    });
});

describe('earliestQualifyMs', () => {
    test('death-rune-only shop bought out: 25% of 1000 = 250 units × 150 ticks × 600ms', () => {
        const deathOnly: RouteCluster = { ...CLUSTER, shops: [{ ...CLUSTER.shops[0], buys: [{ obj: 'deathrune' }] }] };
        const route: Route = { clusters: [deathOnly], ring: ['varrock'] };
        const seen: SeenMap = { runeshop: { deathrune: { count: 0, atMs: 0 } } };
        const wake = earliestQualifyMs(route, DB, seen, 0, CFG, acct(), {});
        const exact = 250 * 150 * 600;
        // minute-step scan: within one step above the exact crossing
        expect(wake).toBeGreaterThanOrEqual(exact - 60_000);
        expect(wake).toBeLessThanOrEqual(exact + 60_000);
    });
    test('nothing ever qualifies → 30min re-check fallback', () => {
        const gated: Route = { clusters: [{ ...CLUSTER, gates: [{ members: true }] }], ring: ['varrock'] };
        expect(earliestQualifyMs(gated, DB, {}, 0, CFG, acct({ members: false }), {})).toBe(30 * 60_000);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/shops/planner.test.ts`
Expected: FAIL — `decide` not exported.

- [ ] **Step 3: Append the implementation to `src/bot/shops/Planner.ts`**

```ts
export type Decision =
    | { kind: 'buy'; clusterId: string; shop: ShopPlan }
    | { kind: 'bank'; clusterId: string; stand: NavPointLike; boothName: string; boothOp: string; withdrawFor: ClusterPlan | null }
    | { kind: 'idle'; stand: NavPointLike; boothName: string; boothOp: string; untilMs: number; bestClusterId: string | null; bestFractionPct: number };

export interface RuntimeState {
    pos: NavPointLike | null;
    gpHeld: number;
    carryingPurchases: boolean;
    fundedPlan: ClusterPlan | null;
    visited: string[];          // shopIds bought (or skipped) within fundedPlan
    lastClusterId: string | null;
}

export interface PlanOutcome {
    decision: Decision;
    skipped: { clusterId: string; fractionPct: number }[];
}

function cheb(a: NavPointLike, b: NavPointLike): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

function nearestBank(route: Route, pos: NavPointLike | null): RouteCluster {
    if (!pos) {
        return route.clusters[0];
    }
    return [...route.clusters].sort((a, b) => cheb(a.bank.stand, pos) - cheb(b.bank.stand, pos))[0];
}

function nextInRing(route: Route, qualifying: Map<string, ClusterPlan>, lastClusterId: string | null): ClusterPlan | null {
    const ring = route.ring;
    const start = lastClusterId ? (ring.indexOf(lastClusterId) + 1) % ring.length : 0;
    for (let i = 0; i < ring.length; i++) {
        const id = ring[(start + i) % ring.length];
        const plan = qualifying.get(id);
        if (plan) {
            return plan;
        }
    }
    return null;
}

export function decide(
    route: Route,
    db: Record<string, ShopRecord>,
    seen: SeenMap,
    nowMs: number,
    cfg: PlannerCfg,
    acct: AccountView,
    cooldowns: Record<string, number>,
    rt: RuntimeState
): PlanOutcome {
    const eligible = route.clusters.filter(c => clusterEligible(c, acct));
    const plans = new Map(eligible.map(c => [c.id, planCluster(c, db, seen, nowMs, cfg, cooldowns)]));
    const qualifying = new Map([...plans].filter(([, p]) => p.totalUnits > 0 && p.haulFraction * 100 >= cfg.haulThresholdPct));
    const skipped = [...plans.values()]
        .filter(p => !qualifying.has(p.clusterId))
        .map(p => ({ clusterId: p.clusterId, fractionPct: Math.round(p.haulFraction * 100) }));

    // mid-cluster: keep executing the funded plan
    if (rt.fundedPlan) {
        const next = rt.fundedPlan.shops.find(s => !rt.visited.includes(s.shopId) && (cooldowns[s.shopId] ?? 0) <= nowMs);
        if (next) {
            return { decision: { kind: 'buy', clusterId: rt.fundedPlan.clusterId, shop: next }, skipped };
        }
    }

    const target = nextInRing(route, qualifying, rt.fundedPlan?.clusterId ?? rt.lastClusterId);

    // done with a cluster (or holding stuff/gp for any other reason): bank —
    // deposit everything and fund the next target in the same visit.
    if (rt.fundedPlan || rt.carryingPurchases || rt.gpHeld > 0 || target) {
        const at = rt.fundedPlan
            ? route.clusters.find(c => c.id === rt.fundedPlan!.clusterId) ?? nearestBank(route, rt.pos)
            : nearestBank(route, rt.pos);
        return {
            decision: { kind: 'bank', clusterId: at.id, stand: at.bank.stand, boothName: at.bank.boothName, boothOp: at.bank.boothOp, withdrawFor: target },
            skipped
        };
    }

    // nothing to do: idle at the nearest bank until the model says otherwise
    const best = [...plans.values()].sort((a, b) => b.haulFraction - a.haulFraction)[0] ?? null;
    const at = nearestBank(route, rt.pos);
    return {
        decision: {
            kind: 'idle',
            stand: at.bank.stand,
            boothName: at.bank.boothName,
            boothOp: at.bank.boothOp,
            untilMs: earliestQualifyMs(route, db, seen, nowMs, cfg, acct, cooldowns),
            bestClusterId: best?.clusterId ?? null,
            bestFractionPct: Math.round((best?.haulFraction ?? 0) * 100)
        },
        skipped
    };
}

const QUALIFY_SCAN_STEP_MS = 60_000;
const QUALIFY_SCAN_HORIZON_MS = 8 * 60 * 60_000;
const QUALIFY_FALLBACK_MS = 30 * 60_000;

export function earliestQualifyMs(
    route: Route,
    db: Record<string, ShopRecord>,
    seen: SeenMap,
    nowMs: number,
    cfg: PlannerCfg,
    acct: AccountView,
    cooldowns: Record<string, number>
): number {
    const eligible = route.clusters.filter(c => clusterEligible(c, acct));
    for (let t = nowMs + QUALIFY_SCAN_STEP_MS; t <= nowMs + QUALIFY_SCAN_HORIZON_MS; t += QUALIFY_SCAN_STEP_MS) {
        for (const c of eligible) {
            const p = planCluster(c, db, seen, t, cfg, cooldowns);
            if (p.totalUnits > 0 && p.haulFraction * 100 >= cfg.haulThresholdPct) {
                return t;
            }
        }
    }
    return nowMs + QUALIFY_FALLBACK_MS;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/shops/planner.test.ts`
Expected: PASS (all part A + part B cases).

- [ ] **Step 5: Gate and commit**

Run: `bunx tsc --noEmit && bunx eslint src/bot/shops/Planner.ts test/shops/planner.test.ts && bun test`

```bash
git add src/bot/shops/Planner.ts test/shops/planner.test.ts
git commit -m "feat(shops): Planner part B — decide() state machine + idle wake scan

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Route data + NAV_TARGETS + coverage gate + integrity test

**Files:**
- Create: `src/bot/shops/data/route.ts`
- Modify: `src/bot/nav/data/navTargets.ts` (7 new entries)
- Test: `test/shops/route.test.ts`

**Interfaces:**
- Consumes: types.ts, `SHOP_DB`.
- Produces: `ROUTE: Route`, `SMOKE_ROUTE: Route` from `#/bot/shops/data/route.js`.

- [ ] **Step 1: Write the failing integrity test**

Create `test/shops/route.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { ROUTE, SMOKE_ROUTE } from '#/bot/shops/data/route.js';
import { SHOP_DB } from '#/bot/shops/data/shopdb.js';
import type { Route } from '#/bot/shops/types.js';

function checkRoute(route: Route): void {
    expect(route.ring).toEqual(route.clusters.map(c => c.id));
    for (const cluster of route.clusters) {
        for (const shop of cluster.shops) {
            const rec = SHOP_DB[shop.shopId];
            expect(rec).toBeDefined();
            expect(rec.keepers).toContain(shop.keeperNpc);
            expect(rec.scope).toBe('shared');
            for (const buy of shop.buys) {
                const item = rec.items.find(i => i.obj === buy.obj);
                expect(item).toBeDefined();
                expect(item!.stackable).toBe(true);   // v1 buylist must stack (no inv pressure)
                expect(item!.baseline).toBeGreaterThan(0); // baseline-0 never restocks
                if (buy.policy?.kind === 'floor') {
                    expect(buy.policy.pct).toBeGreaterThan(0);
                    expect(buy.policy.pct).toBeLessThan(100);
                }
            }
        }
    }
}

describe('route data integrity vs generated shopdb', () => {
    test('live route resolves entirely against SHOP_DB', () => {
        checkRoute(ROUTE);
        expect(ROUTE.clusters.map(c => c.id)).toEqual(['varrock', 'portsarim', 'catherby', 'fishingguild', 'rangingguild']);
    });
    test('members/skill gates sit on the members clusters', () => {
        const byId = new Map(ROUTE.clusters.map(c => [c.id, c]));
        expect(byId.get('varrock')!.gates).toEqual([]);
        expect(byId.get('portsarim')!.gates).toEqual([]);
        expect(byId.get('catherby')!.gates).toEqual([{ members: true }]);
        expect(byId.get('fishingguild')!.gates).toEqual([{ members: true }, { skill: { name: 'fishing', level: 68 } }]);
        expect(byId.get('rangingguild')!.gates).toEqual([{ members: true }, { skill: { name: 'ranged', level: 40 } }]);
    });
    test('smoke route is the Aubury-only varrock cluster', () => {
        checkRoute(SMOKE_ROUTE);
        expect(SMOKE_ROUTE.clusters).toHaveLength(1);
        expect(SMOKE_ROUTE.clusters[0].shops).toHaveLength(1);
        expect(SMOKE_ROUTE.clusters[0].shops[0].shopId).toBe('runeshop');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/shops/route.test.ts`
Expected: FAIL — cannot resolve `#/bot/shops/data/route.js`.

- [ ] **Step 3: Write `src/bot/shops/data/route.ts`** (coords from the pinned table above)

```ts
/**
 * Curated v1 route. Stand tiles are validated by the offline nav-coverage
 * gate (tools/nav/coverage.ts) — if it FAILs a tile, use its printed
 * `nearest connected` replacement. Deferred clusters (shopdb has the data;
 * add when the blockers fall): Magic Guild Yanille (upstairs + magic 66),
 * Shilo (non-booth bank + Shilo Village quest), Mage Arena (deep wild),
 * Ardougne/Gnome general stores (baselines ≤ 30).
 */
import type { Route } from '#/bot/shops/types.js';

const BOOTH = { boothName: 'Bank booth', boothOp: 'Use-quickly' };
const RUNES = ['firerune', 'waterrune', 'airrune', 'earthrune', 'mindrune', 'bodyrune', 'chaosrune', 'deathrune'].map(obj => ({ obj }));
const TIPS = ['bronze_arrowheads', 'iron_arrowheads', 'steel_arrowheads', 'mithril_arrowheads', 'adamant_arrowheads', 'rune_arrowheads'].map(obj => ({ obj }));

export const ROUTE: Route = {
    clusters: [
        {
            id: 'varrock',
            bank: { stand: { x: 3251, z: 3420, level: 0 }, ...BOOTH },
            shops: [
                { shopId: 'runeshop', keeperNpc: 'Aubury', stand: { x: 3253, z: 3401, level: 0 }, buys: RUNES },
                { shopId: 'archeryshop', keeperNpc: 'Lowe', stand: { x: 3232, z: 3422, level: 0 }, buys: [{ obj: 'bronze_arrow' }, { obj: 'iron_arrow' }, { obj: 'steel_arrow' }] }
            ],
            gates: []
        },
        {
            id: 'portsarim',
            bank: { stand: { x: 3092, z: 3243, level: 0 }, ...BOOTH }, // Draynor — nearest bank to Port Sarim
            shops: [
                { shopId: 'magicshop', keeperNpc: 'Betty', stand: { x: 3012, z: 3258, level: 0 }, buys: RUNES },
                { shopId: 'fishingshop', keeperNpc: 'Gerrant', stand: { x: 3013, z: 3224, level: 0 }, buys: [{ obj: 'feather' }] }
            ],
            gates: []
        },
        {
            id: 'catherby',
            bank: { stand: { x: 2809, z: 3441, level: 0 }, ...BOOTH },
            shops: [
                { shopId: 'archeryshop2', keeperNpc: 'Hickton', stand: { x: 2821, z: 3442, level: 0 }, buys: [{ obj: 'bronze_arrow' }, { obj: 'iron_arrow' }, ...TIPS] }
            ],
            gates: [{ members: true }]
        },
        {
            id: 'fishingguild',
            bank: { stand: { x: 2586, z: 3420, level: 0 }, ...BOOTH },
            shops: [
                { shopId: 'fishingguild', keeperNpc: 'Roachey', stand: { x: 2596, z: 3399, level: 0 }, buys: [{ obj: 'feather' }] }
            ],
            gates: [{ members: true }, { skill: { name: 'fishing', level: 68 } }]
        },
        {
            id: 'rangingguild',
            bank: { stand: { x: 2725, z: 3493, level: 0 }, ...BOOTH }, // Seers — nearest bank to the Ranging Guild
            shops: [
                {
                    shopId: 'ranging_guild_bowshop', keeperNpc: 'Bow and Arrow salesman', stand: { x: 2672, z: 3434, level: 0 },
                    buys: [{ obj: 'bronze_arrow' }, { obj: 'iron_arrow' }, { obj: 'steel_arrow' }, { obj: 'mithril_arrow' }, { obj: 'adamant_arrow' }, { obj: 'rune_arrow' }, ...TIPS]
                }
            ],
            gates: [{ members: true }, { skill: { name: 'ranged', level: 40 } }]
        }
    ],
    ring: ['varrock', 'portsarim', 'catherby', 'fishingguild', 'rangingguild']
};

/** Smoke route: Aubury only, so buying him out un-qualifies the whole cluster. */
export const SMOKE_ROUTE: Route = {
    clusters: [{ ...ROUTE.clusters[0], shops: [ROUTE.clusters[0].shops[0]] }],
    ring: ['varrock']
};
```

- [ ] **Step 4: Add the NAV_TARGETS entries**

In `src/bot/nav/data/navTargets.ts`, append to `NAV_TARGETS` (Varrock East/Catherby/Fishing Guild/Seers bank stands already exist under other bots — do not duplicate):

```ts
{ bot: 'ShopRunner', label: 'Aubury shop stand', tile: { x: 3253, z: 3401, level: 0 } },
{ bot: 'ShopRunner', label: "Lowe's archery stand", tile: { x: 3232, z: 3422, level: 0 } },
{ bot: 'ShopRunner', label: "Betty's magic shop stand", tile: { x: 3012, z: 3258, level: 0 } },
{ bot: 'ShopRunner', label: "Gerrant's fishing shop stand", tile: { x: 3013, z: 3224, level: 0 } },
{ bot: 'ShopRunner', label: 'Draynor bank stand', tile: { x: 3092, z: 3243, level: 0 } },
{ bot: 'ShopRunner', label: "Hickton's archery stand", tile: { x: 2821, z: 3442, level: 0 } },
{ bot: 'ShopRunner', label: 'Fishing Guild shop stand', tile: { x: 2596, z: 3399, level: 0 } },
{ bot: 'ShopRunner', label: "Dargaud's bow shop stand", tile: { x: 2672, z: 3434, level: 0 } },
```

(8 entries — the 7 “new” stands plus Fishing Guild shop; the guild *bank* stand is the existing Fisher entry.)

- [ ] **Step 5: Run the coverage gate and correct stands**

Run: `bun run build:bot && bun tools/nav/coverage.ts`
Expected: every ShopRunner line `ok`. For any `FAIL <label> ... nearest connected = (x,z,level)`: replace that tile in BOTH `route.ts` and `navTargets.ts` with the suggested tile, re-run until green. (Shop interiors sit behind doors — `walkResilient`'s unstick ladder opens plain doors, but a stand the gate calls `island` means the baked graph can't reach it at all: prefer the suggested tile, typically just outside the doorway; `Shop.open`'s Trade click server-walks the last stretch.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test test/shops/route.test.ts`
Expected: PASS (3 tests). Note: this test imports the real `SHOP_DB` — it doubles as a schema check on the generated file (keepers include 'Aubury', 'Bow and Arrow salesman', etc.).

- [ ] **Step 7: Gate and commit**

Run: `bunx tsc --noEmit && bunx eslint src/bot/shops/data/route.ts src/bot/nav/data/navTargets.ts test/shops/route.test.ts && bun test`

```bash
git add src/bot/shops/data/route.ts src/bot/nav/data/navTargets.ts test/shops/route.test.ts
git commit -m "feat(shops): curated v1 route + nav-coverage-validated stand tiles

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: ShopRunner skeleton — settings, onStart gates, persistence, decision loop, registration

**Files:**
- Create: `src/bot/scripts/ShopRunner.ts`
- Modify: `src/bot/scripts/index.ts` (import + register)

**Interfaces:**
- Consumes: Planner/StockModel/route/shopdb + `Quests.status/points`, `Skills.level`, `Game.tile/myName`, `Inventory.count/items`, `ScriptRunner.stop`.
- Produces: `SHOPRUNNER_SETTINGS: SettingsSchema`, `class ShopRunner extends TaskBot` with `decision: PlanOutcome | null` recomputed every loop; Task 8 fills in the action tasks.

- [ ] **Step 1: Write the skeleton**

Create `src/bot/scripts/ShopRunner.ts`:

```ts
/**
 * ShopRunner — world shop-run supply loop (spec:
 * docs/superpowers/specs/2026-07-13-shop-runner-design.md). Cycles shop
 * clusters buying feathers/runes/arrows, banking between clusters with
 * capped withdrawals; a pure Planner (decide()) picks every next action, so
 * the bot recovers from any position by re-planning.
 */
import { ChatDialog } from '#/bot/api/hud/ChatDialog.js';
import { Inventory } from '#/bot/api/hud/Inventory.js';
import { Quests } from '#/bot/api/hud/Quests.js';
import { Skills } from '#/bot/api/hud/Skills.js';
import { Game } from '#/bot/api/Game.js';
import { TaskBot, type Task } from '#/bot/api/Bot.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';
import type { SettingsSchema } from '#/bot/runtime/Settings.js';
import { cheapestUnmetGate, clusterEligible, decide, type ClusterPlan, type PlanOutcome, type PlannerCfg } from '#/bot/shops/Planner.js';
import { SHOP_DB } from '#/bot/shops/data/shopdb.js';
import { ROUTE, SMOKE_ROUTE } from '#/bot/shops/data/route.js';
import type { AccountView, BuyPolicy, Route, SeenMap } from '#/bot/shops/types.js';

export const SHOPRUNNER_SETTINGS: SettingsSchema = {
    strategy: { type: 'string', default: 'Buyout', options: ['Buyout', 'Floor %'], label: 'Buy strategy', help: 'Buyout empties the stock; Floor % buys down to floorPct of each shop\'s baseline (per-item overrides in route data win)' },
    floorPct: { type: 'number', default: 50, min: 1, max: 99, label: 'Floor % of baseline', help: 'only used when strategy = Floor %' },
    haulThreshold: { type: 'number', default: 25, min: 1, max: 100, label: 'Min haul % to visit', help: 'a cluster is skipped until its predicted haul reaches this fraction of a full haul' },
    maxGpPerLeg: { type: 'number', default: 100_000, min: 1000, label: 'Max gp per withdrawal', help: 'hard cap on any single coin withdrawal; plans are trimmed to fit' },
    stopFloorGp: { type: 'number', default: 5000, min: 0, label: 'Stop below bank gp', help: 'clean stop when the bank runs dry' },
    membersWorld: { type: 'boolean', default: true, label: 'Members world', help: 'gates members clusters; a wrong value degrades to logged skips' },
    route: { type: 'string', default: 'live', options: ['live', 'smoke-varrock'], label: 'Route', help: 'smoke-varrock is the Aubury-only test route' }
};

const COOLDOWN_MS = 10 * 60_000;
const SEEN_KEY_PREFIX = 'rs2b0t:shoprun:seen:';
const hasStorage = typeof localStorage !== 'undefined';

export class ShopRunner extends TaskBot {
    override loopDelay = 600;

    route: Route = ROUTE;
    cfg: PlannerCfg = { defaultPolicy: { kind: 'buyout' }, haulThresholdPct: 25, maxGpPerLeg: 100_000 };
    stopFloorGp = 5000;
    membersWorld = true;

    seen: SeenMap = {};
    cooldowns: Record<string, number> = {};
    fundedPlan: ClusterPlan | null = null;
    visited: string[] = [];
    lastClusterId: string | null = null;
    decision: PlanOutcome | null = null;

    /** lowercase display names of everything the route can buy (deposit filter / carrying check) */
    buyNames = new Set<string>();
    status = 'starting';
    sessionHaul: Record<string, number> = {};
    sessionSpent = 0;

    override async onStart(): Promise<void> {
        const strategy = this.settings.str('strategy', 'Buyout');
        const policy: BuyPolicy = strategy === 'Floor %' ? { kind: 'floor', pct: this.settings.num('floorPct', 50) } : { kind: 'buyout' };
        this.cfg = {
            defaultPolicy: policy,
            haulThresholdPct: this.settings.num('haulThreshold', 25),
            maxGpPerLeg: this.settings.num('maxGpPerLeg', 100_000)
        };
        this.stopFloorGp = this.settings.num('stopFloorGp', 5000);
        this.membersWorld = this.settings.bool('membersWorld', true);
        this.route = this.settings.str('route', 'live') === 'smoke-varrock' ? SMOKE_ROUTE : ROUTE;

        for (const cluster of this.route.clusters) {
            for (const shop of cluster.shops) {
                for (const buy of shop.buys) {
                    const item = SHOP_DB[shop.shopId]?.items.find(i => i.obj === buy.obj);
                    if (item) {
                        this.buyNames.add(item.name.toLowerCase());
                    }
                }
            }
        }

        const acct = this.accountView();
        if (!this.route.clusters.some(c => clusterEligible(c, acct))) {
            this.log(`[shoprun] stopping — no eligible clusters (cheapest unmet gate: ${cheapestUnmetGate(this.route, acct)})`);
            ScriptRunner.stop();
            return;
        }
        this.loadSeen();
        this.addTasks();
    }

    /** Task 8 replaces this with the real task list; the skeleton only replans+logs. */
    protected addTasks(): void {
        this.add(new ContinueDialog(), new LogDecision(this));
    }

    override async loop(): Promise<number | void> {
        this.decision = decide(
            this.route, SHOP_DB, this.seen, Date.now(), this.cfg, this.accountView(), this.cooldowns,
            {
                pos: Game.tile(),
                gpHeld: Inventory.count('Coins'),
                carryingPurchases: Inventory.items().some(i => i.name !== null && this.buyNames.has(i.name.toLowerCase())),
                fundedPlan: this.fundedPlan,
                visited: this.visited,
                lastClusterId: this.lastClusterId
            }
        );
        return super.loop();
    }

    accountView(): AccountView {
        const quests: Record<string, boolean> = {};
        const skills: Record<string, number> = {};
        for (const cluster of this.route.clusters) {
            for (const gate of cluster.gates) {
                if (gate.quest) {
                    quests[gate.quest] = Quests.status(gate.quest) === 'complete';
                }
                if (gate.skill) {
                    skills[gate.skill.name] = Skills.level(gate.skill.name);
                }
            }
        }
        return { members: this.membersWorld, qp: Quests.points(), quests, skills };
    }

    seenKey(): string | null {
        const name = Game.myName();
        return name ? `${SEEN_KEY_PREFIX}${name.toLowerCase()}` : null;
    }

    loadSeen(): void {
        const key = this.seenKey();
        if (!hasStorage || !key) {
            return;
        }
        try {
            this.seen = JSON.parse(localStorage.getItem(key) ?? '{}') as SeenMap;
        } catch {
            this.seen = {};
        }
    }

    saveSeen(): void {
        const key = this.seenKey();
        if (hasStorage && key) {
            localStorage.setItem(key, JSON.stringify(this.seen));
        }
    }

    recordSeen(shopId: string, obj: string, count: number): void {
        (this.seen[shopId] ??= {})[obj] = { count, atMs: Date.now() };
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const haul = Object.entries(this.sessionHaul).map(([k, v]) => `${k} +${v}`).join('  ') || '—';
        const lines = [
            `ShopRunner — ${this.status}`,
            `gp held ${Inventory.count('Coins')}  spent ${this.sessionSpent}`,
            `haul ${haul}`
        ];
        ctx.font = '12px monospace';
        const width = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(6, 6, width, lines.length * 16 + 10);
        ctx.fillStyle = '#8be9fd';
        lines.forEach((line, i) => ctx.fillText(line, 12, 24 + i * 16));
    }
}

class ContinueDialog implements Task {
    validate(): boolean { return ChatDialog.canContinue(); }
    async execute(): Promise<void> { await ChatDialog.continue(); }
}

/** Skeleton-only visibility task (replaced in Task 8): log each new decision kind. */
class LogDecision implements Task {
    private lastLogged = '';
    constructor(private readonly bot: ShopRunner) {}
    validate(): boolean { return this.bot.decision !== null; }
    execute(): void {
        const d = this.bot.decision!.decision;
        const summary = d.kind === 'buy' ? `buy ${d.shop.shopId}` : d.kind === 'bank' ? `bank ${d.clusterId} fund=${d.withdrawFor?.clusterId ?? 'none'}` : `idle best=${d.bestClusterId}`;
        if (summary !== this.lastLogged) {
            this.bot.log(`[shoprun] decision: ${summary}`);
            this.lastLogged = summary;
        }
        this.bot.status = summary;
    }
}
```

- [ ] **Step 2: Register the script**

In `src/bot/scripts/index.ts`, add with the other imports:

```ts
import { ShopRunner, SHOPRUNNER_SETTINGS } from './ShopRunner.js';
```

and with the other registrations:

```ts
ScriptRegistry.register({
    name: 'ShopRunner',
    description: 'World shop-run supply loop — cycles shop clusters buying feathers, runes, and arrows/arrowtips, banking between clusters with capped gp withdrawals; skips shops until stock regenerates',
    category: 'Money making',
    tags: ['shopping', 'banking', 'worldwalker', 'f2p', 'members'],
    settingsSchema: SHOPRUNNER_SETTINGS,
    create: () => new ShopRunner()
});
```

- [ ] **Step 3: Verify import names against the real modules**

The import paths/names above follow EssMiner's imports — before compiling, open `src/bot/scripts/EssMiner.ts:1-30` and mirror its exact import forms for `ChatDialog`, `Inventory`, `Quests`, `Skills`, `Game`, `TaskBot`/`Task`, `ScriptRunner` (e.g. whether `Task` is a type-only import). Fix any mismatch in ShopRunner.ts.

- [ ] **Step 4: Gate**

Run: `bunx tsc --noEmit && bunx eslint src/bot/scripts/ShopRunner.ts src/bot/scripts/index.ts && bun test`
Expected: clean; suite unchanged (the skeleton has no unit tests — its logic lives in the already-tested Planner).

- [ ] **Step 5: Commit**

```bash
git add src/bot/scripts/ShopRunner.ts src/bot/scripts/index.ts
git commit -m "feat(shops): ShopRunner skeleton — settings, gates, persistence, decision loop, registration

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: ShopRunner action tasks — BankLeg / BuyLeg / Idle

**Files:**
- Modify: `src/bot/scripts/ShopRunner.ts`

**Interfaces:**
- Consumes: `Bank.openNearest/withdrawX/depositAllMatching/count/items`, `Shop.open/stock/buy/close`, `Traversal.walkResilient`, `Execution.delayUntil`, Decision shapes from Task 5.
- Produces: the spec's log shapes, consumed verbatim by Task 9's smoke:
  - `[shoprun] withdraw <n>gp cluster=<id>`
  - `[shoprun] buy shop=<inv> item=<obj> n=<n> spent=<gp>`
  - `[shoprun] banked cluster=<id>`
  - `[shoprun] skip cluster=<id> haul=<p>%<<t>%`
  - `[shoprun] idle until ~<mm:ss> best=<id> <p>%`
  - `[shoprun] shop-open failed 3x — cooling <inv> for 10m`
  - `[shoprun] stopping — out of operating gp (bank <n> < floor <n>)`

- [ ] **Step 1: Replace `addTasks()` and `LogDecision` with the real tasks**

In `src/bot/scripts/ShopRunner.ts`: add imports

```ts
import { Bank } from '#/bot/api/hud/Bank.js';
import { Shop } from '#/bot/api/hud/Shop.js';
import { Execution } from '#/bot/api/Execution.js';
import { Traversal } from '#/bot/api/Traversal.js';
import type { NavPointLike } from '#/bot/shops/types.js';
```

(verify exact paths against EssMiner/Shop consumers as in Task 7 Step 3), delete the `LogDecision` class, change `addTasks()` to:

```ts
protected addTasks(): void {
    this.add(new ContinueDialog(), new BankLeg(this), new BuyLeg(this), new IdleAtBank(this));
}
```

and append inside the module:

```ts
const cheb = (a: NavPointLike, b: NavPointLike): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

async function walkNear(bot: ShopRunner, dest: NavPointLike, radius = 2): Promise<void> {
    const here = Game.tile();
    if (here && cheb(here, dest) <= radius) {
        return;
    }
    await Traversal.walkResilient({ x: dest.x, z: dest.z, level: dest.level }, { radius, attempts: 6, timeoutMs: 240_000, log: m => bot.log(`  ${m}`) });
}

class BankLeg implements Task {
    constructor(private readonly bot: ShopRunner) {}
    validate(): boolean { return this.bot.decision?.decision.kind === 'bank'; }
    async execute(): Promise<void> {
        const bot = this.bot;
        const d = bot.decision!.decision;
        if (d.kind !== 'bank') {
            return;
        }
        bot.status = `banking at ${d.clusterId}`;
        await walkNear(bot, d.stand);
        if (!(await Bank.openNearest(d.boothName, d.boothOp, m => bot.log(`  ${m}`)))) {
            bot.log('[shoprun] bank open failed — will retry');
            return;
        }
        await Bank.depositAllMatching(name => bot.buyNames.has(name.toLowerCase()) || name === 'Coins');
        // the funded plan is settled the moment its haul is deposited
        if (bot.fundedPlan) {
            bot.lastClusterId = bot.fundedPlan.clusterId;
            bot.fundedPlan = null;
            bot.visited = [];
            bot.log(`[shoprun] banked cluster=${d.clusterId}`);
        }
        for (const s of bot.decision!.skipped) {
            bot.log(`[shoprun] skip cluster=${s.clusterId} haul=${s.fractionPct}%<${bot.cfg.haulThresholdPct}%`);
        }
        const bankGp = Bank.count('Coins');
        if (bankGp < bot.stopFloorGp) {
            bot.log(`[shoprun] stopping — out of operating gp (bank ${bankGp} < floor ${bot.stopFloorGp})`);
            ScriptRunner.stop();
            return;
        }
        if (d.withdrawFor && d.withdrawFor.budget > 0) {
            const before = Inventory.count('Coins');
            if (!(await Bank.withdrawX('Coins', d.withdrawFor.budget))) {
                bot.log('[shoprun] coin withdrawal failed — will retry');
                return;
            }
            await Execution.delayUntil(() => Inventory.count('Coins') > before, 3000);
            bot.log(`[shoprun] withdraw ${d.withdrawFor.budget}gp cluster=${d.withdrawFor.clusterId}`);
            bot.fundedPlan = d.withdrawFor;
            bot.visited = [];
        }
    }
}

class BuyLeg implements Task {
    private openFails: Record<string, number> = {};
    constructor(private readonly bot: ShopRunner) {}
    validate(): boolean { return this.bot.decision?.decision.kind === 'buy'; }
    async execute(): Promise<void> {
        const bot = this.bot;
        const d = bot.decision!.decision;
        if (d.kind !== 'buy') {
            return;
        }
        const shop = d.shop;
        bot.status = `buying at ${shop.shopId}`;
        await walkNear(bot, shop.stand);
        if (!(await Shop.open(shop.keeperNpc))) {
            const fails = (this.openFails[shop.shopId] ?? 0) + 1;
            this.openFails[shop.shopId] = fails;
            if (fails >= 3) {
                bot.cooldowns[shop.shopId] = Date.now() + 10 * 60_000;
                bot.visited.push(shop.shopId);
                this.openFails[shop.shopId] = 0;
                bot.log(`[shoprun] shop-open failed 3x — cooling ${shop.shopId} for 10m`);
            }
            return;
        }
        this.openFails[shop.shopId] = 0;
        const record = (): void => {
            const stock = Shop.stock();
            const rec = SHOP_DB[shop.shopId];
            for (const row of stock) {
                const item = rec.items.find(i => i.name.toLowerCase() === row.name.toLowerCase());
                if (item) {
                    bot.recordSeen(shop.shopId, item.obj, row.count);
                }
            }
        };
        record(); // observation on arrival corrects the model (world-shared stock)
        for (const want of shop.items) {
            if (want.units <= 0) {
                continue;
            }
            const gpBefore = Inventory.count('Coins');
            const bought = await Shop.buy(want.name, want.units);
            const spent = gpBefore - Inventory.count('Coins');
            if (bought > 0) {
                bot.sessionHaul[want.obj] = (bot.sessionHaul[want.obj] ?? 0) + bought;
                bot.sessionSpent += spent;
                bot.log(`[shoprun] buy shop=${shop.shopId} item=${want.obj} n=${bought} spent=${spent}`);
            }
        }
        record(); // post-buy leftovers are the next prediction's anchor
        bot.saveSeen();
        await Shop.close();
        bot.visited.push(shop.shopId);
    }
}

class IdleAtBank implements Task {
    private lastIdleLogMs = 0;
    constructor(private readonly bot: ShopRunner) {}
    validate(): boolean { return this.bot.decision?.decision.kind === 'idle'; }
    async execute(): Promise<void> {
        const bot = this.bot;
        const d = bot.decision!.decision;
        if (d.kind !== 'idle') {
            return;
        }
        bot.status = 'idle — waiting for restock';
        await walkNear(bot, d.stand, 4);
        const now = Date.now();
        if (now - this.lastIdleLogMs > 60_000) {
            this.lastIdleLogMs = now;
            const remain = Math.max(0, d.untilMs - now);
            const mm = String(Math.floor(remain / 60_000)).padStart(2, '0');
            const ss = String(Math.floor((remain % 60_000) / 1000)).padStart(2, '0');
            bot.log(`[shoprun] idle until ~${mm}:${ss} best=${d.bestClusterId ?? 'none'} ${d.bestFractionPct}%`);
        }
    }
}
```

- [ ] **Step 2: Reconcile helper details against the real APIs**

Three things to verify while wiring (fix in place, don't work around):
1. `Traversal.walkResilient(dest, opts)` takes a `WorldTile` — confirm a plain `{x, z, level}` literal satisfies it (EssMiner passes `Tile` instances; if a `Tile` is required, construct one: `new Tile(dest.x, dest.z, dest.level)` with EssMiner's exact import).
2. `Bank.withdrawX('Coins', n)` — confirm it reads the item's real `Withdraw-X` op (space form, like `withdrawOneOp` does for `Withdraw 1`). If it trusts a hyphenated default internally, withdraw with the op read off the item instead: find `'Coins'` in `Bank.items()`, pick its op via
   ```ts
   const opLike = (ops: readonly (string | null)[], re: RegExp): string | null =>
       ops.find((o): o is string => o !== null && re.test(o)) ?? null;
   const xOp = opLike(coins.ops, /^withdraw[\s-]*x$/i);
   ```
   then mirror whatever `Bank.withdrawX`'s body actually does with that op + the count dialog. Only add this helper if it's needed.
3. `Execution` import path — EssMiner uses `Execution.delayUntil`; copy its import line.

- [ ] **Step 3: Gate**

Run: `bunx tsc --noEmit && bunx eslint src/bot/scripts/ShopRunner.ts && bun test`
Expected: clean. Behavior is proven by the Task 9 smoke (this file is deliberately thin over the tested Planner).

- [ ] **Step 4: Commit**

```bash
git add src/bot/scripts/ShopRunner.ts
git commit -m "feat(shops): ShopRunner action tasks — bank legs, shop buys, restock idle

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Local-engine smoke — `tools/shoprun-test.ts`

**Files:**
- Create: `tools/shoprun-test.ts`
- Modify: `tools/run-all-smokes.ts` (add a `LONG` entry: `'shoprun-test': 600`)

**Interfaces:**
- Consumes: `tools/tutorial/harness.js` (`mainlandAccount`, `cheat`, `startScript`), the Task 8 log shapes, settings raw-string keys `rs2b0t:set:ShopRunner:<key>`.
- Produces: a run-all-smokes-discovered smoke proving the full leg: withdraw → buy at Aubury → deposit → model-driven skip.

- [ ] **Step 1: Write the smoke**

Create `tools/shoprun-test.ts` (mirror `tools/shop-test.ts`'s boot exactly — argv base, chromium launch, page wiring; the assertions below are the contract):

```ts
/**
 * ShopRunner smoke vs the local engine. Proves one full cluster leg:
 * seeded bank coins → withdraw (capped) → buy runes at Aubury under a 90%
 * floor → deposit haul+coins → immediate re-plan SKIPS the cluster (stock
 * model). Floor 90 keeps the haul to ~1000 runes (~100 Buy-10 clicks ≈ 2
 * min) so the leg fits the smoke timeout; floor 50 would buy ~5000.
 * Route: SMOKE_ROUTE (Aubury only) via the `route` setting.
 * Run: bun tools/shoprun-test.ts [http://localhost:8888]
 */
import { chromium, type Page } from 'playwright-core';
import { cheat, mainlandAccount } from './tutorial/harness.js';

const base = process.argv[2] ?? 'http://localhost:8888';
const user = `shoprun${Date.now() % 100000}`;

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page: Page = await browser.newPage();
page.on('pageerror', e => console.error('pageerror:', e.message));

await mainlandAccount(page, base, user);
// seed BANK coins (bank-seed cheat form; pack-seed would be ::give)
await cheat(page, '~bankitem coins 100000');
// stand near Varrock East bank: (3251,3420) → msq 50_53, local (51,28)
await cheat(page, 'tele 0,50,53,51,28');

// settings BEFORE start: smoke route, floor 90%, small cap (raw-string form of Settings.save)
await page.evaluate(() => {
    localStorage.setItem('rs2b0t:set:ShopRunner:route', 'smoke-varrock');
    localStorage.setItem('rs2b0t:set:ShopRunner:strategy', 'Floor %');
    localStorage.setItem('rs2b0t:set:ShopRunner:floorPct', '90');
    localStorage.setItem('rs2b0t:set:ShopRunner:maxGpPerLeg', '30000');
});

interface R { rs2b0t: { runner: { start(m: unknown): void; ctx?: { log: { msg: string }[] } }; registry: { get(n: string): unknown } } }
await page.evaluate(() => {
    const r = (globalThis as never as R).rs2b0t;
    r.runner.start(r.registry.get('ShopRunner'));
});

const logLines = (): Promise<string[]> => page.evaluate(() => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));

async function waitForLog(re: RegExp, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const hit = (await logLines()).find(l => re.test(l));
        if (hit) {
            return hit;
        }
        await new Promise(r => setTimeout(r, 1000));
    }
    fail(`timed out waiting for ${re}`);
}

// 1. withdrawal happens, is capped, and names the cluster
const withdraw = await waitForLog(/\[shoprun\] withdraw (\d+)gp cluster=varrock/, 120_000);
const amount = Number(/withdraw (\d+)gp/.exec(withdraw)![1]);
if (amount > 30_000) {
    fail(`withdrawal ${amount} exceeds maxGpPerLeg 30000`);
}
// 2. real purchases at Aubury (floor 90% leaves stock behind)
await waitForLog(/\[shoprun\] buy shop=runeshop item=\w+ n=\d+ spent=\d+/, 180_000);
// 3. haul + coins banked back
await waitForLog(/\[shoprun\] banked cluster=varrock/, 180_000);
// 4. the stock model now skips the cluster (skip log or idle — either proves it)
await waitForLog(/\[shoprun\] (skip cluster=varrock haul=\d+%|idle until ~)/, 60_000);

console.log('PASS: withdraw → buy → bank → model-driven skip');
await browser.close();
process.exit(0);
```

- [ ] **Step 2: Register the LONG timeout**

In `tools/run-all-smokes.ts`, add to the `LONG` record:

```ts
'shoprun-test': 600,
```

- [ ] **Step 3: Run it against the local engine**

Start the engine if not running (`~/code/rs2b2t-engine`, see docs/DEV.md), then:
Run: `bun run build:bot && bun tools/shoprun-test.ts`
Expected: `PASS: withdraw → buy → bank → model-driven skip`, exit 0. Debug loop: re-run with `headless: false` temporarily; every failure path prints the awaited regex.

- [ ] **Step 4: Gate and commit**

Run: `bunx tsc --noEmit && bunx eslint tools/shoprun-test.ts && bun test`

```bash
git add tools/shoprun-test.ts tools/run-all-smokes.ts
git commit -m "test(shops): ShopRunner local-engine smoke — withdraw/buy/bank/skip leg

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Green sweep

**Files:** none new — verification only (fix-forward anything found, amend the responsible area with its own commit).

- [ ] **Step 1: Full local gates**

Run, each expected clean/green:
```
bunx tsc --noEmit
bun test
bun tools/shops/gen-shopdb.ts --check
bun run build:bot && bun tools/nav/coverage.ts
```

- [ ] **Step 2: Smoke suite**

Run: `bun tools/run-all-smokes.ts --only shoprun`
Expected: `shoprun-test` PASS within 600 s.
Then confirm no regressions in the closest neighbors: `bun tools/run-all-smokes.ts --only shop` (picks up `shop-test` + `shoprun-test`).

- [ ] **Step 3: Report**

Summarize: tests added vs the 319 baseline, coverage-gate corrections made to stand tiles (if any), smoke wall time, and what live verification on rs2b2t should watch (first F2P lap Varrock ⇄ Port Sarim; withdrawal sizes vs `maxGpPerLeg`; skip cadence on death runes). Live verification itself is a follow-up outside this plan.

---

## Self-review notes (already applied)

- Spec coverage: generator+drift (Task 2), baked baselines for floor strategy (Tasks 2/3), restock-aware skips + idle (Tasks 5/8), selectable strategy incl. per-item override (Tasks 4/7), capped budgets ×1.25 round-1k (Task 4), deposit-all/withdraw-exact banking + gp stop floor (Task 8), per-account eligibility + cheapest-unmet-gate stop (Tasks 4/7), cooldown skip-not-wedge (Tasks 5/8), seen persistence per account (Task 7), nav coverage of every new stand (Task 6), smoke incl. model-driven skip via Aubury-only route (Task 9), stackable/baseline-0 guards (route integrity test, Task 6).
- Type consistency: `Decision`/`ClusterPlan`/`RuntimeState`/`PlanOutcome` names match across Tasks 5/7/8; settings keys match Task 7 schema ↔ Task 9 localStorage writes; log shapes in Task 8 ↔ Task 9 regexes.
- Known judgment calls: `NavPointLike` structural tile keeps pure modules client-free; haulFraction is pre-trim by design; baseline-0 stock (Hickton's steel+ arrows) is excluded from planning rather than bought opportunistically; the spec's standalone `Travel` task is folded into each leg (`walkNear` at the top of BankLeg/BuyLeg/Idle, the EssMiner pattern) — same behavior, one fewer moving part; the smoke uses floor 90 (not the user-facing default) purely to bound purchase volume against the smoke timeout.
