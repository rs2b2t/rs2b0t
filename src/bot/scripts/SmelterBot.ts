import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Bank } from '../api/hud/Bank.js';
import { Skills } from '../api/hud/Skills.js';
import { Paint } from '../api/hud/Paint.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { Locs } from '../api/queries/Locs.js';
import { walkOpening } from '../api/walkOpening.js';
import { actions, reader } from '../adapter/ClientAdapter.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import {
    BAR_OPTIONS,
    recipeForBar,
    withdrawPlan,
    countPrimary,
    type Recipe
} from './SmelterBotLogic.js';
import { fmtDuration } from '../api/hud/paintLogic.js';

const DEFAULT_BANK_STAND = new Tile(3269, 3167, 0);
const DEFAULT_FURNACE_STAND = new Tile(3275, 3185, 0);
const BOOTH = { op: 'Use-quickly' };

export const SETTINGS: SettingsSchema = {
    bar: { type: 'string', default: 'Bronze', options: [...BAR_OPTIONS], label: 'Bar to smelt', help: 'withdraw plan + coal ratio are derived from this' },
    bankStand: { type: 'tile', default: DEFAULT_BANK_STAND, label: 'Bank stand tile (x,z)' },
    furnaceStand: { type: 'tile', default: DEFAULT_FURNACE_STAND, label: 'Furnace stand tile (x,z)' },
    furnaceName: { type: 'string', default: 'Furnace', label: 'Furnace loc name' },
    bankBooth: { type: 'string', default: 'Bank booth', label: 'Bank booth loc name' },
    obstacle: { type: 'string', default: 'door, gate', label: 'Openable obstacles (contains)', help: 'the bank-building door on the route' },
    leashRadius: { type: 'number', default: 8, min: 2, max: 20, label: 'Furnace search radius (tiles)' }
};

export default class SmelterBot extends TaskBot {
    override loopDelay = 600;

    private smelted = 0;
    private trips = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;

    private recipe: Recipe = recipeForBar('Bronze')!;
    private bankStand = DEFAULT_BANK_STAND;
    private furnaceStand = DEFAULT_FURNACE_STAND;
    private furnaceName = 'Furnace';
    private boothName = 'Bank booth';
    private obstacle: string[] = ['door', 'gate'];
    private leash = 8;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        const barName = this.settings.str('bar', 'Bronze');
        this.recipe = recipeForBar(barName) ?? recipeForBar('Bronze')!;
        this.bankStand = this.settings.tile('bankStand', DEFAULT_BANK_STAND);
        this.furnaceStand = this.settings.tile('furnaceStand', DEFAULT_FURNACE_STAND);
        this.furnaceName = this.settings.str('furnaceName', 'Furnace');
        this.boothName = this.settings.str('bankBooth', 'Bank booth');
        this.obstacle = this.settings.str('obstacle', 'door, gate').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        this.leash = this.settings.num('leashRadius', 8);

        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('smithing');

