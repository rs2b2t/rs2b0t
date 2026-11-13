import { LoopingBot } from '../../api/bot/Bot.js';
import { Bank } from '../../api/bank/Bank.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Execution } from '../../api/execution/Execution.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Skills } from '../../api/skills/Skills.js';
import { Sustain } from '../../api/sustain/Sustain.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Quests } from '../../api/ui/questlog/Quests.js';
import Tile from '../../geometry/Tile.js';
import { Paint } from '../../paint/Paint.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import { reserveKey, SHADE_TIERS, spendableKeys } from './data.js';
import { CombatSupport, PRAYER_POTIONS } from './combat.js';
import { Expedition } from './expedition.js';
import { LootProcessor } from './loot.js';
import { MorttonShop } from './shop.js';
import type { Stock } from './policy.js';
import { Minigame } from './minigame.js';
import { chooseActivity, FOOD, type Activity } from './policy.js';
import { counts, held, Supplies } from './supply.js';
import { Temple } from './temple.js';

export default class ShadesOfMortton extends LoopingBot {
    status = 'checking prerequisites';
    activity: Activity['kind'] | 'bank' = 'bank';
    cycles = 0;
    get burns(): number { return this.minigame.stats.burned; }
    get chests(): number { return this.minigame.stats.chests; }
    private failures = 0;
    private died = false;
    private supply = new Supplies(message => this.log(message));
    private temple = new Temple(this.supply);
    private local = true;
    private prayer = true;
    private alch = false;
    private recoverAccess = false;
    private accessAttempts = 0;
    private bankedLoot: Stock | null = null;
    private combat = new CombatSupport(this.supply, () => this.prayer);
    private loot = new LootProcessor(this.supply);
    private shop = new MorttonShop(this.supply, () => this.temple.ensureAccess());
    private minigame = new Minigame(message => this.log(message), () => this.combat.maintain());
    private expedition: Expedition | null = null;

    override async onStart(): Promise<void> {
        this.local = this.settings.str('strategy', 'Local') === 'Local';
        this.prayer = this.settings.str('protection', 'Auto') === 'Auto';
        this.alch = this.settings.str('loot', 'Sell') === 'High alch';
        await Execution.delayUntil(() => Game.sceneReady(), 0);
        for (const [skill, level] of [['firemaking', 80], ['woodcutting', 75], ['fishing', 40], ['cooking', 40], ['hitpoints', 50]] as const) {
            if (Skills.level(skill) < level) throw new Error(`ShadesOfMortton requires ${level} ${skill}`);
        }
        for (const quest of ['Shades of Mortton', 'Priest in Peril']) {
            await Execution.delayUntil(() => Quests.status(quest) !== 'unknown', 5000);
            if (Quests.status(quest) !== 'complete') throw new Error(`Complete ${quest} before running ShadesOfMortton`);
        }
        if (!Equipment.items().some(item => item.slot === 3)) throw new Error('Equip a melee weapon and armour before running ShadesOfMortton');
        this.on('tick', () => { if (Game.ingame() && Skills.effective('hitpoints') <= 0) this.died = true; });
        Game.setAutoRetaliate(true);
        Sustain.set(async () => { await this.combat.maintain(); });
        this.log('Target: Fiyr shades, magic pyres and silver chests; replenishing from gathering and shops');
    }

    override onStop(): void { Sustain.set(null); void this.combat.standDown(); }
    override recoveryAnchor(): Tile { return new Tile(3510, 3480, 0); }
    override grindTargets(): string[] { return SHADE_TIERS.map(tier => tier.name); }

    private async loadKey(): Promise<boolean> {
        const key = reserveKey(this.supply.stock);
        return key === null || this.supply.take(key, 1);
    }

    private async loadOptional(chests = false): Promise<boolean> {
        if (this.prayer && Skills.level('prayer') >= 43 && Inventory.free() > 0) {
            const potion = PRAYER_POTIONS.find(potion => Bank.countById(potion.id) > 0);
            if (potion && !(await this.supply.take(potion.id, 1))) return false;
        }
        if (chests && this.alch && Skills.level('magic') >= 55) {
            for (const [id, cap] of [[561, 100], [554, 500]]) {
                const count = Math.min(cap, Bank.countById(id));
                if (count && Inventory.free() > 0 && !(await this.supply.take(id, count))) return false;
            }
        }
        return true;
    }

