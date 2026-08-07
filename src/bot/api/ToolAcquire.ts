import Tile from './Tile.js';
import type { FishingGearPiece, FishingMethod } from './FishingMethods.js';
import { BROKEN_PICKAXE } from './MiningRocks.js';
import { AXES, HAMMER, PICKAXES, type ToolReq, type ToolTier } from './Tools.js';
import { Execution } from './Execution.js';
import { Game } from './Game.js';
import { Traversal } from './Traversal.js';
import { Locs } from './queries/Locs.js';

export { BROKEN_PICKAXE, HAMMER };

/** Coins stack name in inventory/bank. */
export const COINS = 'Coins';

/**
 * Broken axe — not always present on every private build, but when it is we
 * prefer Bob repair over buying another.
 */
export const BROKEN_AXE = 'Broken axe';

export type ToolAcquireMode = 'off' | 'on';

export function parseToolAcquireMode(raw: string | boolean | undefined | null): ToolAcquireMode {
    if (raw === true) {
        return 'on';
    }
    if (raw === false || raw == null) {
        return 'off';
    }
    const s = String(raw).trim().toLowerCase();
    if (s === 'on' || s === 'buy / repair' || s === 'buy/repair' || s === 'true' || s === 'yes') {
        return 'on';
    }
    return 'off';
}

export const TOOL_ACQUIRE_OPTIONS = ['Off', 'Buy / repair'] as const;

/** Shared settings fragment for Miner / Woodcutter / Fisher. */
export const TOOL_ACQUIRE_SETTING = {
    type: 'string' as const,
    default: 'Off',
    options: [...TOOL_ACQUIRE_OPTIONS],
    label: 'Acquire tools',
    group: 'Tools',
    help:
        'Off = only use tools already in the bank/pack. Buy / repair = when a usable tool is missing (or a better shop tier is affordable), withdraw coins and buy/repair at Bob (axes), Nurmof (pickaxes), Gerrant/Harry (fishing gear). Broken picks/axes prefer repair at Nurmof/Bob. Mithril+ axes can be smithed when a matching bar + hammer are in the bank.'
};

/**
 * Rare humanization: after a normal bank close, ~1/N chance to walk a few tiles
 * out and re-open as if something was forgotten. Off by default.
 */
export const FORGETFUL_BANK_ODDS = 100;

export const FORGETFUL_BANK_SETTING = {
    type: 'boolean' as const,
    default: false,
    label: 'Forgetful bank exits',
    group: 'Tools',
    help:
        `Rare humanization after closing the bank: about 1 in ${FORGETFUL_BANK_ODDS} chance to walk a few tiles away, re-open the bank as if you forgot something, then leave again. Off by default.`
};

export interface ToolVendor {
    keeper: string;
    stand: Tile;
    bankStand: Tile;
    /** Optional surface hop before underground walk (Nurmof). */
    hopFrom?: Tile;
    hopLoc?: string;
    hopAction?: string;
}

export interface ShopOffer {
    name: string;
    cost: number;
    vendor: ToolVendor;
}

/** Bob — Lumbridge axes (bronze–steel) + bronze pick. */
export const BOB_VENDOR: ToolVendor = {
    keeper: 'Bob',
    stand: new Tile(3231, 3203, 0),
    bankStand: new Tile(3093, 3243, 0) // Draynor
};

/** Nurmof — dwarven mine pickaxes (bronze–rune). */
export const NURMOF_VENDOR: ToolVendor = {
    keeper: 'Nurmof',
    stand: new Tile(2997, 9844, 0),
    bankStand: new Tile(3013, 3355, 0), // Falador East
    hopFrom: new Tile(3019, 3449, 0),
    hopLoc: 'Trapdoor',
    hopAction: 'Climb-down'
};

/** Gerrant — Port Sarim fishing (feathers, fly rod, bait, tools). */
export const GERRANT_VENDOR: ToolVendor = {
    keeper: 'Gerrant',
    stand: new Tile(3013, 3224, 0),
    bankStand: new Tile(3092, 3243, 0) // Draynor
};

/** Harry — Catherby fishing (bait, tools, big net; no feathers/fly rod). */
export const HARRY_VENDOR: ToolVendor = {
    keeper: 'Harry',
    stand: new Tile(2833, 3443, 0),
    bankStand: new Tile(2809, 3441, 0) // Catherby
};

