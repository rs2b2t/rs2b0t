import { Bank } from '../api/hud/Bank.js';
import { Equipment } from '../api/hud/Equipment.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Paint } from '../api/hud/Paint.js';
import { Quests } from '../api/hud/Quests.js';
import { Shop } from '../api/hud/Shop.js';
import { Skills } from '../api/hud/Skills.js';
import { EventSignal } from '../api/EventSignal.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { Traversal } from '../api/Traversal.js';
import { TaskBot, type Task } from '../api/Bot.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { talkThrough } from '../quests/exec/primitives.js';
import { buyoutPlan } from '../shops/BuyoutLogic.js';
import { clusterEligible, estimateClusterGp, nextCluster, withdrawFor } from '../shops/RingLogic.js';
import { SHOP_DB } from '../shops/data/shopdb.js';
import { ROUTE, SMOKE_ROUTE } from '../shops/data/route.js';
import type { AccountView, NavPointLike, Route, RouteCluster } from '../shops/types.js';
import { fmtDuration } from '../api/hud/paintLogic.js';

const BUYABLE_NAMES: string[] = [...new Set(
    ROUTE.clusters.flatMap(c => c.shops.flatMap(s => s.buys.map(b => SHOP_DB[s.shopId]?.items.find(i => i.obj === b.obj)?.name).filter((n): n is string => n !== undefined)))
)].sort();

export const SHOPRUNNER_SETTINGS: SettingsSchema = {
    buyItems: { type: 'string[]', default: BUYABLE_NAMES, options: BUYABLE_NAMES, label: 'Items to buy', help: 'multi-select — shops with none of the selected items are skipped' },
    gpBufferPct: { type: 'number', default: 25, min: 0, max: 100, label: 'Gp buffer %', help: 'withdraw the cluster buyout estimate plus this margin' },
    maxGpPerLeg: { type: 'number', default: 100_000, min: 1000, label: 'Max gp per withdrawal' },
    stopFloorGp: { type: 'number', default: 5000, min: 0, label: 'Stop below bank gp', help: 'clean stop when the bank runs dry' },
    mageArena: { type: 'boolean', default: true, label: 'Mage Arena leg', help: 'the deep-wilderness Lundail buyout (knife-only protocol)' },
    route: { type: 'string', default: 'live', options: ['live', 'smoke-varrock'], label: 'Route', help: 'smoke-varrock is the Aubury-only test route' }
};

const STATE_KEY_PREFIX = 'rs2b0t:shoprun:state:';
const hasStorage = typeof localStorage !== 'undefined';
const COOLDOWN_MS = 10 * 60_000;

interface RunnerState { lastClusterId: string | null }

export class ShopRunner extends TaskBot {
    override loopDelay = 600;

    route: Route = ROUTE;
    chosen = new Set<string>();
    buyNames = new Set<string>();
    gpBufferPct = 25;
    maxGpPerLeg = 100_000;
    stopFloorGp = 5000;
    toggles: Record<string, boolean> = {};

    lastClusterId: string | null = null;
    cooldowns: Record<string, number> = {};
    openFails: Record<string, number> = {};

    status = 'starting';
    sessionHaul: Record<string, number> = {};
    sessionSpent = 0;
    startedAt = Date.now();

