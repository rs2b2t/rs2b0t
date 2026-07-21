/**
 * ShopRunner — world shop-run supply loop (spec in git history:
 * 2026-07-13-shop-runner-design). Cycles shop
 * clusters buying feathers/runes/arrows, banking between clusters with
 * capped withdrawals; a pure Planner (decide()) picks every next action, so
 * the bot recovers from any position by re-planning.
 */
import { Bank } from '../api/hud/Bank.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Paint } from '../api/hud/Paint.js';
import { Quests } from '../api/hud/Quests.js';
import { Shop } from '../api/hud/Shop.js';
import { Skills } from '../api/hud/Skills.js';
import { Game } from '../api/Game.js';
import { Traversal } from '../api/Traversal.js';
import { TaskBot, type Task } from '../api/Bot.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { BUDGET_BUFFER, cheapestUnmetGate, clusterEligible, decide, filterRouteBuys, planCluster, type ClusterPlan, type PlanOutcome, type PlannerCfg } from '../shops/Planner.js';
import { SHOP_DB } from '../shops/data/shopdb.js';
import { ROUTE, SMOKE_ROUTE } from '../shops/data/route.js';
import type { AccountView, BuyPolicy, NavPointLike, Route, SeenMap } from '../shops/types.js';
import { fmtDuration } from '../api/hud/paintLogic.js';

/** Every distinct display name the live route can buy — the buyItems options. */
const BUYABLE_NAMES: string[] = [...new Set(
    ROUTE.clusters.flatMap(c => c.shops.flatMap(s => s.buys.map(b => SHOP_DB[s.shopId]?.items.find(i => i.obj === b.obj)?.name).filter((n): n is string => n !== undefined)))
)].sort();

export const SHOPRUNNER_SETTINGS: SettingsSchema = {
    buyItems: { type: 'string[]', default: BUYABLE_NAMES, options: BUYABLE_NAMES, label: 'Items to buy', help: 'multi-select — shops with none of the selected items are skipped; deselect everything and the bot stops at start' },
    strategy: { type: 'string', default: 'Buyout', options: ['Buyout', 'Floor %'], label: 'Buy strategy', help: 'Buyout empties the stock; Floor % buys down to floorPct of each shop\'s baseline (per-item overrides in route data win)' },
    floorPct: { type: 'number', default: 50, min: 1, max: 99, label: 'Floor % of baseline', help: 'only used when strategy = Floor %' },
    haulThreshold: { type: 'number', default: 25, min: 1, max: 100, label: 'Min haul % to visit', help: 'a cluster is skipped until its predicted haul reaches this fraction of a full haul' },
    maxGpPerLeg: { type: 'number', default: 100_000, min: 1000, label: 'Max gp per withdrawal', help: 'hard cap on any single coin withdrawal; plans are trimmed to fit' },
    stopFloorGp: { type: 'number', default: 5000, min: 0, label: 'Stop below bank gp', help: 'clean stop when the bank runs dry' },
    route: { type: 'string', default: 'live', options: ['live', 'smoke-varrock'], label: 'Route', help: 'smoke-varrock is the Aubury-only test route' }
};

const STATE_KEY_PREFIX = 'rs2b0t:shoprun:state:';
const hasStorage = typeof localStorage !== 'undefined';
/** Shop-open failure cooldown: skip a shop this long after 3 consecutive open failures. */
const COOLDOWN_MS = 10 * 60_000;
/** Idle shuffle cadence — a legit idle stands still for 10min–hours, but the
 *  Supervisor watchdog treats "no tile change AND no xp for WEDGE_MS (10min)"
 *  as wedged and restarts us. Move one tile this often (MUST stay < WEDGE_MS)
 *  so tile-change progress detection keeps the watchdog quiet. */
const IDLE_SHUFFLE_MS = 5 * 60_000;

/** Per-account persisted runner state — survives the watchdog's stop+restart
 *  (a fresh instance reloads this; session stats/`fundedPlan` legitimately reset).
 *  `seen` alone was persisted before Task-12; `cooldowns`/`lastClusterId` are
 *  in-memory-only otherwise, so a restart would re-hammer a cooled shop and
 *  lose the ring position. */
interface RunnerState {
    seen: SeenMap;
    cooldowns: Record<string, number>;
    lastClusterId: string | null;
}

export class ShopRunner extends TaskBot {
    override loopDelay = 600;

    route: Route = ROUTE;
    cfg: PlannerCfg = { defaultPolicy: { kind: 'buyout' }, haulThresholdPct: 25, maxGpPerLeg: 100_000 };
    stopFloorGp = 5000;

