import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { Bank } from '../../api/bank/Bank.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Locs } from '../../api/locs/Locs.js';
import type { Player } from '../../api/model/Player.js';
import { Paint } from '../../paint/Paint.js';
import Tile from '../../geometry/Tile.js';
import { Skills } from '../../api/skills/Skills.js';
import { Players } from '../../api/players/Players.js';
import { Trade } from '../../api/trade/Trade.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import { type SettingsSchema } from '../../runtime/Settings.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { reader } from '../../adapter/ClientAdapter.js';
import {
    DEFAULT_MEETING_POINT,
    DEFAULT_RUNE,
    MEETING_POINTS,
    RUNES,
    RUNE_OPTIONS,
    TRADE_REQUEST_INTERVAL_MS,
    bankDue,
    bankTile,
    isConfiguredPartner,
    parsePartnerNames,
    type MeetingPoint,
    type RuneRoute
} from './MuleCrafterLogic.js';
import {
    ALTAR_APPROACH_RADIUS,
    ESSENCE_ID,
    MEETING_RANGE,
    TEMPLE_Z,
    TRADE_RANGE,
    type MuleCrafterContext
} from './MuleCrafterContext.js';
import { createCloseBankTask, createCrafterBankTask, createCrafterPrepareTask, createMuleBankTask } from './BankTasks.js';
import { CraftRunesTask, EnterAltarTask, ExitAltarTask, crafterCanEnter, muleCanEnter } from './AltarTasks.js';
import { CrafterTradeScreenTask, MuleTradeScreenTask, TradeRequestTask } from './TradeTasks.js';
import { ApproachAltarTask, ApproachPartnerTask, WaitTask, WalkToTask } from './MovementTasks.js';

const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const PORTAL = { name: 'Portal', op: 'Use' };
const RUINS = 'Mysterious ruins';

export const SETTINGS: SettingsSchema = {
    rune: { type: 'string', default: DEFAULT_RUNE, options: RUNE_OPTIONS, label: 'Rune', help: 'which rune the pair crafts. Air = Falador East bank; Mind = Edgeville bank.' },
    mode: { type: 'string', default: 'Crafter', options: ['Crafter', 'Mule'], label: 'Mode', help: 'Crafter has the talisman, crafts at the altar, and trades with mules. Mule carries essence to the meeting point and runes back to the bank.' },
    meetingPoint: { type: 'string', default: DEFAULT_MEETING_POINT, options: [...MEETING_POINTS], label: 'Meet at', help: 'Altar (inside) keeps the crafter beside the altar and requires the mule to carry the matching talisman. Ruins (outside) is the overworld meeting point and needs no mule talisman.' },
    partner: { type: 'string', default: '', label: 'Partner name(s)', help: 'Crafter: optional mule name(s), comma-separated. Mule: required crafter name.' },
    tradesPerBank: { type: 'number', default: 0, min: 0, label: 'Bank after trades', help: 'When bank visits are enabled, walk to the bank after this many successful crafter trades. 0 runs the crafter without a mule and banks when out of essence. Ignored when Allow crafter bank visits is off.', showIf: { key: 'mode', anyOf: ['Crafter'] } },
    bankFill: { type: 'boolean', default: false, label: 'Allow crafter bank visits', help: 'Off prevents the crafter from going to the bank, including Bank after trades trips; mules must provide essence. On allows bank visits, cleanup, and scheduled bank trips.', showIf: { key: 'mode', anyOf: ['Crafter'] } }
};

function isAtTile(tile: ReturnType<typeof bankTile>, radius = 3): boolean {
    const here = Game.tile();
    return here !== null && tile.distanceTo(here) <= radius;
}

export default class MuleCrafter extends TaskBot implements MuleCrafterContext {
    override loopDelay = 600;