/** Items only Gerrant stocks (Harry has no fly rod / feathers). */
export const GERRANT_ONLY_FISHING: ReadonlySet<string> = new Set(['feather', 'fly fishing rod']);

/** Varrock West anvil for mith+ axes. */
export const VARROCK_ANVIL_STAND = new Tile(3188, 3425, 0);
export const VARROCK_ANVIL_BANK = new Tile(3185, 3440, 0);

/** Shop list prices (from shopdb baselines). */
export const PICKAXE_SHOP_COSTS: Readonly<Record<string, number>> = {
    'Bronze pickaxe': 1,
    'Iron pickaxe': 140,
    'Steel pickaxe': 500,
    'Mithril pickaxe': 1300,
    'Adamant pickaxe': 3200,
    'Rune pickaxe': 32000
};

export const AXE_SHOP_COSTS: Readonly<Record<string, number>> = {
    'Bronze axe': 16,
    'Iron axe': 56,
    'Steel axe': 200
};

export const FISHING_SHOP_COSTS: Readonly<Record<string, number>> = {
    'Small fishing net': 5,
    'Fishing rod': 5,
    'Fly fishing rod': 5,
    Harpoon: 5,
    'Lobster pot': 20,
    'Big fishing net': 20,
    'Fishing bait': 3,
    Feather: 2
};

/** Smithing level required to make each axe on an anvil. */
export const AXE_SMITH_LEVEL: Readonly<Record<string, number>> = {
    'Bronze axe': 1,
    'Iron axe': 16,
    'Steel axe': 31,
    'Mithril axe': 51,
    'Adamant axe': 71,
    'Rune axe': 86
};

export const AXE_BAR_FOR: Readonly<Record<string, string>> = {
    'Bronze axe': 'Bronze bar',
    'Iron axe': 'Iron bar',
    'Steel axe': 'Steel bar',
    'Mithril axe': 'Mithril bar',
    'Adamant axe': 'Adamantite bar',
    'Rune axe': 'Runite bar'
};

export type ToolAcquirePlan =
    | {
          kind: 'repair';
          brokenName: string;
          label: 'pickaxe' | 'axe';
          vendor: ToolVendor;
          prefer: string[];
      }
    | {
          kind: 'buy';
          name: string;
          cost: number;
          qty: number;
          vendor: ToolVendor;
          equip: boolean;
          reason: string;
      }
    | {
          kind: 'smith';
          name: string;
          bar: string;
          smithLevel: number;
          vendorBank: Tile;
          anvilStand: Tile;
          equip: boolean;
          reason: string;
      };

export interface AcquireWorld {
    skillLevel: (skill: string) => number;
    /** Inv + worn count. */
    heldCount: (name: string) => number;
    invCount: (name: string) => number;
    bankCount: (name: string) => number;
    worn: (name: string) => boolean;
}

function totalCoins(w: Pick<AcquireWorld, 'invCount' | 'bankCount'>): number {
    return w.invCount(COINS) + w.bankCount(COINS);
}

function tierRank(tiers: readonly ToolTier[], name: string): number {
    const i = tiers.findIndex(t => t.name.toLowerCase() === name.toLowerCase());
    return i < 0 ? Number.POSITIVE_INFINITY : i;
}

/** Best tier the player can use that they already own (held or bank). */
export function bestOwnedTier(
    level: number,
    tiers: readonly ToolTier[],
    count: (name: string) => number
): string | null {
    for (const t of tiers) {
        if (level >= t.level && count(t.name) > 0) {
            return t.name;
        }
    }
    return null;
}

export function pickaxeShopOffers(): ShopOffer[] {
    return Object.entries(PICKAXE_SHOP_COSTS).map(([name, cost]) => ({
        name,
        cost,
        vendor: NURMOF_VENDOR
    }));
}

export function axeShopOffers(): ShopOffer[] {
    return Object.entries(AXE_SHOP_COSTS).map(([name, cost]) => ({
        name,
        cost,
        vendor: BOB_VENDOR
    }));
}

/**
 * Best shop offer the player can use and afford that is strictly better than
 * `owned` (or any usable tier when owned is null). Tiers are best-first.
 */