    seen: SeenMap = {};
    cooldowns: Record<string, number> = {};
    fundedPlan: ClusterPlan | null = null;
    visited: string[] = [];
    lastClusterId: string | null = null;
    decision: PlanOutcome | null = null;

    /** Bumped by recordSeen / cooldown writes / loadState. loop() reuses an
     *  unexpired idle decision while this is unchanged (F2 wake-scan memo). */
    stateVersion = 0;
    /** stateVersion snapshot from when `decision` was last computed. */
    private decisionStateVersion = -1;
    /** Most recent skip reason logged by BankLeg (`cluster=… haul=…`); overlay only. */
    lastSkip: string | null = null;

    /** lowercase display names of everything the route can buy (deposit filter / carrying check) */
    buyNames = new Set<string>();
    status = 'starting';
    sessionHaul: Record<string, number> = {};
    sessionSpent = 0;
    startedAt = Date.now();

    override async onStart(): Promise<void> {
        this.startedAt = Date.now();
        const strategy = this.settings.str('strategy', 'Buyout');
        const policy: BuyPolicy = strategy === 'Floor %' ? { kind: 'floor', pct: this.settings.num('floorPct', 50) } : { kind: 'buyout' };
        this.cfg = {
            defaultPolicy: policy,
            haulThresholdPct: this.settings.num('haulThreshold', 25),
            maxGpPerLeg: this.settings.num('maxGpPerLeg', 100_000)
        };
        this.stopFloorGp = this.settings.num('stopFloorGp', 5000);
        this.route = this.settings.str('route', 'live') === 'smoke-varrock' ? SMOKE_ROUTE : ROUTE;

        const chosen = new Set(this.settings.list('buyItems', BUYABLE_NAMES).map(s => s.toLowerCase()));
        this.route = filterRouteBuys(this.route, SHOP_DB, chosen);
        if (this.route.clusters.every(c => c.shops.length === 0)) {
            this.log('[shoprun] stopping — no buy items selected (see the buyItems parameter)');
            ScriptRunner.stop();
            return;
        }

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
        this.loadState();
        this.addTasks();
    }

    /** The full action set: dialogs first, then the three legs — exactly one
     *  validates per tick, gated on the recomputed decision kind. */
    protected addTasks(): void {
        this.add(new ContinueDialog(), new BankLeg(this), new BuyLeg(this), new IdleAtBank(this));
    }

    override async loop(): Promise<number | void> {
        const now = Date.now();
        const cur = this.decision?.decision;
        // Idle wake-scan is expensive: earliestQualifyMs scans up to 480
        // one-minute steps when nothing qualifies. While idling, the plan
        // cannot change until the clock reaches untilMs OR observed stock /
        // cooldowns move (stateVersion) — so reuse the decision instead of
        // re-scanning every 600ms tick. All other decide() inputs are static
        // during a hover (position, gp, funded plan, visited).
        const idleMemoValid = cur?.kind === 'idle' && now < cur.untilMs && this.stateVersion === this.decisionStateVersion;
        if (!idleMemoValid) {
            this.decision = decide(
                this.route, SHOP_DB, this.seen, now, this.cfg, this.accountView(), this.cooldowns,
                {
                    pos: Game.tile(),
                    gpHeld: Inventory.count('Coins'),
                    carryingPurchases: Inventory.items().some(i => i.name !== null && this.buyNames.has(i.name.toLowerCase())),
                    fundedPlan: this.fundedPlan,
                    visited: this.visited,
                    lastClusterId: this.lastClusterId
                }
            );
            this.decisionStateVersion = this.stateVersion;
        }
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
        return { qp: Quests.points(), quests, skills };
    }

    stateKey(): string | null {
        const name = Game.myName();
        return name ? `${STATE_KEY_PREFIX}${name.toLowerCase()}` : null;
    }

    loadState(): void {
        const key = this.stateKey();
        if (!hasStorage || !key) {
            return;
        }
        try {
            const blob = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<RunnerState>;
            this.seen = blob.seen ?? {};
            this.cooldowns = blob.cooldowns ?? {};
            this.lastClusterId = blob.lastClusterId ?? null;
        } catch {
            this.seen = {};
            this.cooldowns = {};
            this.lastClusterId = null;
        }
        // Prune cooldowns that already elapsed so a stale blob can't keep an
        // open shop suppressed after a restart.
        const now = Date.now();
        for (const [id, untilMs] of Object.entries(this.cooldowns)) {
            if (untilMs <= now) {
                delete this.cooldowns[id];
            }
        }
        this.stateVersion++;
    }

