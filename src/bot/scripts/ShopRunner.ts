/**
 * ShopRunner — world shop-run supply loop (spec:
 * docs/superpowers/specs/2026-07-13-shop-runner-design.md). Cycles shop
 * clusters buying feathers/runes/arrows, banking between clusters with
 * capped withdrawals; a pure Planner (decide()) picks every next action, so
 * the bot recovers from any position by re-planning.
 */
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Quests } from '../api/hud/Quests.js';
import { Skills } from '../api/hud/Skills.js';
import { Game } from '../api/Game.js';
import { TaskBot, type Task } from '../api/Bot.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { cheapestUnmetGate, clusterEligible, decide, type ClusterPlan, type PlanOutcome, type PlannerCfg } from '../shops/Planner.js';
import { SHOP_DB } from '../shops/data/shopdb.js';
import { ROUTE, SMOKE_ROUTE } from '../shops/data/route.js';
import type { AccountView, BuyPolicy, Route, SeenMap } from '../shops/types.js';

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