export function bestAffordableShopTier(
    level: number,
    tiers: readonly ToolTier[],
    offers: readonly ShopOffer[],
    coins: number,
    owned: string | null
): ShopOffer | null {
    const ownedRank = owned ? tierRank(tiers, owned) : Number.POSITIVE_INFINITY;
    let best: ShopOffer | null = null;
    let bestRank = Number.POSITIVE_INFINITY;
    for (const t of tiers) {
        if (level < t.level) {
            continue;
        }
        const rank = tierRank(tiers, t.name);
        if (rank >= ownedRank) {
            // same or worse than owned
            continue;
        }
        const offer = offers.find(o => o.name.toLowerCase() === t.name.toLowerCase());
        if (!offer || offer.cost > coins) {
            continue;
        }
        if (rank < bestRank) {
            best = offer;
            bestRank = rank;
        }
    }
    return best;
}

/**
 * Best axe we can smith from a bar already in bank/inv (mith+ or when Bob is dry).
 */
export function bestSmithableAxe(
    woodcuttingLevel: number,
    smithingLevel: number,
    owned: string | null,
    barCount: (barName: string) => number,
    hasHammer: boolean
): { name: string; bar: string; smithLevel: number } | null {
    if (!hasHammer) {
        return null;
    }
    const ownedRank = owned ? tierRank(AXES, owned) : Number.POSITIVE_INFINITY;
    for (const t of AXES) {
        if (woodcuttingLevel < t.level) {
            continue;
        }
        const rank = tierRank(AXES, t.name);
        if (rank >= ownedRank) {
            continue;
        }
        const needSmith = AXE_SMITH_LEVEL[t.name];
        const bar = AXE_BAR_FOR[t.name];
        if (needSmith == null || !bar || smithingLevel < needSmith) {
            continue;
        }
        if (barCount(bar) < 1) {
            continue;
        }
        return { name: t.name, bar, smithLevel: needSmith };
    }
    return null;
}

export function planBrokenToolRepair(
    heldOrWorn: (name: string) => boolean
): Extract<ToolAcquirePlan, { kind: 'repair' }> | null {
    if (heldOrWorn(BROKEN_PICKAXE)) {
        return {
            kind: 'repair',
            brokenName: BROKEN_PICKAXE,
            label: 'pickaxe',
            vendor: NURMOF_VENDOR,
            prefer: ['repair', 'fix', 'fix my', 'yes']
        };
    }
    if (heldOrWorn(BROKEN_AXE)) {
        return {
            kind: 'repair',
            brokenName: BROKEN_AXE,
            label: 'axe',
            vendor: BOB_VENDOR,
            prefer: ['repair', 'fix', 'fix my', 'yes']
        };
    }
    return null;
}

/**
 * Plan a pickaxe buy/repair when missing or when a better Nurmof tier is affordable.
 */
export function planPickaxeAcquire(w: AcquireWorld, opts: { upgrade: boolean }): ToolAcquirePlan | null {
    const repair = planBrokenToolRepair(n => w.heldCount(n) > 0);
    if (repair?.label === 'pickaxe') {
        return repair;
    }

    const level = w.skillLevel('mining');
    const owned = bestOwnedTier(level, PICKAXES, n => w.heldCount(n) + w.bankCount(n));
    if (owned && !opts.upgrade) {
        return null;
    }
    if (!owned || opts.upgrade) {
        const coins = totalCoins(w);
        const offer = bestAffordableShopTier(level, PICKAXES, pickaxeShopOffers(), coins, owned);
        if (offer) {
            return {
                kind: 'buy',
                name: offer.name,
                cost: offer.cost,
                qty: 1,
                vendor: offer.vendor,
                equip: true,
                reason: owned ? `upgrade ${owned} → ${offer.name}` : `buy ${offer.name}`
            };
        }
    }
    return null;
}

/**
 * Plan an axe buy/smith when missing or when a better tier is available.
 * Bob covers bronze–steel; mith+ uses bank bars + hammer at Varrock anvil.
 */