    private modeValue = 'Crafter';
    private runeValue = DEFAULT_RUNE;
    private conf: RuneRoute = RUNES[DEFAULT_RUNE];
    private bank: ReturnType<typeof bankTile> = bankTile(RUNES[DEFAULT_RUNE].bank);
    private partnersValue: string[] = [];
    private meeting: MeetingPoint = DEFAULT_MEETING_POINT;
    private tradeLimit = 0;
    private bankVisits = false;
    private tradesSinceBankCount = 0;
    private lastTradeRequestAt: number | null = null;
    private tradeScreenOpens = 0;
    private tradeScreenSuccesses = 0;
    private tradeScreenFailures = 0;
    private craftEvents = 0;
    private successfulDeliveries = 0;
    private crafted = 0;
    private trades = 0;
    private received = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        this.modeValue = this.settings.str('mode', 'Crafter');
        this.runeValue = this.settings.str('rune', DEFAULT_RUNE);
        this.conf = RUNES[this.runeValue] ?? RUNES[DEFAULT_RUNE];
        this.bank = bankTile(this.conf.bank);
        this.partnersValue = parsePartnerNames(this.settings.str('partner', ''));
        const meeting = this.settings.str('meetingPoint', DEFAULT_MEETING_POINT) as MeetingPoint;
        this.meeting = MEETING_POINTS.includes(meeting) ? meeting : DEFAULT_MEETING_POINT;
        this.tradeLimit = Math.max(0, Math.floor(this.settings.num('tradesPerBank', 0)));
        this.bankVisits = this.settings.bool('bankFill', false);
        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('runecraft');
        this.tradesSinceBankCount = 0;
        this.lastTradeRequestAt = null;
        this.tradeScreenOpens = 0;
        this.tradeScreenSuccesses = 0;
        this.tradeScreenFailures = 0;
        this.craftEvents = 0;
        this.successfulDeliveries = 0;

        if (this.modeValue === 'Mule') {
            if (this.partnersValue.length === 0) {
                throw new Error('MuleCrafter: no crafter configured for mule mode');
            }
            await this.cleanMuleInventory();
            this.add(new ContinueDialog(), ...createMuleTasks(this));
            return;
        }