        const plan = withdrawPlan(this.recipe).map(p => `${p.count} ${p.ore}`).join(' + ');
        this.log(`SmelterBot smelting '${this.recipe.bar}' (${plan}) — bank ${this.bankStand}, furnace ${this.furnaceStand}`);
        this.add(new ContinueDialog(), new BankTrip(this), new SmeltTrip(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#ffd479' });
        p.title(`SmelterBot — ${this.status}`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        const xph = mins > 0.5 ? `${(((Skills.xp('smithing') - this.xpAtStart) / mins) * 60 / 1000).toFixed(1)}k` : '—';
        p.row(`Runtime: ${fmtDuration(mins)}`, `Smelted: ${this.smelted}`, `XP/hr: ${xph}`);
        p.row(`Bar: ${this.recipe.bar}`, `Ore left: ${this.primaryCount()}`, `Bank trips: ${this.trips}`);

        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }

    setStatus(s: string): void { this.status = s; }
    recordSmelt(n: number): void { this.smelted += n; }
    countTrip(): void { this.trips++; }
    activeRecipe(): Recipe { return this.recipe; }
    furnaceLocName(): string { return this.furnaceName; }
    obstacleList(): string[] { return this.obstacle; }
    leashRadius(): number { return this.leash; }
    bankTile(): Tile { return this.bankStand; }
    furnaceTile(): Tile { return this.furnaceStand; }
    boothLocName(): string { return this.boothName; }
    primaryCount(): number { return countPrimary(Inventory.items(), this.recipe); }
}

class BankTrip implements Task {
    constructor(private bot: SmelterBot) {}
    validate(): boolean { return this.bot.primaryCount() === 0; }
    async execute(): Promise<void> {
        this.bot.setStatus('banking');
        await walkOpening(this.bot.bankTile(), 0, this.bot.obstacleList(), m => this.bot.log(m));
        if (!(await Bank.openBooth(this.bot.bankTile(), this.bot.boothLocName(), BOOTH.op, m => this.bot.log(`  ${m}`)))) {
            this.bot.log('could not open the bank — will retry');
            return;
        }
        await Bank.depositInventory();
        await Execution.delayTicks(1);
        this.bot.countTrip();

        const recipe = this.bot.activeRecipe();
        const plan = withdrawPlan(recipe);

        for (const step of plan) {
            const bankItem = Bank.items().find(i => i.name !== null && i.name.toLowerCase().includes(step.ore.toLowerCase()));
            const have = bankItem?.name ? Bank.count(bankItem.name) : 0;
            if (!bankItem || bankItem.name === null || have < step.count) {
                this.bot.log(`out of '${step.ore}' — bank has ${have}, need ${step.count} for a full trip of ${recipe.bar}. Stopping.`);
                this.bot.setStatus(`out of ${step.ore} — stopped`);
                ScriptRunner.stop();
                return;
            }
        }

        for (const step of plan) {
            const bankItem = Bank.items().find(i => i.name !== null && i.name.toLowerCase().includes(step.ore.toLowerCase()));
            if (!bankItem || bankItem.name === null) {
                this.bot.log(`'${step.ore}' vanished from the bank mid-trip — stopping.`);
                ScriptRunner.stop();
                return;
            }
            const bankName = bankItem.name;
            this.bot.setStatus(`withdrawing ${step.count} ${bankName}`);
            if (!(await Bank.withdrawX(bankName, step.count))) {
                this.bot.log(`could not withdraw ${step.count} ${bankName} — retrying next trip`);
                return;
            }
        }
    }
}

class SmeltTrip implements Task {
    constructor(private bot: SmelterBot) {}
    validate(): boolean { return this.bot.primaryCount() > 0 && !ChatDialog.canContinue(); }
    async execute(): Promise<void> {
        const furnace = () => Locs.query().name(this.bot.furnaceLocName()).action('Smelt').where(l => l.tile().distanceTo(this.bot.furnaceTile()) <= this.bot.leashRadius()).nearest();
        const here = Game.tile();
        if (!here || this.bot.furnaceTile().distanceTo(here) > 1 || !furnace()) {
            this.bot.setStatus('crossing to the furnace');
            await walkOpening(this.bot.furnaceTile(), 0, this.bot.obstacleList(), m => this.bot.log(m));
        }
        const stand = this.bot.furnaceTile();
        for (let w = 0; w < 5; w++) {
            const now = Game.tile();
            if (now && now.x === stand.x && now.z === stand.z) { break; }
            const local = reader.toLocal(stand.x, stand.z);
            if (!local) { await Execution.delayTicks(1); continue; }
            const before = Game.tile();
            actions.walkTo(local.lx, local.lz);
            await Execution.delayUntil(() => {
                const t = Game.tile();
                return (t !== null && t.x === stand.x && t.z === stand.z) || (before !== null && t !== null && (before.x !== t.x || before.z !== t.z));
            }, 3000);
        }

        if (!ChatDialog.isMakeMenu()) {
            const oven = furnace();
            if (!oven) { await Execution.delayTicks(2); return; }
            await oven.interact('Smelt');
            if (!(await Execution.delayUntil(() => ChatDialog.isMakeMenu() || ChatDialog.canContinue(), 6000))) {
                await Execution.delayTicks(2);
                return;
            }
        }
        if (!ChatDialog.isMakeMenu()) { return; }

        const recipe = this.bot.activeRecipe();
        const barKeyword = ({ Adamant: 'Adamantite', Rune: 'Runite' } as Record<string, string>)[recipe.bar] ?? recipe.bar;
        const before = this.bot.primaryCount();
        this.bot.setStatus(`smelting ${recipe.bar}`);
        if (await ChatDialog.makeX(barKeyword, before)) {
            await Execution.delayUntil(() => this.bot.primaryCount() === 0 || ChatDialog.canContinue(), 120000);
            if (this.bot.primaryCount() < before) { this.bot.recordSmelt(before - this.bot.primaryCount()); }
        } else {
            this.bot.log(`Smelt panel open but couldn't Smelt-X '${barKeyword}' — products: [${ChatDialog.makeProducts().join(', ')}]`);
            await Execution.delayTicks(2);
        }
    }
}
