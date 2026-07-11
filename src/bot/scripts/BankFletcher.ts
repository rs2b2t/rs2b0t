import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory, InvItem } from '../api/hud/Inventory.js';
import { Bank } from '../api/hud/Bank.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { matchProduct } from './BankFletcherLogic.js';

// Varrock West bank — a sane default; the exact stand tile is verified in the smoke.
const DEFAULT_BANK_STAND = new Tile(3185, 3440, 0);
const BOOTH = { op: 'Use-quickly' };

export const SETTINGS: SettingsSchema = {
    material: { type: 'string', default: 'Logs', label: 'Logs to fletch (contains)', help: 'bank item to withdraw — substring, resolved to the exact name (e.g. Logs / Oak logs / Willow logs)' },
    product: { type: 'string', default: 'Arrow shafts', options: ['Arrow shafts', 'Short bow', 'Long bow'], label: 'Fletch product', help: 'which make-menu option to pick (matched by keyword, so item-name or label form both work)' },
    knife: { type: 'string', default: 'Knife', label: 'Fletching tool (contains)', help: 'the tool used on the logs; lives in the bank between cycles' },
    bankStand: { type: 'tile', default: DEFAULT_BANK_STAND, label: 'Bank stand tile (x,z)', help: 'stand adjacent to a bank booth — start the bot here' },
    bankBooth: { type: 'string', default: 'Bank booth', label: 'Bank booth loc name' },
    leashRadius: { type: 'number', default: 6, min: 2, max: 20, label: 'Booth search radius (tiles)' }
};

/**
 * Bank-standing fletcher. At the bank tile: deposit the whole pack, withdraw one
 * knife + a full pack of logs (reading the real Withdraw-All op off the item like
 * CookBot), then use the knife on the last log to open the "What would you like to
 * make?" menu, pick the chosen product at the largest offered quantity, and ride
 * the batch until the logs run out — then deposit and repeat. No walking: the
 * knife is item-on-item at the bank, so everything happens on `bankStand`. The
 * knife lives in the bank between cycles (deposit-all then re-withdraw it), so no
 * keep-item logic is needed. Start it standing at a bank booth.
 */
export default class BankFletcher extends TaskBot {
    override loopDelay = 600;

    private made = 0;
    private trips = 0;
    private status = 'starting';

    private material = 'Logs';
    private product = 'Arrow shafts';
    private knife = 'Knife';
    private bankStand = DEFAULT_BANK_STAND;
    private boothName = 'Bank booth';
    private leash = 6;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.material = this.settings.str('material', 'Logs');
        this.product = this.settings.str('product', 'Arrow shafts');
        this.knife = this.settings.str('knife', 'Knife');
        this.bankStand = this.settings.tile('bankStand', DEFAULT_BANK_STAND);
        this.boothName = this.settings.str('bankBooth', 'Bank booth');
        this.leash = this.settings.num('leashRadius', 6);