export function planAxeAcquire(w: AcquireWorld, opts: { upgrade: boolean }): ToolAcquirePlan | null {
    const repair = planBrokenToolRepair(n => w.heldCount(n) > 0);
    if (repair?.label === 'axe') {
        return repair;
    }

    const wc = w.skillLevel('woodcutting');
    const owned = bestOwnedTier(wc, AXES, n => w.heldCount(n) + w.bankCount(n));
    if (owned && !opts.upgrade) {
        return null;
    }

    const coins = totalCoins(w);
    const shop = bestAffordableShopTier(wc, AXES, axeShopOffers(), coins, owned);

    const smith = bestSmithableAxe(
        wc,
        w.skillLevel('smithing'),
        owned,
        bar => w.heldCount(bar) + w.bankCount(bar),
        w.heldCount(HAMMER) + w.bankCount(HAMMER) > 0
    );

    // Prefer the better of shop vs smith (lower tier rank = better).
    type Cand = { rank: number; plan: ToolAcquirePlan };
    const cands: Cand[] = [];
    if (shop) {
        cands.push({
            rank: tierRank(AXES, shop.name),
            plan: {
                kind: 'buy',
                name: shop.name,
                cost: shop.cost,
                qty: 1,
                vendor: shop.vendor,
                equip: true,
                reason: owned ? `upgrade ${owned} → ${shop.name}` : `buy ${shop.name}`
            }
        });
    }
    if (smith) {
        cands.push({
            rank: tierRank(AXES, smith.name),
            plan: {
                kind: 'smith',
                name: smith.name,
                bar: smith.bar,
                smithLevel: smith.smithLevel,
                vendorBank: VARROCK_ANVIL_BANK,
                anvilStand: VARROCK_ANVIL_STAND,
                equip: true,
                reason: owned ? `smith upgrade ${owned} → ${smith.name}` : `smith ${smith.name}`
            }
        });
    }
    cands.sort((a, b) => a.rank - b.rank);
    return cands[0]?.plan ?? null;
}

export interface FishingVendorNear {
    x: number;
    z: number;
}

/**
 * Preferred fishing vendor for a gear piece.
 * - Feathers / fly fishing rod → Gerrant only (Harry does not stock them).
 * - Everything else Harry stocks → nearest of Harry vs Gerrant by straight-line
 *   distance from `near` (Catherby lobster pot → Harry, not Port Sarim).
 * - No position: bait/big net still prefer Harry; other tools default Gerrant (F2P).
 */
export function fishingVendorFor(name: string, near?: FishingVendorNear | null): ToolVendor {
    const n = name.toLowerCase();
    if (GERRANT_ONLY_FISHING.has(n)) {
        return GERRANT_VENDOR;
    }
    if (near) {
        const dHarry = Math.hypot(near.x - HARRY_VENDOR.stand.x, near.z - HARRY_VENDOR.stand.z);
        const dGerrant = Math.hypot(near.x - GERRANT_VENDOR.stand.x, near.z - GERRANT_VENDOR.stand.z);
        return dHarry <= dGerrant ? HARRY_VENDOR : GERRANT_VENDOR;
    }
    if (n === 'fishing bait' || n === 'big fishing net') {
        return HARRY_VENDOR;
    }
    return GERRANT_VENDOR;
}

export function fishingShopCost(name: string): number | null {
    const hit = Object.entries(FISHING_SHOP_COSTS).find(([k]) => k.toLowerCase() === name.toLowerCase());
    return hit ? hit[1] : null;
}

/** True when the gear piece is a bait/feather stack (restock target applies). */
export function isFishingBaitPiece(g: Pick<FishingGearPiece, 'name' | 'restock'>): boolean {
    if (g.restock <= 1) {
        return false;
    }
    const n = g.name.toLowerCase();
    return n === 'fishing bait' || n === 'feather';
}

/**
 * Apply the script bait/feather target qty to method gear (tools unchanged).
 * Only used when the method actually requires bait/feathers.
 */
export function withBaitTarget(
    method: Pick<FishingMethod, 'gear'>,
    baitQty: number
): { gear: FishingGearPiece[] } {
    const target = Math.max(1, Math.floor(baitQty));
    return {
        gear: method.gear.map(g => (isFishingBaitPiece(g) ? { ...g, restock: target } : g))
    };
}

export interface PlanFishingGearOpts {
    /** Player / spot tile — picks Harry vs Gerrant by proximity. */
    near?: FishingVendorNear | null;
    /** Buy/restock target for bait & feathers when the method needs them. */
    baitQty?: number;
}

export type FishingGearBuyPlan = Extract<ToolAcquirePlan, { kind: 'buy' }>;

/**
 * Plan buys for every missing fishing gear piece that is buyable and affordable.
 * Order follows method.gear (tools before bait stacks when listed that way).
 *
 * Tools: buy when held+bank &lt; min (usually 1).
 * Bait/feathers: buy up to baitQty (or gear.restock) when total held+bank is below that target.
 */