    saveState(): void {
        const key = this.stateKey();
        if (hasStorage && key) {
            const blob: RunnerState = { seen: this.seen, cooldowns: this.cooldowns, lastClusterId: this.lastClusterId };
            localStorage.setItem(key, JSON.stringify(blob));
        }
    }

    recordSeen(shopId: string, obj: string, count: number): void {
        (this.seen[shopId] ??= {})[obj] = { count, atMs: Date.now() };
        this.stateVersion++;
    }

    /** Overlay's next-stop line, derived live from the current decision
     *  (spec §Overlay: "stop <cur> → next <id>"). */
    private nextStopLabel(): string {
        const d = this.decision?.decision;
        if (!d) {
            return '—';
        }
        if (d.kind === 'buy') {
            return `buy ${d.clusterId}`;
        }
        if (d.kind === 'bank') {
            return `bank ${d.clusterId} fund=${d.withdrawFor?.clusterId ?? 'none'}`;
        }
        return `idle best=${d.bestClusterId ?? 'none'}`;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#8be9fd' });
        p.title(`ShopRunner — ${this.status}`);

        const tab = p.tabs('sr', ['Overview', 'Route']);
        if (tab === 'Overview') {
            const mins = (Date.now() - this.startedAt) / 60_000;
            p.row(`Runtime: ${fmtDuration(mins)}`, `Gp held: ${Inventory.count('Coins')}`);
            p.row(`Spent: ${this.sessionSpent}`);
            p.text(`stop → ${this.nextStopLabel()}`);
        } else {
            const haul = Object.entries(this.sessionHaul).sort((a, b) => b[1] - a[1]);
            if (haul.length === 0) {
                p.text('no haul yet', '#8a919a');
            }
            for (let i = 0; i < haul.length; i += 2) {
                p.row(...haul.slice(i, i + 2).map(([k, v]) => `${k} +${v}`));
            }
            p.text(`last skip: ${this.lastSkip ?? '—'}`, '#8a919a');
        }

        p.gap();
        // Pause/Stop only — the route/plan is a funded multi-leg transaction; a
        // mid-run route or strategy switch would corrupt the in-flight plan.
        ScriptRunner.paintControls(p);
        p.end();
    }
}

const cheb = (a: NavPointLike, b: NavPointLike): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

/** Web-walk to within `radius` of `dest` and stop — the bank open (OPLOC) and
 *  shop trade (OPNPC) each server-walk the final step, so reaching the precise
 *  stand tile is never required. No-op when already close enough. */
async function walkNear(bot: ShopRunner, dest: NavPointLike, radius = 2): Promise<void> {
    const here = Game.tile();
    if (here && cheb(here, dest) <= radius) {
        return;
    }
    await Traversal.walkResilient({ x: dest.x, z: dest.z, level: dest.level }, { radius, attempts: 6, timeoutMs: 240_000, log: m => bot.log(`  ${m}`) });
}

/** Bank HERE: deposit the haul (settling the funded plan the instant it lands),
 *  log skipped clusters, stop cleanly if the bank is dry, then withdraw coins
 *  for the NEXT target — `withdrawFor` may fund a DIFFERENT cluster than the one
 *  we physically bank at (`d.stand`/`d.clusterId`). */
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
            bot.saveState(); // ring position must survive a watchdog restart
        }
        for (const s of bot.decision!.skipped) {
            bot.lastSkip = `cluster=${s.clusterId} haul=${s.fractionPct}%<${bot.cfg.haulThresholdPct}%`;
            bot.log(`[shoprun] skip ${bot.lastSkip}`);
        }
        const bankGp = Bank.count('Coins');
        if (bankGp < bot.stopFloorGp) {
            bot.log(`[shoprun] stopping — out of operating gp (bank ${bankGp} < floor ${bot.stopFloorGp})`);
            ScriptRunner.stop();
            return;
        }
        if (d.withdrawFor && d.withdrawFor.budget > 0) {
            // Bank.withdrawX already blocks until the pack gains the coins.
            if (!(await Bank.withdrawX('Coins', d.withdrawFor.budget))) {
                bot.log('[shoprun] coin withdrawal failed — will retry');
                return;
            }
            bot.log(`[shoprun] withdraw ${d.withdrawFor.budget}gp cluster=${d.withdrawFor.clusterId}`);
            if (d.withdrawFor.trimmed.length > 0) {
                bot.log(`[shoprun] gp cap ${bot.cfg.maxGpPerLeg} trims this leg: ${d.withdrawFor.trimmed.join(', ')} — raise maxGpPerLeg or narrow buyItems to prioritize them`);
            }
            bot.fundedPlan = d.withdrawFor;
            bot.visited = [];
        }
    }
}