        if (!this.bankVisitsEnabled()) {
            this.log('MuleCrafter crafter: bank visits are disabled; Bank after trades is ignored');
        } else if (!this.muleModeActive()) {
            this.log('MuleCrafter: solo crafter mode; bank is enabled for out-of-essence restock');
        } else {
            this.log(`MuleCrafter crafter starting at ${this.meeting}; bank after ${this.tradeLimit} trades`);
        }
        await this.cleanCrafterInventory();
        this.add(new ContinueDialog(), ...createCrafterTasks(this));
    }

    private async cleanCrafterInventory(): Promise<void> {
        this.log('Crafter cleanup: starting');
        if (!this.bankVisitsEnabled()) {
            if (!Inventory.contains(this.conf.talisman)) {
                throw new Error(`MuleCrafter: bankFill is off and ${this.conf.talisman} is missing; cannot visit the bank`);
            }
            this.log('Crafter cleanup: skipped because bank visits are disabled');
            return;
        }
        const keepNames = new Set([this.conf.talisman.toLowerCase()]);
        const hasExtraItems = Inventory.items().some(item => item.name && !keepNames.has(item.name.toLowerCase()) && item.id !== ESSENCE_ID);
        if (!hasExtraItems && Inventory.contains(this.conf.talisman)) return;
        this.log('Crafter inventory contains unauthorized items or missing talisman. Opening bank to clean inventory...');
        this.log(`Crafter cleanup: bank tile ${this.bank.x},${this.bank.z}`);
        await this.walkTo(this.bank, 3);
        if (!await this.openBank()) {
            throw new Error('MuleCrafter: Failed to open bank for initial inventory cleanup.');
        }
        this.log('Crafter cleanup: bank opened');
        const talismanId = Bank.items().find(item => item.name?.toLowerCase() === this.conf.talisman.toLowerCase())?.id
            ?? Inventory.items().find(item => item.name?.toLowerCase() === this.conf.talisman.toLowerCase())?.id
            ?? -1;
        const runeId = Inventory.items().find(item => item.name?.toLowerCase() === this.conf.rune.toLowerCase())?.id
            ?? Bank.items().find(item => item.name?.toLowerCase() === this.conf.rune.toLowerCase())?.id
            ?? -1;
        const keep = new Set([talismanId, runeId, ESSENCE_ID].filter(id => id !== -1));
        await Bank.depositAllMatching((name, id) => name.length > 0 && !keep.has(id), message => this.log(`  ${message}`));
        this.log('Crafter cleanup: deposit pass complete');
        await Execution.delayTicks(1);
        if (!await this.ensureTalisman()) {
            throw new Error(`MuleCrafter: ${this.conf.talisman} not found`);
        }
        await Bank.close();
        this.log('Crafter cleanup: bank closed');
    }

    private async cleanMuleInventory(): Promise<void> {
        const keepTalisman = this.meeting === 'Altar (inside)';
        const keepNames = new Set([this.conf.rune.toLowerCase()]);
        if (keepTalisman) keepNames.add(this.conf.talisman.toLowerCase());
        const hasExtraItems = Inventory.items().some(item => item.name && item.id !== ESSENCE_ID && !keepNames.has(item.name.toLowerCase()));
        const needsTalisman = keepTalisman && !Inventory.contains(this.conf.talisman);
        if (!hasExtraItems && !needsTalisman) return;
        this.log('Mule inventory contains unauthorized items or needs a talisman. Opening bank to clean inventory...');
        await this.walkTo(this.bank, 3);
        if (!await this.openBank()) {
            throw new Error('MuleCrafter: Failed to open bank for initial inventory cleanup.');
        }
        const talismanId = Bank.items().find(item => item.name?.toLowerCase() === this.conf.talisman.toLowerCase())?.id
            ?? Inventory.items().find(item => item.name?.toLowerCase() === this.conf.talisman.toLowerCase())?.id
            ?? -1;
        const runeId = Inventory.items().find(item => item.name?.toLowerCase() === this.conf.rune.toLowerCase())?.id
            ?? Bank.items().find(item => item.name?.toLowerCase() === this.conf.rune.toLowerCase())?.id
            ?? -1;
        const keep = new Set([runeId, ESSENCE_ID]);
        if (keepTalisman && talismanId !== -1) keep.add(talismanId);
        await Bank.depositAllMatching((name, id) => name.length > 0 && !keep.has(id), message => this.log(`  ${message}`));
        await Execution.delayTicks(1);
        if (keepTalisman && !await this.ensureTalisman()) {
            throw new Error(`MuleCrafter: ${this.conf.talisman} not found`);
        }
        await Bank.close();
    }

    private async openBank(): Promise<boolean> {
        return await Bank.openBooth(this.bank, BOOTH.name, BOOTH.op, message => this.log(`  ${message}`))
            || await Bank.openNearest(BOOTH.name, BOOTH.op, message => this.log(`  ${message}`));
    }

    private async ensureTalisman(): Promise<boolean> {
        if (Inventory.contains(this.conf.talisman)) return true;
        const item = Bank.items().find(row => row.name?.toLowerCase() === this.conf.talisman.toLowerCase());
        if (!item?.name) return false;
        await Bank.withdraw(this.conf.talisman, 'Withdraw-1');
        return Execution.delayUntil(() => Inventory.contains(this.conf.talisman), 3000);
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#a0e6c8' });
        p.title(`MuleCrafter — ${this.runeValue} — ${this.modeValue} — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        const xpGained = Skills.xp('runecraft') - this.xpAtStart;
        const xph = mins > 0.5 ? `${((xpGained / mins) * 60 / 1000).toFixed(1)}k` : '—';
        p.row(`Runtime: ${fmtDuration(mins)}`, this.modeValue === 'Crafter' ? `RC lvl: ${Skills.level('runecraft')}` : `To: ${this.partnersValue[0] ?? '?'}`);
        if (this.modeValue === 'Crafter') {
            const bankState = !this.bankVisitsEnabled() ? 'disabled' : this.tradeLimit || 'when empty';
            p.row(`Crafts: ${this.craftEvents}`, `Essence: ${this.crafted}`, this.meeting);
            p.row(`Screens: ${this.tradeScreenOpens}`, `Completed: ${this.tradeScreenSuccesses}`, `Failed: ${this.tradeScreenFailures}`);
            p.row(`RC xp: ${xpGained}`, `XP/h: ${xph}`, `Trades since bank: ${this.tradesSinceBankCount}/${bankState}`);
            p.row(`Pack ess: ${this.essenceCount()}`, `Pack runes: ${this.runeCount()}`, this.meeting);
        } else {
            p.row(`Trades: ${this.trades}`, `Ess received: ${this.received}`, this.meeting);
            p.row(`Screens: ${this.tradeScreenOpens}`, `Completed: ${this.tradeScreenSuccesses}`, `Failed: ${this.tradeScreenFailures}`);
            p.row(`Pack ess: ${this.essenceCount()}`, `Pack runes: ${this.runeCount()}`, '');
        }
        ScriptRunner.paintControls(p);
        p.end();
    }

    mode(): string { return this.modeValue; }
    rune(): string { return this.runeValue; }
    cfg(): RuneRoute { return this.conf; }
    bankTile(): ReturnType<typeof bankTile> { return this.bank; }
    partners(): string[] { return this.partnersValue; }
    bankVisitsEnabled(): boolean { return this.bankVisits; }
    tradesPerBank(): number { return this.tradeLimit; }
    meetingPoint(): MeetingPoint { return this.meeting; }
    muleModeActive(): boolean { return this.modeValue === 'Crafter' && this.tradeLimit > 0 && this.partnersValue.length > 0; }
    inTemple(): boolean { const tile = Game.tile(); return tile !== null && tile.z > TEMPLE_Z; }
    atBank(): boolean { return !this.inTemple() && isAtTile(this.bank, 6); }
    atMeetingPoint(): boolean {
        return this.meeting === 'Altar (inside)' ? this.inTemple() : !this.inTemple() && isAtTile(this.conf.ruins, MEETING_RANGE);
    }
    essenceCount(): number { return reader.inventory().filter(item => item.id === ESSENCE_ID).reduce((sum, item) => sum + item.count, 0); }
    runeCount(): number { return Inventory.count(this.conf.rune); }
    bankDue(): boolean {
        if (!this.bankVisitsEnabled()) return false;
        return this.muleModeActive() ? bankDue(this.tradesSinceBankCount, this.tradeLimit) : this.essenceCount() === 0;
    }
    tradeRequestDue(): boolean { return this.lastTradeRequestAt === null || Date.now() - this.lastTradeRequestAt >= TRADE_REQUEST_INTERVAL_MS; }
    markTradeRequest(): void { this.lastTradeRequestAt = Date.now(); }
    recordTradeScreenOpen(): number {
        this.tradeScreenOpens++;
        return this.tradeScreenOpens;
    }
    recordTradeScreenSuccess(): number {
        this.tradeScreenSuccesses++;
        return this.tradeScreenSuccesses;
    }
    recordTradeScreenFailure(): number {
        this.tradeScreenFailures++;
        return this.tradeScreenFailures;
    }
    isPartner(name: string | null): boolean { return isConfiguredPartner(name, this.partnersValue); }
    nearestPartner(range = MEETING_RANGE): Player | null {
        if (this.partnersValue.length === 0) return null;
        return Players.query().name(...this.partnersValue).within(range).nearest();
    }
    currentTile(): Tile | null { const tile = Game.tile(); return tile === null ? null : Tile.from(tile); }
    altarTile(): Tile | null {
        const tile = Locs.query().name('Altar').action('Craft-rune').nearest()?.tile();
        return tile === undefined ? null : Tile.from(tile);
    }
    setStatus(status: string): void { this.status = status; }
    countCraft(amount: number): number {
        this.crafted += amount;
        this.craftEvents++;
        return this.craftEvents;
    }
    craftCount(): number { return this.craftEvents; }
    recordCrafterTrade(amount: number): number {
        this.trades++;
        this.received += amount;
        this.tradesSinceBankCount++;
        return this.trades;
    }
    recordMuleDelivery(amount: number): number {
        this.trades++;
        this.received += amount;
        if (amount > 0) this.successfulDeliveries++;
        return this.successfulDeliveries;
    }
    resetTradeCounter(): void { this.tradesSinceBankCount = 0; }

    async walkTo(dest: ReturnType<typeof bankTile>, radius = 2): Promise<void> {
        const here = Game.tile();
        if (here && dest.distanceTo(here) <= radius) return;
        if (!Game.ingame()) await Execution.delayUntil(() => Game.ingame(), 30_000);
        await Traversal.walkResilient(dest, { radius, attempts: 6, timeoutMs: 240_000, log: message => this.log(`  ${message}`) });
    }

    async enterAltar(): Promise<boolean> {
        if (this.inTemple()) return true;
        await this.walkTo(this.conf.ruins, 1);
        const ruins = Locs.query().name(RUINS).nearest();
        const talisman = Inventory.first(this.conf.talisman);
        if (!ruins || !talisman) return false;
        if (!await talisman.useOn(ruins)) return false;
        return Execution.delayUntil(() => this.inTemple(), 10_000);
    }

    async exitAltar(): Promise<boolean> {
        for (let attempt = 0; attempt < 15 && this.inTemple(); attempt++) {
            if (ChatDialog.canContinue()) {
                await ChatDialog.continue();
                continue;
            }
            const portal = Locs.query().name(PORTAL.name).action(PORTAL.op).nearest();
            if (portal) await portal.interact(PORTAL.op);
            await Execution.delayTicks(1);
        }
        return !this.inTemple();
    }
}

function createCrafterTasks(bot: MuleCrafter): Task[] {
    const atRuins = () => !bot.inTemple() && !Trade.active() && !isAtTile(bot.cfg().ruins, 3);
    return [
        new CrafterTradeScreenTask(bot),
        createCloseBankTask(bot),
        new ExitAltarTask(bot, () => bot.mode() === 'Crafter' && bot.inTemple() && bot.essenceCount() === 0 && (bot.meetingPoint() === 'Ruins (outside)' || bot.bankDue())),
        createCrafterBankTask(bot),
        createCrafterPrepareTask(bot),
        new WalkToTask(bot, () => bot.cfg().ruins, atRuins, 2, 'walking to the ruins'),
        new EnterAltarTask(bot, () => crafterCanEnter(bot), 'entering the altar'),
        new ApproachAltarTask(bot, () => bot.mode() === 'Crafter' && bot.inTemple(), ALTAR_APPROACH_RADIUS),
        new CraftRunesTask(bot),
        new TradeRequestTask(bot, {
            ready: () => bot.mode() === 'Crafter' && bot.muleModeActive() && !bot.bankDue() && bot.atMeetingPoint() && !Trade.active(),
            candidate: () => bot.nearestPartner(TRADE_RANGE),
            status: () => 'requesting trade with {name}'
        }),
        new WaitTask(bot, () => bot.mode() === 'Crafter' && bot.muleModeActive() && !bot.bankDue() && bot.atMeetingPoint() && !Trade.active() && bot.nearestPartner(TRADE_RANGE) === null, () => 'waiting for a mule within one tile', 2)
    ];
}

function createMuleTasks(bot: MuleCrafter): Task[] {
    const tasks: Task[] = [
        new MuleTradeScreenTask(bot),
        createCloseBankTask(bot),
        new ExitAltarTask(bot, () => bot.mode() === 'Mule' && bot.inTemple() && bot.essenceCount() === 0),
        createMuleBankTask(bot),
        new WalkToTask(bot, () => bot.cfg().ruins, () => bot.mode() === 'Mule' && !bot.inTemple() && !Trade.active() && bot.essenceCount() > 0 && !isAtTile(bot.cfg().ruins, 3), 2, 'walking to the ruins')
    ];
    if (bot.meetingPoint() === 'Altar (inside)') {
        tasks.push(
            new EnterAltarTask(bot, () => muleCanEnter(bot), 'entering the altar'),
            new ApproachAltarTask(bot, () => bot.mode() === 'Mule' && bot.inTemple() && bot.essenceCount() > 0, ALTAR_APPROACH_RADIUS),
            new ApproachPartnerTask(bot, () => bot.mode() === 'Mule' && bot.inTemple() && bot.essenceCount() > 0, TRADE_RANGE)
        );
    }
    tasks.push(
        new TradeRequestTask(bot, {
            ready: () => bot.mode() === 'Mule' && bot.atMeetingPoint() && !Trade.active() && bot.essenceCount() > 0,
            candidate: () => bot.nearestPartner(TRADE_RANGE),
            status: () => 'requesting trade with {name}'
        }),
        new WaitTask(bot, () => bot.mode() === 'Mule' && bot.atMeetingPoint() && !Trade.active() && bot.essenceCount() > 0 && bot.nearestPartner(TRADE_RANGE) === null, () => 'waiting for the crafter within one tile', 2)
    );
    return tasks;
}