    override async onStart(): Promise<void> {
        this.startedAt = Date.now();
        this.gpBufferPct = this.settings.num('gpBufferPct', 25);
        this.maxGpPerLeg = this.settings.num('maxGpPerLeg', 100_000);
        this.stopFloorGp = this.settings.num('stopFloorGp', 5000);
        this.toggles = { mageArena: this.settings.bool('mageArena', true) };
        this.route = this.settings.str('route', 'live') === 'smoke-varrock' ? SMOKE_ROUTE : ROUTE;
        this.chosen = new Set(this.settings.list('buyItems', BUYABLE_NAMES).map(s => s.toLowerCase()));

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
        if (this.chosen.size === 0) {
            this.log('[shoprun] stopping — no buy items selected');
            ScriptRunner.stop();
            return;
        }
        const acct = this.accountView();
        if (!this.route.clusters.some(c => clusterEligible(c, acct, this.toggles))) {
            this.log('[shoprun] stopping — no eligible clusters for this account');
            ScriptRunner.stop();
            return;
        }
        this.loadState();
        this.add(new ContinueDialog(), new RunCluster(this));
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
            this.lastClusterId = blob.lastClusterId ?? null;
        } catch {
            this.lastClusterId = null;
        }
    }
    saveState(): void {
        const key = this.stateKey();
        if (hasStorage && key) {
            localStorage.setItem(key, JSON.stringify({ lastClusterId: this.lastClusterId } satisfies RunnerState));
        }
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#8be9fd' });
        p.title(`ShopRunner — ${this.status}`);
        const tab = p.tabs('sr', ['Overview', 'Haul']);
        if (tab === 'Overview') {
            const mins = (Date.now() - this.startedAt) / 60_000;
            p.row(`Runtime: ${fmtDuration(mins)}`, `Gp held: ${Inventory.count('Coins')}`);
            p.row(`Spent: ${this.sessionSpent}`, `Last stop: ${this.lastClusterId ?? '—'}`);
        } else {
            const haul = Object.entries(this.sessionHaul).sort((a, b) => b[1] - a[1]);
            if (haul.length === 0) {
                p.text('no haul yet', '#8a919a');
            }
            for (let i = 0; i < haul.length; i += 2) {
                p.row(...haul.slice(i, i + 2).map(([k, v]) => `${k} +${v}`));
            }
        }
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}

const cheb = (a: NavPointLike, b: NavPointLike): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

async function walkNear(bot: ShopRunner, dest: NavPointLike, radius = 2): Promise<boolean> {
    const here = Game.tile();
    if (here && here.level === dest.level && cheb(here, dest) <= radius) {
        return true;
    }
    return Traversal.walkResilient({ x: dest.x, z: dest.z, level: dest.level }, { radius, attempts: 6, timeoutMs: 240_000, log: m => bot.log(`  ${m}`) });
}

async function openNpcBank(bot: ShopRunner, banker: string): Promise<boolean> {
    if (Bank.isOpen()) {
        return true;
    }
    await talkThrough(banker, ['access my bank'], m => bot.log(`  ${m}`));
    return Execution.delayUntil(() => Bank.isOpen(), 4000);
}

class RunCluster implements Task {
    constructor(private readonly bot: ShopRunner) {}
    validate(): boolean { return true; }