export function planFishingGearBuys(
    method: Pick<FishingMethod, 'gear'>,
    w: AcquireWorld,
    opts: PlanFishingGearOpts = {}
): FishingGearBuyPlan[] {
    const gear = withBaitTarget(method, opts.baitQty ?? 1000).gear;
    const out: FishingGearBuyPlan[] = [];
    // Coins left after earlier lines in this cart (same bank trip / shop visit).
    let coinsLeft = totalCoins(w);
    for (const g of gear) {
        const have = w.heldCount(g.name) + w.bankCount(g.name);
        const needAtLeast = isFishingBaitPiece(g) ? g.restock : g.min;
        if (have >= needAtLeast) {
            continue;
        }
        const unit = fishingShopCost(g.name);
        if (unit == null) {
            continue;
        }
        const needQty = Math.max(1, needAtLeast - w.heldCount(g.name));
        // Bait/feathers: buy the full shortfall up to baitQty (unbounded setting).
        let qty = isFishingBaitPiece(g) ? Math.max(g.min, needQty) : 1;
        let cost = unit * qty;
        if (coinsLeft < cost) {
            // Partial bait stack if we can still afford at least one.
            if (qty > 1 && coinsLeft >= unit) {
                qty = Math.floor(coinsLeft / unit);
                cost = unit * qty;
            } else {
                continue;
            }
        }
        const vendor = fishingVendorFor(g.name, opts.near);
        out.push({
            kind: 'buy',
            name: g.name,
            cost,
            qty,
            vendor,
            equip: false,
            reason: `buy ${qty}× ${g.name}`
        });
        coinsLeft -= cost;
    }
    return out;
}

/**
 * First unmet buyable piece (compat / single-item callers).
 * Prefer {@link fishingGearShopCart} so rod+feathers share one shop visit.
 */
export function planFishingGearAcquire(
    method: Pick<FishingMethod, 'gear'>,
    w: AcquireWorld,
    opts: PlanFishingGearOpts = {}
): ToolAcquirePlan | null {
    return planFishingGearBuys(method, w, opts)[0] ?? null;
}

/** Sum of list prices for a multi-buy cart. */
export function buyPlansCost(plans: readonly Pick<FishingGearBuyPlan, 'cost'>[]): number {
    return plans.reduce((sum, p) => sum + p.cost, 0);
}

/**
 * All affordable missing pieces at the first piece's vendor (same keeper).
 * Fly rod + feathers → one Gerrant cart; avoids bank-between-buys thrash.
 */
export function fishingGearShopCart(
    method: Pick<FishingMethod, 'gear'>,
    w: AcquireWorld,
    opts: PlanFishingGearOpts = {}
): FishingGearBuyPlan[] {
    const all = planFishingGearBuys(method, w, opts);
    if (all.length === 0) {
        return [];
    }
    const keeper = all[0]!.vendor.keeper;
    return all.filter(p => p.vendor.keeper === keeper);
}

/**
 * Plan acquire for GatheringBot tool reqs (tiered pick/axe + ignore exact like tinderbox for shop).
 * `missingOnly` = only when no usable tool owned; otherwise also upgrade.
 */
export function planGatherToolAcquire(
    reqs: readonly ToolReq[],
    w: AcquireWorld,
    opts: { upgrade: boolean }
): ToolAcquirePlan | null {
    const repair = planBrokenToolRepair(n => w.heldCount(n) > 0);
    if (repair) {
        return repair;
    }

    for (const r of reqs) {
        if (r.kind !== 'tiered') {
            continue;
        }
        if (r.skill === 'mining') {
            const plan = planPickaxeAcquire(w, opts);
            if (plan) {
                return plan;
            }
        }
        if (r.skill === 'woodcutting') {
            const plan = planAxeAcquire(w, opts);
            if (plan) {
                return plan;
            }
        }
    }
    return null;
}

/** Coins to withdraw so inv holds at least `need` (already counting inv coins). */
export function coinsToWithdraw(need: number, invCoins: number): number {
    return Math.max(0, need - invCoins);
}

/** True when bank+inv can cover the plan's coin cost (smith = 0). */
export function canFundPlan(plan: ToolAcquirePlan, invCoins: number, bankCoins: number): boolean {
    if (plan.kind === 'repair' || plan.kind === 'smith') {
        return true;
    }
    return invCoins + bankCoins >= plan.cost;
}