    private async execute(plan: Activity): Promise<boolean> {
        const s = this.supply;
        switch (plan.kind) {
            case 'food': return s.food();
            case 'logs': return s.logs();
            case 'funds': return s.logs(true);
            case 'oil': return this.temple.oil();
            case 'make': return s.make(plan.count);
            case 'hunt':
                if (!(await s.loadFood()) || !(await this.loadKey()) || !(await this.loadOptional()) || !(await Bank.close())) return false;
                return this.minigame.hunt(plan.tier, plan.count);
            case 'burn': {
                const remains = SHADE_TIERS[plan.tier].remains;
                if (!(await s.pack([[FOOD, 4], [590, 1], [3448, plan.count], [remains, plan.count]]))) return false;
                let completed = 0;
                for (let i = 0; i < plan.count; i++) {
                    if (EventSignal.pending()) break;
                    if (!(await this.minigame.cremate(plan.tier))) break;
                    completed++;
                }
                return completed > 0;
            }
            case 'chests': {
                if (!(await s.loadFood(8)) || !(await this.loadKey())) return false;
                let budget = 6;
                for (const key of spendableKeys(s.stock)) {
                    const qty = Math.min(key.count, budget);
                    if (qty && !(await s.take(key.id, qty))) return false;
                    budget -= qty;
                    if (!budget) break;
                }
                if (!(await this.loadOptional(true)) || !(await Bank.close())) return false;
                this.bankedLoot ??= counts();
                const result = await this.minigame.openChests();
                if (EventSignal.pending() || this.minigame.pending()) return false;
                if (!(await this.minigame.exit()) || !(await this.loot.process(this.bankedLoot, this.alch))) return false;
                this.bankedLoot = null;
                return result;
            }
        }
    }

    async loop(): Promise<void> {
        if (!Game.sceneReady() || EventSignal.pending()) return;
        if (this.died || Skills.effective('hitpoints') <= 0) {
            this.requestFinish('Death detected; recover equipment before restarting');
            return;
        }
        if (!this.expedition && this.minigame.pending()) {
            this.status = 'finishing interrupted funeral or chest';
            if (!(await this.minigame.resume()) && !EventSignal.pending()) await this.retry('Could not finish interrupted minigame action');
            return;
        }
        if (ChatDialog.canContinue()) { await ChatDialog.continue(); return; }
        if (!Equipment.items().some(item => item.slot === 3)) {
            this.requestFinish('Melee weapon missing; banked supplies and keys are preserved');
            return;
        }
        if (this.expedition) {
            this.status = `local: ${this.expedition.phase}`;
            const result = await this.expedition.step();
            if (result === 'continue' || EventSignal.pending()) return;
            if (result === 'failure') {
                this.requestFinish('Could not reconcile interrupted local transaction; inventory preserved');
                return;
            }
            this.log(`Returning to bank: ${this.expedition.reason}`);
            this.recoverAccess = this.expedition.reason === 'access';
            if (['repeated failure', 'unfinished transaction', 'pyre buyback unavailable', 'food exhausted'].includes(this.expedition.reason)) this.local = false;
            this.expedition = null;
        }
        if (this.bankedLoot) {
            if (!(await this.minigame.exit()) || !(await this.loot.process(this.bankedLoot, this.alch))) {
                if (!EventSignal.pending()) await this.retry('Could not dispose of chest loot');
                return;
            }
            this.bankedLoot = null;
        }
        await this.combat.standDown();
        this.status = 'banking';
        this.activity = 'bank';
        if (!(await this.minigame.exit()) || !(await this.supply.bank())) {
            await this.retry('Could not reach the bank');
            return;
        }
        if (this.recoverAccess) {
            this.status = 'restoring Razmire shop access';
            const ok = await this.temple.oil();
            if (EventSignal.pending()) return;
            if (ok && await this.temple.ensureAccess()) {
                this.recoverAccess = false;
                this.accessAttempts = 0;
            } else if (++this.accessAttempts >= 2) {
                this.recoverAccess = false;
                this.local = false;
                this.log('Razmire unavailable; using banked supply trips');
            }
            return;
        }
        const plan = chooseActivity(this.supply.stock);
        if (this.local && (plan.kind === 'hunt' || plan.kind === 'burn')) {
            const expedition = new Expedition(this.supply, this.minigame, this.shop, this.combat, this.loot, {
                pyres: Math.max(1, Math.min(200, this.settings.num('pyres', 40))),
                targetRemains: Math.max(1, Math.min(20, this.settings.num('targetRemains', 14))),
                prayer: this.prayer,
                alch: this.alch
            });
            if (await expedition.load()) {
                this.expedition = expedition;
                this.status = 'local: prepare';
                return;
            }
            if (EventSignal.pending()) return;
            this.local = false;
            this.log('Noted load unavailable; using banked supply trips');
            return;
        }
        this.activity = plan.kind;
        this.status = 'tier' in plan ? `${plan.kind}: ${SHADE_TIERS[plan.tier].name}` : plan.kind;
        this.log(`Activity: ${this.status}`);
        const ok = await this.execute(plan);
        if (EventSignal.pending()) return;
        if (ok) {
            this.failures = 0;
            this.cycles++;
        } else {
            await this.retry(`Could not complete ${this.status}; rechecking supplies`);
        }
    }

    private async retry(reason: string): Promise<void> {
        this.log(reason);
        if (++this.failures >= 8) {
            this.status = reason;
            this.requestFinish(reason);
            return;
        }
        await Execution.delayTicks(20);
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#b8a0df' });
        p.title(`ShadesOfMortton: ${this.status}`);
        p.row(`Cremations: ${this.burns}`, `Chests: ${this.chests}`);
        p.row(`Food: ${held(FOOD)}`, `Coins: ${held(995)}`);
        p.row(`Activities: ${this.cycles}`, `Inventory: ${Inventory.used()}/28`);
        ScriptRunner.paintControls(p);
        p.end();
    }
}