    async execute(): Promise<void> {
        const bot = this.bot;
        const cluster = nextCluster(bot.route, bot.lastClusterId, bot.accountView(), bot.toggles);
        if (!cluster) {
            bot.log('[shoprun] no eligible cluster on the ring — stopping');
            ScriptRunner.stop();
            return;
        }

        bot.status = `banking for ${cluster.id}`;
        if (!(await walkNear(bot, cluster.bank.stand))) {
            return;
        }
        if (!(await Bank.openNearest(cluster.bank.boothName, cluster.bank.boothOp, m => bot.log(`  ${m}`)))) {
            bot.log('[shoprun] bank open failed — will retry');
            return;
        }
        const keep = new Set((cluster.keep ?? []).map(s => s.toLowerCase()));
        await Bank.depositAllMatching(name => name.length > 0 && !keep.has(name.toLowerCase()));

        for (const item of cluster.keep ?? []) {
            if (!Inventory.contains(item) && !Equipment.contains(item)) {
                if (!(await Bank.withdrawX(item, 1))) {
                    bot.log(`[shoprun] ${cluster.id} needs a ${item} and the bank has none — skipping the cluster`);
                    bot.lastClusterId = cluster.id;
                    bot.saveState();
                    return;
                }
            }
        }

        const bankGp = Bank.count('Coins');
        if (bankGp < bot.stopFloorGp) {
            bot.log(`[shoprun] stopping — out of operating gp (bank ${bankGp} < floor ${bot.stopFloorGp})`);
            ScriptRunner.stop();
            return;
        }
        const estimate = estimateClusterGp(cluster, SHOP_DB, bot.chosen);
        const want = withdrawFor(estimate, bot.gpBufferPct, bot.maxGpPerLeg);
        const held = Inventory.count('Coins');
        if (held < want) {
            const take = Math.min(want - held, bankGp);
            if (take > 0 && !(await Bank.withdrawX('Coins', take))) {
                bot.log('[shoprun] coin withdrawal failed — will retry');
                return;
            }
            bot.log(`[shoprun] ${cluster.id}: withdrew ${take}gp (estimate ${estimate} +${bot.gpBufferPct}%, cap ${bot.maxGpPerLeg})`);
        }

        for (const item of cluster.wield ?? []) {
            if (!Equipment.contains(item)) {
                await Equipment.equip(item);
            }
        }

        for (const wp of cluster.waypoints ?? []) {
            bot.status = `walking the ${cluster.id} route`;
            if (!(await walkNear(bot, wp, 4))) {
                return;
            }
            if (EventSignal.pending()) {
                return;
            }
        }
        const now = Date.now();
        for (const shop of cluster.shops) {
            if (EventSignal.pending()) {
                return;
            }
            if ((bot.cooldowns[shop.shopId] ?? 0) > now) {
                continue;
            }
            const rec = SHOP_DB[shop.shopId];
            const wanted = shop.buys.some(b => {
                const item = rec?.items.find(i => i.obj === b.obj);
                return item !== undefined && bot.chosen.has(item.name.toLowerCase());
            });
            if (!rec || !wanted) {
                continue;
            }
            bot.status = `buying at ${shop.shopId}`;
            if (!(await walkNear(bot, shop.stand))) {
                return;
            }
            if (!(await Shop.open(shop.keeperNpc))) {
                const fails = (bot.openFails[shop.shopId] ?? 0) + 1;
                bot.openFails[shop.shopId] = fails;
                if (fails >= 3) {
                    bot.cooldowns[shop.shopId] = Date.now() + COOLDOWN_MS;
                    bot.openFails[shop.shopId] = 0;
                    bot.log(`[shoprun] shop-open failed 3x — cooling ${shop.shopId} for 10m`);
                }
                return;
            }
            bot.openFails[shop.shopId] = 0;

            const stock: Record<string, number> = {};
            for (const row of Shop.stock()) {
                const item = rec.items.find(i => i.name.toLowerCase() === row.name.toLowerCase());
                if (item) {
                    stock[item.obj] = row.count;
                }
            }
            const routeObjs = new Set(shop.buys.map(b => b.obj));
            const plan = buyoutPlan(rec, stock, Inventory.count('Coins'), bot.chosen)
                .filter(p => routeObjs.has(p.obj));
            for (const want2 of plan) {
                const gpBefore = Inventory.count('Coins');
                const bought = await Shop.buy(want2.name, want2.units);
                const spent = gpBefore - Inventory.count('Coins');
                if (bought > 0) {
                    bot.sessionHaul[want2.obj] = (bot.sessionHaul[want2.obj] ?? 0) + bought;
                    bot.sessionSpent += spent;
                    bot.log(`[shoprun] buy shop=${shop.shopId} item=${want2.obj} n=${bought} spent=${spent}`);
                }
            }
            await Shop.close();
        }

        if (cluster.haulBank) {
            bot.status = `banking the haul with ${cluster.haulBank.banker}`;
            if (!(await walkNear(bot, cluster.haulBank.stand))) {
                return;
            }
            if (!(await openNpcBank(bot, cluster.haulBank.banker))) {
                bot.log('[shoprun] in-cellar bank failed — retrying next pass');
                return;
            }
            const keepOut = new Set((cluster.keep ?? []).map(s => s.toLowerCase()));
            await Bank.depositAllMatching(name => name.length > 0 && !keepOut.has(name.toLowerCase()));
        }

        bot.lastClusterId = cluster.id;
        bot.saveState();
        bot.log(`[shoprun] cluster ${cluster.id} done — advancing the ring`);
    }
}