/** Gear names to keep when depositing before a shop/repair trip. */
export function acquireKeepNames(plan: ToolAcquirePlan, extra: readonly string[] = []): string[] {
    const keep = new Set<string>([COINS, ...extra]);
    if (plan.kind === 'repair') {
        keep.add(plan.brokenName);
    }
    if (plan.kind === 'smith') {
        keep.add(plan.bar);
        keep.add(HAMMER);
    }
    return [...keep];
}

/** Missing fishing pieces that have a known shop price (for labels). */
export function shopableMissingFishingGear(
    gear: readonly FishingGearPiece[],
    count: (name: string) => number
): string[] {
    return gear.filter(g => count(g.name) < g.min && fishingShopCost(g.name) != null).map(g => g.name);
}

/**
 * Whether Nurmof (or another underground vendor) needs an explicit surface hop
 * before the stand walk. Pure geography — used by {@link walkToToolVendor}.
 */
export function needsToolVendorSurfaceHop(
    vendor: ToolVendor,
    here: { x: number; z: number; level: number } | null
): boolean {
    if (!vendor.hopFrom || !vendor.hopLoc || !vendor.hopAction || !here) {
        return false;
    }
    if (!(vendor.stand.z > 9000 && here.z < 9000)) {
        return false;
    }
    const dx = Math.abs(here.x - vendor.stand.x);
    const dz = Math.abs(here.z - vendor.stand.z);
    return Math.max(dx, dz) > 20;
}

/**
 * Walk to a tool vendor. Nurmof gets an explicit surface trapdoor hop when
 * still above ground so pathing does not stall at the mine entrance.
 * Lives in api/ so Miner/WC/Fisher scripts do not re-copy hop logic.
 */
export async function walkToToolVendor(
    vendor: ToolVendor,
    log: (m: string) => void = () => {}
): Promise<boolean> {
    let here = Game.tile();
    // Already underground (Nurmof stand plane) — skip surface hop.
    if (here && vendor.stand.z > 9000 && here.z > 9000) {
        return Traversal.walkResilient(vendor.stand, { radius: 4, timeoutMs: 120_000, log });
    }
    if (needsToolVendorSurfaceHop(vendor, here) && vendor.hopFrom && vendor.hopLoc && vendor.hopAction) {
        log(`acquire: hop ${vendor.hopLoc} @ ${vendor.hopFrom}`);
        if (!(await Traversal.walkResilient(vendor.hopFrom, { radius: 2, timeoutMs: 90_000, log }))) {
            return false;
        }
        here = Game.tile();
        // Walk may have pathfind-looped underground already — go straight to stand.
        if (here && here.z > 9000) {
            log('acquire: already underground after hop walk — skipping trapdoor');
            return Traversal.walkResilient(vendor.stand, { radius: 4, timeoutMs: 120_000, log });
        }

        const findHop = () =>
            Locs.query().name(vendor.hopLoc!).action(vendor.hopAction!).nearest()
            ?? Locs.query().name(vendor.hopLoc!).nearest();

        // Prefer action match; fall back to name-only (scene load / action list lag).
        let trap = findHop();
        if (!trap) {
            // Close in one more step on the hop pin, then re-query.
            await Traversal.walkResilient(vendor.hopFrom, { radius: 0, timeoutMs: 20_000, log });
            trap = findHop();
        }
        if (trap) {
            const op =
                trap.actions().includes(vendor.hopAction)
                    ? vendor.hopAction
                    : (trap.actions().find(a => /climb-down|enter|open/i.test(a)) ?? vendor.hopAction);
            // Two tries — first interact can miss after a long surface approach.
            for (let tryHop = 0; tryHop < 2; tryHop++) {
                log(`acquire: ${op} ${trap.name ?? vendor.hopLoc}${tryHop > 0 ? ' (retry)' : ''}`);
                await trap.interact(op);
                const entered = await Execution.delayUntilTicks(() => {
                    const t = Game.tile();
                    return t !== null && t.z >= 9000;
                }, 17);
                if (entered) {
                    break;
                }
                trap = findHop() ?? trap;
            }
            here = Game.tile();
            if (!here || here.z < 9000) {
                log(`acquire: ${vendor.hopLoc} hop did not enter dungeon — will path to stand`);
            }
        } else {
            log(`acquire: no ${vendor.hopLoc} in scene at hop — pathing to stand`);
        }
    }
    return Traversal.walkResilient(vendor.stand, { radius: 4, timeoutMs: 120_000, log });
}
