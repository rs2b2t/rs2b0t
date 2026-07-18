import { TaskBot, type Task } from '../api/Bot.js';
import { EventSignal } from '../api/EventSignal.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { Traversal } from '../api/Traversal.js';
import { Bank } from '../api/hud/Bank.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Paint } from '../api/hud/Paint.js';
import { Shop } from '../api/hud/Shop.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { talkThrough } from '../quests/exec/primitives.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { buyoutPlan } from '../shops/BuyoutLogic.js';
import { SHOP_DB } from '../shops/data/shopdb.js';
import type { ShopRecord } from '../shops/types.js';
import { SHOP_PRESETS, presetByLabel, presetBuyableNames } from './shopPresets.js';

const DEFAULT_PRESET = SHOP_PRESETS[0]; // Mage Arena — Gundai still web-walk-free; park it in the room

/** minutes → h:mm:ss for the paint's runtime line. */
function fmtDuration(mins: number): string {
    const t = Math.max(0, Math.floor(mins * 60));
    return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export const SHOPBUYOUT_SETTINGS: SettingsSchema = {
    shop: { type: 'string', default: DEFAULT_PRESET.label, options: SHOP_PRESETS.map(p => p.label), label: 'Shop', help: 'the shop to buy out — its trade tile and nearest bank are baked in (add more in shopPresets.ts)' },
    budgetGp: { type: 'number', default: 250_000, min: 100, label: 'Total gp to spend', help: 'the session budget — the bot stops cleanly once roughly this much has been spent' },
    perTripGp: { type: 'number', default: 100_000, min: 100, label: 'Gp per bank trip' },
    stopFloorGp: { type: 'number', default: 5000, min: 0, label: 'Stop below bank gp' },
    buyItems: { type: 'string[]', default: [], options: presetBuyableNames(), label: 'Items to buy (empty = all stock)', help: 'multi-select, valuable-first under the coin budget; leave empty to buy the whole shop out' },
    recheckSeconds: { type: 'number', default: 60, min: 5, max: 600, label: 'Restock recheck (s)', help: 'wait between buy passes once the stock is drained (elemental runes restock 1/30s, law/nature 1/3min)' }
};

/**
 * Single-shop buyout loop — the no-routing alternative to ShopRunner. Parked
 * at one shop's bank with a total gp budget: withdraw a trip's coins, buy the
 * shop out valuable-first, stash the haul at the bank (death insurance —
 * runes stack, so this is safety, not slot pressure), repeat as the stock
 * restocks, and stop once the budget is spent or the bank runs dry.
 */
export default class ShopBuyout extends TaskBot {
    override loopDelay = 600;

    private status = 'starting';
    private phase: 'bank' | 'buy' = 'bank';
    private startedAt = Date.now();
    sessionSpent = 0;
    sessionHaul: Record<string, number> = {};

    budgetGp = 250_000;
    perTripGp = 100_000;
    stopFloorGp = 5000;
    chosen = new Set<string>();
    keeper = DEFAULT_PRESET.keeper;
    banker = DEFAULT_PRESET.banker ?? '';
    shopStand = DEFAULT_PRESET.shopStand;
    bankStand = DEFAULT_PRESET.bankStand;
    boothName = DEFAULT_PRESET.boothName ?? 'Bank booth';
    boothOp = DEFAULT_PRESET.boothOp ?? 'Use-quickly';
    recheckMs = 60_000;
    /** The shop's db record (pricing + name→obj); null for an unknown keeper. */
    rec: ShopRecord | null = null;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.budgetGp = this.settings.num('budgetGp', 250_000);
        this.perTripGp = this.settings.num('perTripGp', 100_000);
        this.stopFloorGp = this.settings.num('stopFloorGp', 5000);
        const preset = presetByLabel(this.settings.str('shop', DEFAULT_PRESET.label)) ?? DEFAULT_PRESET;
        this.chosen = new Set(this.settings.list('buyItems', []).map(s => s.toLowerCase()));
        this.keeper = preset.keeper;
        this.banker = preset.banker ?? '';
        this.shopStand = preset.shopStand;
        this.bankStand = preset.bankStand;
        this.boothName = preset.boothName ?? 'Bank booth';
        this.boothOp = preset.boothOp ?? 'Use-quickly';
        this.recheckMs = this.settings.num('recheckSeconds', 60) * 1000;
        this.rec = Object.values(SHOP_DB).find(r => r.keepers.includes(this.keeper)) ?? null;
        if (!this.rec) {
            this.log(`[buyout] '${this.keeper}' isn't a known shopkeeper — will buy ALL stock in shop order (no price model)`);
        }

        this.startedAt = Date.now();
        this.log(`[buyout] ${this.keeper} — budget ${this.budgetGp}gp, ${this.perTripGp}gp/trip, ${this.chosen.size} item names selected`);
        this.add(new ContinueDialog(), new BankTrip(this), new BuyoutPass(this));
    }

    setStatus(s: string): void {
        this.status = s;
    }
    inPhase(p: 'bank' | 'buy'): boolean {
        return this.phase === p;
    }
    toPhase(p: 'bank' | 'buy'): void {
        this.phase = p;
    }
    budgetLeft(): number {
        return Math.max(0, this.budgetGp - this.sessionSpent);
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#ffd76e' });
        p.title(`ShopBuyout — ${this.status}`);

        const tab = p.tabs('sb', ['Overview', 'Haul']);
        if (tab === 'Overview') {
            const mins = (Date.now() - this.startedAt) / 60_000;
            p.row(`Runtime: ${fmtDuration(mins)}`, `Coins: ${Inventory.count('Coins')}`);
            p.row(`Spent: ${this.sessionSpent}`, `Budget: ${this.budgetGp}`);
            p.bar('Budget', this.budgetGp > 0 ? this.sessionSpent / this.budgetGp : 0, '#ffd76e');
        } else {
            const haul = Object.entries(this.sessionHaul).sort((a, b) => b[1] - a[1]);
            if (haul.length === 0) {
                p.text('nothing bought yet', '#8a919a');
            }
            for (let i = 0; i < haul.length; i += 2) {
                p.row(...haul.slice(i, i + 2).map(([obj, n]) => `${obj}: ${n}`));
            }
        }

        p.gap();
        // Pause/Stop only — a single-shop buyout has no safe mid-run switch (the
        // shop/keeper/budget are baked into the funded trip).
        const clicked = p.buttons([
            { id: 'pause', label: ScriptRunner.state === 'paused' ? 'Resume' : 'Pause' },
            { id: 'stop', label: 'Stop' }
        ]);
        if (clicked === 'pause') {
            if (ScriptRunner.state === 'paused') {
                ScriptRunner.resume();
            } else {
                ScriptRunner.pause();
            }
        } else if (clicked === 'stop') {
            ScriptRunner.stop();
        }
        p.end();
    }
}