/** Buy HERE: open the shop (cooling it 10m after 3 straight open failures),
 *  record observed stock (world-shared) on arrival AND after buying, then buy
 *  each wanted item in priority order, tallying spend + haul. */
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
                bot.cooldowns[shop.shopId] = Date.now() + COOLDOWN_MS;
                bot.visited.push(shop.shopId);
                this.openFails[shop.shopId] = 0;
                bot.stateVersion++;
                bot.saveState(); // cooldown must survive a watchdog restart, and re-plan the wake scan
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

        // RE-PLAN from what the open shop actually holds: the funded plan was
        // priced off predictions (baseline on a first visit), and the world-
        // shared stock can be nothing like it — the live wall once withdrew
        // 100k for a plan whose real stock was 210 fire runes and a feather.
        // record() just wrote the live counts into `seen`, so re-planning the
        // cluster now re-allocates the remaining coins against reality (and
        // against corrected numbers for shops visited earlier this leg).
        const coins = Inventory.count('Coins');
        const replanned = planCluster(
            bot.route.clusters.find(c => c.shops.some(s => s.shopId === shop.shopId)) ?? { id: '?', bank: { stand: shop.stand, boothName: '', boothOp: '' }, shops: [], gates: [] },
            SHOP_DB, bot.seen, Date.now(),
            { ...bot.cfg, maxGpPerLeg: Math.min(bot.cfg.maxGpPerLeg, Math.floor(coins * BUDGET_BUFFER)) },
            bot.cooldowns
        ).shops.find(s => s.shopId === shop.shopId);
        const items = replanned?.items ?? shop.items;
        const stale = shop.items.map(i => `${i.obj}:${i.units}`).join(' ');
        const fresh = items.map(i => `${i.obj}:${i.units}`).join(' ');
        if (fresh !== stale) {
            bot.log(`[shoprun] re-planned ${shop.shopId} from live stock: ${fresh || '(nothing worth buying)'} (funded plan said: ${stale})`);
        }

        for (const want of items) {
            if (want.units <= 0) {
                continue;
            }
            const gpBefore = Inventory.count('Coins');
            const bought = await Shop.buy(want.name, want.units);
            const spent = gpBefore - Inventory.count('Coins');
            if (bought === 0) {
                bot.log(`[shoprun] buy shop=${shop.shopId} item=${want.obj} n=0 of ${want.units} — stock empty or coins short`);
            }
            if (bought > 0) {
                bot.sessionHaul[want.obj] = (bot.sessionHaul[want.obj] ?? 0) + bought;
                bot.sessionSpent += spent;
                bot.log(`[shoprun] buy shop=${shop.shopId} item=${want.obj} n=${bought} spent=${spent}`);
            }
        }
        record(); // post-buy leftovers are the next prediction's anchor
        bot.saveState();
        await Shop.close();
        bot.visited.push(shop.shopId);
    }
}

/** Nothing qualifies: hover at the bank and, once a minute, log a countdown to
 *  the next predicted restock so the run stays visibly alive. */
class IdleAtBank implements Task {
    private lastIdleLogMs = 0;
    private lastShuffleMs = 0;
    private shuffled = false;
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
        // Shuffle one tile every IDLE_SHUFFLE_MS so the Supervisor watchdog's
        // tile-change progress detector keeps resetting — a motionless hover
        // reads as wedged and gets restarted. Alternate stand ↔ stand.x+1;
        // walkNear(…, 0) forces the exact tile so the move actually registers.
        // Failure is benign: persisted state (F1a) survives a restart anyway.
        if (now - this.lastShuffleMs > IDLE_SHUFFLE_MS) {
            this.lastShuffleMs = now;
            this.shuffled = !this.shuffled;
            await walkNear(bot, this.shuffled ? { ...d.stand, x: d.stand.x + 1 } : d.stand, 0);
        }
        if (now - this.lastIdleLogMs > 60_000) {
            this.lastIdleLogMs = now;
            const remain = Math.max(0, d.untilMs - now);
            const mm = String(Math.floor(remain / 60_000)).padStart(2, '0');
            const ss = String(Math.floor((remain % 60_000) / 1000)).padStart(2, '0');
            bot.log(`[shoprun] idle until ~${mm}:${ss} best=${d.bestClusterId ?? 'none'} ${d.bestFractionPct}%`);
        }
    }
}
