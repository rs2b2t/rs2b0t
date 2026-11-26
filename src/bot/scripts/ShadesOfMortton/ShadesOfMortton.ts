import { LoopingBot } from '../../api/bot/Bot.js';
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
import { SHADE_TIERS, spendableSilverKeys } from './data.js';
import { CombatSupport } from './combat.js';
import { Expedition } from './expedition.js';
import { LootProcessor } from './loot.js';
import { MorttonShop, noteId } from './shop.js';
import { Minigame } from './minigame.js';
import { FOOD, oilDoses } from './policy.js';
import { counts, held, Supplies } from './supply.js';
import { Temple } from './temple.js';

export default class ShadesOfMortton extends LoopingBot {
    status = 'Checking prerequisites';
    activity = 'prepare';
    cycles = 0;
    get burns(): number { return this.minigame.stats.burned; }
    get chests(): number { return this.minigame.stats.chests; }
    private failures = 0;
    private died = false;
    private supply = new Supplies(message => this.log(message));
    private temple = new Temple(this.supply, () => this.combat.maintain());
    private needsBank = false;
    private resupplyReason = '';
    private prayer = true;
    private alch = false;
    private combat = new CombatSupport(this.supply, () => this.prayer);
    private loot = new LootProcessor(this.supply);
    private shop = new MorttonShop(this.supply, () => this.temple.ensureAccess());
    private minigame = new Minigame(message => this.log(message), () => this.combat.maintain());
    private expedition: Expedition | null = null;

    override async onStart(): Promise<void> {
        this.prayer = this.settings.bool('prayerPotions', true);
        this.alch = this.settings.bool('highAlchemy', false);
        await Execution.delayUntil(() => Game.sceneReady(), 0);
        for (const [skill, level] of [['firemaking', 80], ['hitpoints', 50]] as const) {
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

    private createExpedition(): Expedition {
        return new Expedition(this.supply, this.minigame, this.shop, this.combat, this.loot,
            { prayer: this.prayer, alch: this.alch }, this.temple);
    }

    private canResume(): boolean {
        const total = (id: number): number => held(id) + held(noteId(id) ?? -1);
        const fuel = total(1513) + total(3448);
        return held(590) > 0 && (held(2347) > 0 || held(3678) > 0)
            && total(FOOD) >= 2 && (fuel > 0 || spendableSilverKeys(counts()).length > 0)
            && (spendableSilverKeys(counts()).length > 0 || held(995) >= 500 || held(3448) > 0 || (held(1513) > 0 && oilDoses(counts()) >= 4));
    }

    private requireLevel(skill: 'woodcutting' | 'fishing' | 'cooking', level: number, purpose: string): boolean {
        if (Skills.level(skill) >= level) return true;
        this.requestFinish(`Need ${level} ${skill} to ${purpose}; stock the missing supplies in the bank to continue without gathering`);
        return false;
    }

    async loop(): Promise<void> {
        if (!Game.sceneReady() || EventSignal.pending()) return;
        if (this.died || Skills.effective('hitpoints') <= 0) {
            this.requestFinish('Death detected; recover equipment before restarting');
            return;
        }
        if (!this.expedition && this.minigame.pending()) {
            this.status = 'Finishing an interrupted funeral or chest';
            if (!(await this.minigame.resume()) && !EventSignal.pending()) await this.retry('Could not finish interrupted minigame action');
            return;
        }
        if (ChatDialog.canContinue()) { await ChatDialog.continue(); return; }
        if (!Equipment.items().some(item => item.slot === 3)) {
            this.requestFinish('Melee weapon missing; recover equipment before restarting');
            return;
        }
        if (!this.expedition && !this.needsBank && this.canResume()) {
            this.expedition = this.createExpedition();
            this.status = 'Preparing supplies in Mortton';
            return;
        }
        if (this.expedition) {
            this.status = this.expedition.description;
            this.activity = this.expedition.phase;
            const before = this.expedition.cycles ?? 0;
            const result = await this.expedition.step();
            this.cycles += (this.expedition.cycles ?? 0) - before;
            if (result === 'continue' || EventSignal.pending()) return;
            if (result === 'failure') {
                this.requestFinish(this.expedition.reason || 'Could not finish the current action; inventory preserved');
                return;
            }
            this.resupplyReason = this.expedition.reason;
            this.log(`Resupplying: ${this.resupplyReason}`);
            this.expedition = null;
            this.needsBank = true;
        }
        await this.combat.standDown();
        this.status = 'Restocking supplies at the bank';
        this.activity = 'bank';
        if (!(await this.minigame.exit()) || !(await this.supply.bank())) {
            await this.retry('Could not reach the bank');
            return;
        }
        this.needsBank = true;
        const stock = this.supply.stock;
        const needsAshes = this.resupplyReason === 'serum ingredients exhausted'
            && ![592, 1511, 1521, 1519, 1517, 1515, 1513, 3408, 3410, 3412, 3414, 3416, 3417, 3418, 3419].some(id => (stock.get(id) ?? 0) > 0);
        let ok = true;
        if ((stock.get(FOOD) ?? 0) < 12) {
            this.status = 'Replenishing food';
            this.activity = 'food';
            if (!this.requireLevel('cooking', 40, 'cook more lobsters')) return;
            if (!(stock.get(377) ?? 0) && !this.requireLevel('fishing', 40, 'catch more lobsters')) return;
            ok = await this.supply.food();
        } else if ((stock.get(995) ?? 0) < 3000 && !spendableSilverKeys(stock).length) {
            this.status = 'Replenishing coins for shops';
            this.activity = 'funds';
            if (!(stock.get(1513) ?? 0) && !this.requireLevel('woodcutting', 75, 'gather magic logs to sell')) return;
            ok = await this.supply.logs(true);
        } else if (needsAshes || !(stock.get(1513) ?? 0) && !(stock.get(3448) ?? 0) && !spendableSilverKeys(stock).length) {
            this.status = 'Gathering more magic logs';
            this.activity = 'logs';
            if (!this.requireLevel('woodcutting', 75, 'gather more magic logs')) return;
            ok = await this.supply.logs();
        } else {
            const expedition = this.createExpedition();
            if (await expedition.load()) {
                this.expedition = expedition;
                this.needsBank = false;
                this.resupplyReason = '';
                this.failures = 0;
                this.status = 'Preparing supplies in Mortton';
                return;
            }
            ok = false;
        }
        if (EventSignal.pending()) return;
        if (ok) { this.failures = 0; this.cycles++; }
        else await this.retry(`Could not complete ${this.status}`);
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