/** Stash the haul, stop when done/dry, withdraw the next trip's coins. */
class BankTrip implements Task {
    constructor(private bot: ShopBuyout) {}

    validate(): boolean {
        return this.bot.inPhase('bank');
    }

    async execute(): Promise<void> {
        const bot = this.bot;
        bot.setStatus('banking');
        if (!(await Traversal.walkResilient(bot.bankStand, { radius: 2, attempts: 4, timeoutMs: 60_000, log: m => bot.log(`  ${m}`) }))) {
            bot.log('[buyout] walk to the bank stand failed — will retry');
            return;
        }
        if (!(await this.openBank())) {
            bot.log('[buyout] could not open the bank — will retry');
            return;
        }

        // Stash everything except coins — the haul stacks, this is death insurance.
        await Bank.depositAllMatching(name => name !== 'Coins');
        await Execution.delayTicks(1);

        if (bot.budgetLeft() === 0) {
            await Bank.depositAllMatching(() => true);
            bot.log(`[buyout] budget spent (${bot.sessionSpent}gp) — stopping. Haul: ${Object.entries(bot.sessionHaul).map(([o, n]) => `${o}×${n}`).join(', ') || '(nothing)'}`);
            bot.setStatus('budget spent — stopped');
            ScriptRunner.stop();
            return;
        }
        const bankGp = Bank.count('Coins');
        if (bankGp < bot.stopFloorGp) {
            bot.log(`[buyout] bank coins ${bankGp} below floor ${bot.stopFloorGp} — stopping`);
            bot.setStatus('bank dry — stopped');
            ScriptRunner.stop();
            return;
        }

        const want = Math.min(bot.perTripGp, bot.budgetLeft());
        const need = want - Inventory.count('Coins');
        if (need > 0) {
            if (!(await Bank.withdrawX('Coins', Math.min(need, bankGp)))) {
                bot.log('[buyout] coin withdrawal failed — will retry');
                return;
            }
            bot.log(`[buyout] withdraw ${Math.min(need, bankGp)}gp (${bot.budgetLeft()}gp of the budget left)`);
        }
        bot.toPhase('buy');
    }