        this.log(`BankFletcher fletching '${this.material}' → ${this.product} at ${this.bankStand} (booth '${this.boothName}', r${this.leash})`);
        this.add(new ContinueDialog(), new FletchDialog(this), new BankTrip(this), new Fletch(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const lines = [`BankFletcher — ${this.status}`, `${this.product}: ${this.made} fletched  bank trips ${this.trips}`, `logs left ${this.logCount()}  tick ${Game.tick()}`];
        ctx.font = '12px monospace';
        const width = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(6, 6, width, lines.length * 16 + 10);
        ctx.fillStyle = '#c9a0ff';
        lines.forEach((line, i) => ctx.fillText(line, 12, 24 + i * 16));
    }

    setStatus(s: string): void { this.status = s; }
    recordMade(n: number): void { this.made += n; }
    countTrip(): void { this.trips++; }
    productName(): string { return this.product; }
    materialName(): string { return this.material; }
    knifeName(): string { return this.knife; }
    bankTile(): Tile { return this.bankStand; }
    boothLocName(): string { return this.boothName; }
    leashRadius(): number { return this.leash; }

    /** Total logs in the pack (logs don't stack, but count defensively). */
    logCount(): number {
        const pat = this.material.toLowerCase();
        return Inventory.items().filter(i => i.name?.toLowerCase().includes(pat)).reduce((n, i) => n + Math.max(1, i.count), 0);
    }

    /** The LAST log in the pack (the fletch target), or null. */
    lastLog(): InvItem | null {
        const pat = this.material.toLowerCase();
        const items = Inventory.items();
        for (let i = items.length - 1; i >= 0; i--) {
            if (items[i].name?.toLowerCase().includes(pat)) {
                return items[i];
            }
        }
        return null;
    }

    /** The carried knife, or null. */
    knifeItem(): InvItem | null {
        const pat = this.knife.toLowerCase();
        return Inventory.items().find(i => i.name?.toLowerCase().includes(pat)) ?? null;
    }
}

class ContinueDialog implements Task {
    validate(): boolean { return ChatDialog.canContinue(); }
    async execute(): Promise<void> { await ChatDialog.continue(); }
}

/** The make-X menu is open → pick the chosen product (largest offered qty) and
 *  ride the fletch batch until the logs stop dropping (so we don't cancel an
 *  in-progress batch by re-interacting too early). */
class FletchDialog implements Task {
    constructor(private bot: BankFletcher) {}
    validate(): boolean { return ChatDialog.isMakeMenu(); }
    async execute(): Promise<void> {
        this.bot.setStatus('choosing product');
        const products = ChatDialog.makeProducts();
        const match = matchProduct(products, this.bot.productName());
        const start = this.bot.logCount();
        const picked = match ? await ChatDialog.make(match) : await ChatDialog.make();
        if (!picked) {
            this.bot.log(`make menu open but couldn't pick *${this.bot.productName()}* — products: [${products.join(', ')}]`);
            await Execution.delayTicks(1);
            return;
        }
        // let the batch start, then ride it here
        await Execution.delayUntil(() => Game.animating() || this.bot.logCount() < start || ChatDialog.isMakeMenu(), 3000);
        let mark = this.bot.logCount();
        for (let guard = 0; guard < 200; guard++) {
            if (this.bot.logCount() === 0 || ChatDialog.isMakeMenu() || ChatDialog.canContinue()) { return; }
            const progressed = await Execution.delayUntil(() => this.bot.logCount() < mark || ChatDialog.isMakeMenu() || ChatDialog.canContinue(), 4000);
            const now = this.bot.logCount();
            if (now < mark) {
                this.bot.recordMade(mark - now);
                mark = now;
            } else if (!progressed || !Game.animating()) {
                return;
            }
        }
    }
}

/** No logs in the pack → open the booth, deposit EVERYTHING (products + junk),
 *  then withdraw 1 knife and Withdraw-All logs. The knife lives in the bank, so
 *  no keep-item logic is needed. */
class BankTrip implements Task {
    constructor(private bot: BankFletcher) {}
    validate(): boolean { return this.bot.logCount() === 0; }
    async execute(): Promise<void> {
        this.bot.setStatus('banking');
        const opened = (await Bank.openBooth(this.bot.bankTile(), this.bot.boothLocName(), BOOTH.op, m => this.bot.log(`  ${m}`)))
            || (await Bank.openNearest(this.bot.boothLocName(), BOOTH.op, m => this.bot.log(`  ${m}`)));
        if (!opened) {
            this.bot.log('could not open the bank — will retry');
            return;
        }
        await Bank.depositInventory(); // products + leftovers — the whole pack
        await Execution.delayTicks(1);
        this.bot.countTrip();

        // Withdraw the knife FIRST (before logs fill the pack). Resolve the exact
        // bank name by substring — Bank.withdraw/count match EXACTLY.
        const knifePat = this.bot.knifeName().toLowerCase();
        const knifeBank = Bank.items().find(i => i.name !== null && i.name.toLowerCase().includes(knifePat));
        if (!knifeBank || knifeBank.name === null) {
            this.bot.log(`no '${this.bot.knifeName()}' in the bank — idling`);
            await Execution.delayTicks(5);
            return;
        }
        const knifeName = knifeBank.name;
        if (Inventory.count(knifeName) === 0) {
            // Read the real Withdraw-1 op off the item's OWN ops — the client
            // labels it 'Withdraw 1' / 'Withdraw-1' by build, and a hardcoded
            // label silently withdraws nothing (same trap as CookBot's Withdraw All).
            const knifeOps = knifeBank.ops.filter((o): o is string => o !== null);
            const oneOp = knifeOps.find(o => /withdraw[\s-]*1\b/i.test(o)) ?? knifeOps.find(o => /^withdraw/i.test(o)) ?? 'Withdraw-1';
            await Bank.withdraw(knifeName, oneOp);
            await Execution.delayUntil(() => Inventory.contains(knifeName), 3000);
        }

        // Withdraw-All logs. Read the REAL 'Withdraw All' op off the item's own
        // ops (a hardcoded label silently withdraws nothing), like CookBot.
        const logPat = this.bot.materialName().toLowerCase();
        const logItem = Bank.items().find(i => i.name !== null && i.name.toLowerCase().includes(logPat));
        if (!logItem || logItem.name === null) {
            this.bot.log(`no '${this.bot.materialName()}' in the bank — idling`);
            await Execution.delayTicks(5);
            return;
        }
        const logName = logItem.name;
        const ops = logItem.ops.filter((o): o is string => o !== null);
        const allOp = ops.find(o => /withdraw[\s-]*all/i.test(o));
        if (allOp) {
            this.bot.log(`withdrawing all ${logName} ('${allOp}')`);
            await Bank.withdraw(logName, allOp);
            await Execution.delayUntil(() => this.bot.logCount() > 0 || Bank.count(logName) === 0, 4000);
        } else {
            const tenOp = ops.find(o => /withdraw[\s-]*10/i.test(o)) ?? ops.find(o => /^withdraw/i.test(o)) ?? 'Withdraw-10';
            this.bot.log(`withdrawing ${logName} 10 at a time ('${tenOp}')`);
            for (let n = 0; n < 4 && !Inventory.isFull() && Bank.count(logName) > 0; n++) {
                const before = this.bot.logCount();
                await Bank.withdraw(logName, tenOp);
                if (!(await Execution.delayUntil(() => this.bot.logCount() > before || Inventory.isFull(), 3000))) { break; }
            }
        }
    }
}

/** Logs in the pack and no dialog open → use the knife on the last log, opening
 *  the make menu (FletchDialog picks the product and rides the batch), one batch
 *  per interaction until no logs remain. */
class Fletch implements Task {
    constructor(private bot: BankFletcher) {}
    validate(): boolean { return this.bot.logCount() > 0 && !ChatDialog.isOpen(); }
    async execute(): Promise<void> {
        for (let n = 0; n < 30 && this.bot.logCount() > 0; n++) {
            if (ChatDialog.isMakeMenu() || ChatDialog.canContinue()) { return; }
            const knife = this.bot.knifeItem();
            const log = this.bot.lastLog();
            if (!knife || !log) { await Execution.delayTicks(2); return; }
            this.bot.setStatus(`fletching ${this.bot.productName()}`);
            const before = this.bot.logCount();
            if (!(await knife.useOn(log))) { await Execution.delayTicks(2); continue; }
            // wait for the make menu, a log to be consumed, or a blocking dialog
            await Execution.delayUntil(() => ChatDialog.isMakeMenu() || this.bot.logCount() < before || ChatDialog.canContinue(), 8000);
            if (ChatDialog.isMakeMenu()) { return; } // FletchDialog selects + rides the batch
        }
    }
}
