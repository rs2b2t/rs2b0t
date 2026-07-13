/**
 * ShopRunner — world shop-run supply loop (spec:
 * docs/superpowers/specs/2026-07-13-shop-runner-design.md). Cycles shop
 * clusters buying feathers/runes/arrows, banking between clusters with
 * capped withdrawals; a pure Planner (decide()) picks every next action, so
 * the bot recovers from any position by re-planning.
 */
import { Bank } from '../api/hud/Bank.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Quests } from '../api/hud/Quests.js';
import { Shop } from '../api/hud/Shop.js';
import { Skills } from '../api/hud/Skills.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { Traversal } from '../api/Traversal.js';
import { TaskBot, type Task } from '../api/Bot.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { cheapestUnmetGate, clusterEligible, decide, type ClusterPlan, type PlanOutcome, type PlannerCfg } from '../shops/Planner.js';
import { SHOP_DB } from '../shops/data/shopdb.js';
import { ROUTE, SMOKE_ROUTE } from '../shops/data/route.js';
import type { AccountView, BuyPolicy, NavPointLike, Route, SeenMap } from '../shops/types.js';

export const SHOPRUNNER_SETTINGS: SettingsSchema = {
    strategy: { type: 'string', default: 'Buyout', options: ['Buyout', 'Floor %'], label: 'Buy strategy', help: 'Buyout empties the stock; Floor % buys down to floorPct of each shop\'s baseline (per-item overrides in route data win)' },
    floorPct: { type: 'number', default: 50, min: 1, max: 99, label: 'Floor % of baseline', help: 'only used when strategy = Floor %' },
    haulThreshold: { type: 'number', default: 25, min: 1, max: 100, label: 'Min haul % to visit', help: 'a cluster is skipped until its predicted haul reaches this fraction of a full haul' },
    maxGpPerLeg: { type: 'number', default: 100_000, min: 1000, label: 'Max gp per withdrawal', help: 'hard cap on any single coin withdrawal; plans are trimmed to fit' },
    stopFloorGp: { type: 'number', default: 5000, min: 0, label: 'Stop below bank gp', help: 'clean stop when the bank runs dry' },
    membersWorld: { type: 'boolean', default: true, label: 'Members world', help: 'gates members clusters; a wrong value degrades to logged skips' },
    route: { type: 'string', default: 'live', options: ['live', 'smoke-varrock'], label: 'Route', help: 'smoke-varrock is the Aubury-only test route' }
};

const SEEN_KEY_PREFIX = 'rs2b0t:shoprun:seen:';
const hasStorage = typeof localStorage !== 'undefined';
/** Shop-open failure cooldown: skip a shop this long after 3 consecutive open failures. */
const COOLDOWN_MS = 10 * 60_000;

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

    /** The full action set: dialogs first, then the three legs — exactly one
     *  validates per tick, gated on the recomputed decision kind. */
    protected addTasks(): void {
        this.add(new ContinueDialog(), new BankLeg(this), new BuyLeg(this), new IdleAtBank(this));
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

/** Nothing qualifies: hover at the bank and, once a minute, log a countdown to
 *  the next predicted restock so the run stays visibly alive. */
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