    /** Gundai-style NPC bankers open via a Talk-to dialog; booths via the op. */
    private async openBank(): Promise<boolean> {
        const bot = this.bot;
        if (Bank.isOpen()) {
            return true;
        }
        if (bot.banker === '') {
            return Bank.openNearest(bot.boothName, bot.boothOp, m => bot.log(`  ${m}`));
        }
        await talkThrough(bot.banker, ['access my bank'], m => bot.log(`  ${m}`));
        return Execution.delayUntil(() => Bank.isOpen(), 4000);
    }
}

/** One funded pass over the shop: buy the chosen stock valuable-first, then
 *  hand back to banking (coins low / haul to stash) or wait out a restock. */
class BuyoutPass implements Task {
    constructor(private bot: ShopBuyout) {}

    validate(): boolean {
        return this.bot.inPhase('buy');
    }

    async execute(): Promise<void> {
        const bot = this.bot;
        bot.setStatus(`buying out ${bot.keeper}`);
        if (!(await Traversal.walkResilient(bot.shopStand, { radius: 2, attempts: 4, timeoutMs: 60_000, log: m => bot.log(`  ${m}`) }))) {
            bot.log('[buyout] walk to the shop failed — will retry');
            return;
        }
        if (!(await Shop.open(bot.keeper))) {
            bot.log(`[buyout] could not open ${bot.keeper}'s shop — will retry`);
            return;
        }

        const coins = Math.min(Inventory.count('Coins'), bot.budgetLeft());
        let boughtUnits = 0;
        for (const want of this.plan(coins)) {
            const gpBefore = Inventory.count('Coins');
            const bought = await Shop.buy(want.name, want.units);
            const spent = gpBefore - Inventory.count('Coins');
            if (bought > 0) {
                bot.sessionHaul[want.obj] = (bot.sessionHaul[want.obj] ?? 0) + bought;
                bot.sessionSpent += spent;
                boughtUnits += bought;
                bot.log(`[buyout] buy ${want.obj} n=${bought} spent=${spent} (session ${bot.sessionSpent}/${bot.budgetGp}gp)`);
            } else {
                bot.log(`[buyout] buy ${want.obj} n=0 of ${want.units} — stock gone or coins short`);
            }
            if (bot.budgetLeft() === 0) {
                break;
            }
        }
        await Shop.close();

        if (bot.budgetLeft() === 0 || (boughtUnits > 0 && Inventory.count('Coins') < 100)) {
            bot.toPhase('bank');
            return;
        }
        if (boughtUnits > 0) {
            return; // still funded and the shop may hold more — next loop re-plans immediately
        }
        // Drained shop: wait out the restock near the stand; a pending random
        // event ends the wait early so the Supervisor can run.
        bot.setStatus(`waiting for restock (${Math.round(bot.recheckMs / 1000)}s)`);
        await Execution.delayUntil(() => EventSignal.pending(), bot.recheckMs);
    }

    /** Valuable-first allocation over the OPEN shop's live stock. */
    private plan(coins: number): { obj: string; name: string; units: number }[] {
        const bot = this.bot;
        const stock = Shop.stock();
        if (bot.rec) {
            const byName = new Map(bot.rec.items.map(i => [i.name.toLowerCase(), i.obj]));
            const stockByObj: Record<string, number> = {};
            for (const row of stock) {
                const obj = byName.get(row.name.toLowerCase());
                if (obj) {
                    stockByObj[obj] = row.count;
                }
            }
            const anyChosen = bot.rec.items.some(i => bot.chosen.has(i.name.toLowerCase()) && (stockByObj[i.obj] ?? 0) > 0);
            const chosen = anyChosen ? bot.chosen : new Set(bot.rec.items.map(i => i.name.toLowerCase()));
            if (!anyChosen && stock.length > 0) {
                bot.log('[buyout] buyItems selection matches nothing here — buying all stock');
            }
            return buyoutPlan(bot.rec, stockByObj, coins, chosen);
        }
        // Unknown keeper: no price model — buy each row outright in shop order.
        return stock.filter(r => r.count > 0).map(r => ({ obj: r.name.toLowerCase(), name: r.name, units: r.count }));
    }
}
