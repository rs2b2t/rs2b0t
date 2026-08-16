import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Bank } from '../../api/bank/Bank.js';
import { Skills } from '../../api/skills/Skills.js';
import { Paint } from '../../paint/Paint.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { nearestBank } from '../../api/bank/BankLocations.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import {
    BAR_OPTIONS,
    FIRE_STAFF,
    MAGIC_REQUIRED,
    NATURES_DEFAULT,
    NATURES_MIN,
    NATURE_RUNE,
    barsPerTrip,
    barsSmeltable,
    primaryOre,
    recipeForBar,
    withdrawSet,
    type Recipe
} from './SuperheaterLogic.js';

const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const MAGIC_TAB = 6;
const SUPERHEAT_ITEM = 'Superheat Item';

export const SUPERHEATER_SETTINGS: SettingsSchema = {
    bar: {
        type: 'string',
        default: 'Bronze',
        options: [...BAR_OPTIONS],
        label: 'Bar to smelt',
        help: 'withdraw plan + coal ratio are derived from this; cast onto the primary ore'
    },
    natures: {
        type: 'number',
        default: NATURES_DEFAULT,
        min: NATURES_MIN,
        max: 1000,
        label: 'Nature runes to keep in the pack',
        help: 'topped up whenever the pack count drops below this; keep it above the casts-per-trip so a short bank stock never stalls the run'
    }
};

export default class Superheater extends TaskBot {
    override loopDelay = 400;

    private bar: Recipe = recipeForBar('Bronze')!;
    private natures = NATURES_DEFAULT;

    // Why: the bank access is resolved once; every trip just opens the booth.
    private bankAccess: { name: string; op: string } = BOOTH;

    private smelted = 0;
    private trips = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;
    private magicXpAtStart = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        const barName = this.settings.str('bar', 'Bronze');
        this.bar = recipeForBar(barName) ?? recipeForBar('Bronze')!;
        this.natures = this.settings.num('natures', NATURES_DEFAULT);

        if (Skills.level('magic') < MAGIC_REQUIRED) {
            this.log(`Superheat Item needs ${MAGIC_REQUIRED} Magic (have ${Skills.level('magic')}) — stopping`);
            ScriptRunner.stop(`Superheat Item needs ${MAGIC_REQUIRED} Magic`);
            return;
        }
        if (Skills.level('smithing') < this.bar.level) {
            this.log(`${this.bar.bar} bars need ${this.bar.level} Smithing (have ${Skills.level('smithing')}) — stopping`);
            ScriptRunner.stop(`${this.bar.bar} bars need ${this.bar.level} Smithing`);
            return;
        }

        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('smithing');
        this.magicXpAtStart = Skills.xp('magic');

        const plan = Object.entries(withdrawSet(this.bar)).map(([ore, n]) => `${n} ${ore}`).join(' + ');
        this.log(`Superheater — ${this.bar.bar} via ${SUPERHEAT_ITEM} (${plan}), keeping ${this.natures} ${NATURE_RUNE}s`);
        if (!(await this.resolveBank())) {
            return;
        }
        this.add(
            new EnsureGear(this),
            new BankBars(this),
            new Restock(this),
            new Smelt(this)
        );
    }

    // Why: resolve the nearest bank once and walk to it; later trips reuse bankAccess.
    async resolveBank(): Promise<boolean> {
        const here = Game.tile();
        if (!here) {
            return false;
        }
        const bank = nearestBank(here);
        if (!bank) {
            this.log('no reachable bank — stopping');
            ScriptRunner.stop('no reachable bank');
            return false;
        }
        this.bankAccess = bank.access ?? BOOTH;
        this.log(`banking at ${bank.name} (${this.bankAccess.name} / ${this.bankAccess.op})`);

        const near = bank.tile.level === here.level && bank.tile.distanceTo(here) <= 4;
        if (near) {
            return true;
        }
        this.setStatus(`walking to ${bank.name}`);
        if (!(await Traversal.walkResilient(bank.tile, { radius: 3, attempts: 4, timeoutMs: 180_000, log: m => this.log(`  ${m}`) }))) {
            this.log('walk to the bank failed — stopping');
            ScriptRunner.stop('walk to the bank failed');
            return false;
        }
        return true;
    }

    // Why: once at the bank the scene lookup picks the closest booth/chest, so no stored stand is needed.
    async openBank(): Promise<boolean> {
        if (Bank.isOpen()) {
            return true;
        }
        this.setStatus('opening bank');
        this.log(`opening ${this.bankAccess.name} (${this.bankAccess.op})`);
        if (!(await Bank.openNearest(this.bankAccess.name, this.bankAccess.op, m => this.log(`  ${m}`)))) {
            this.log('could not open the bank — retrying');
            return false;
        }
        this.log('bank open');
        return true;
    }

    setStatus(s: string): void {
        this.status = s;
    }
    recipe(): Recipe {
        return this.bar;
    }
    // Why: a nature rune funds each cast, so a smelt needs the full ingredient set AND one nature rune.
    canSmeltOne(): boolean {
        return this.bar.ingredients.every(i => Inventory.count(i.ore) >= i.perBar) && Inventory.count(NATURE_RUNE) > 0;
    }
    natureTarget(): number {
        return this.natures;
    }
    recordSmelt(n: number): void {
        this.smelted += n;
    }
    countTrip(): void {
        this.trips++;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#ff9d3b' });
        p.title(`Superheater — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        p.row(`Runtime: ${fmtDuration(mins)}`, `${this.bar.bar} bars: ${this.smelted}`, `Smithing XP/hr: ${this.xpPerHour('smithing', this.xpAtStart)}`);
        p.row(`Magic XP/hr: ${this.xpPerHour('magic', this.magicXpAtStart)}`, `Smithing: ${Skills.level('smithing')}`, `Magic: ${Skills.level('magic')}`);
        p.row(`Bank trips: ${this.trips}`, `Runes: ${Inventory.count(NATURE_RUNE)}/${this.natures}`, `${primaryOre(this.bar)}: ${Inventory.count(primaryOre(this.bar))}`, `Pack: ${Inventory.used()}`);
        p.bar('Pack', Inventory.used() / 28);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }

    private xpPerHour(skill: string, start: number): string {
        const mins = (Date.now() - this.startedAt) / 60_000;
        if (mins < 0.5) {
            return '—';
        }
        const xp = Skills.xp(skill) - start;
        return `${((xp / mins) * 60 / 1000).toFixed(1)}k`;
    }
}

// Why: set the staff of fire once; deposit everything, withdraw one, close so Wield is a real backpack op, wield, reopen.
class EnsureGear implements Task {
    constructor(private bot: Superheater) {}

    validate(): boolean {
        return !Equipment.contains(FIRE_STAFF);
    }

    async execute(): Promise<void> {
        if (!(await this.bot.openBank())) {
            return;
        }
        if (Inventory.used() > 0) {
            await Bank.depositAllMatching(() => true);
            await Execution.delayTicks(1);
        }
        if (Inventory.count(FIRE_STAFF) === 0) {
            if (!(await Bank.withdrawX(FIRE_STAFF, 1))) {
                this.bot.log(`no ${FIRE_STAFF} in the bank — stopping`);
                ScriptRunner.stop(`no ${FIRE_STAFF} in the bank`);
                return;
            }
        }
        if (!(await Bank.close())) {
            this.bot.log('bank would not close — retrying');
            return;
        }
        this.bot.setStatus(`wielding ${FIRE_STAFF}`);
        if (!(await Equipment.equip(FIRE_STAFF))) {
            this.bot.log(`could not wield ${FIRE_STAFF} — stopping`);
            ScriptRunner.stop(`could not wield ${FIRE_STAFF}`);
            return;
        }
        this.bot.log(`wore ${FIRE_STAFF} — casts need only ${NATURE_RUNE}s now`);
        await this.bot.openBank();
    }
}

// Why: restock tops up nature runes then withdraws exactly one trip's ores and closes; the bank is normally already open.
class Restock implements Task {
    constructor(private bot: Superheater) {}

    validate(): boolean {
        return !this.bot.canSmeltOne();
    }

    async execute(): Promise<void> {
        if (!(await this.openBank())) {
            return;
        }

        // Why: clear whatever is left (bars, partial ores, junk) — only nature runes stay — so every restock starts from a known-empty pack.
        this.bot.setStatus('restocking');
        if (Inventory.used() > 0) {
            const before = Inventory.used();
            await Bank.depositAllMatching(name => name.toLowerCase() !== NATURE_RUNE.toLowerCase());
            await Execution.delayTicks(1);
            const cleared = before - Inventory.used();
            if (cleared > 0) {
                this.bot.log(`cleared ${cleared} items from the pack`);
            }
        }
        if (!(await this.topUpNatures())) {
            return;
        }
        if (!(await this.withdrawOres())) {
            return;
        }

        if (!(await Bank.close())) {
            this.bot.log('bank would not close — retrying');
            return;
        }

        this.bot.countTrip();
        this.bot.log(
            `restocked: ${Object.entries(withdrawSet(this.bot.recipe())).map(([ore, n]) => `${n} ${ore}`).join(' + ')} + ${Inventory.count(NATURE_RUNE)} ${NATURE_RUNE}s`
        );
    }

    private async openBank(): Promise<boolean> {
        return this.bot.openBank();
    }

    private async topUpNatures(): Promise<boolean> {
        const have = Inventory.count(NATURE_RUNE);
        // Why: only top up when the pack can't cover the next trip — no need to carry more than the casts-per-inventory amount.
        const coversTrip = have >= barsPerTrip(this.bot.recipe());
        const want = this.bot.natureTarget() - have;
        if (coversTrip || want <= 0) {
            return true;
        }
        const before = Inventory.count(NATURE_RUNE);
        if (await Bank.withdrawX(NATURE_RUNE, want)) {
            this.bot.log(`topped up ${NATURE_RUNE}s to ${Inventory.count(NATURE_RUNE)}`);
            return true;
        }
        if (Inventory.count(NATURE_RUNE) === before && Bank.count(NATURE_RUNE) === 0) {
            this.bot.log(`no ${NATURE_RUNE}s in the bank — stopping`);
            ScriptRunner.stop(`no ${NATURE_RUNE}s in the bank`);
        }
        return false;
    }

    private async withdrawOres(): Promise<boolean> {
        const set = withdrawSet(this.bot.recipe());
        for (const [ore, count] of Object.entries(set)) {
            this.bot.log(`withdrawing ${count} ${ore}`);
            const before = Inventory.count(ore);
            const ok = await Bank.withdrawX(ore, count);
            const got = Inventory.count(ore) - before;
            this.bot.log(`got ${got} ${ore}`);
            if (!ok || got === 0) {
                this.bot.log(`no ${ore} in the bank (wanted ${count}) — stopping`);
                ScriptRunner.stop(`no ${ore} in the bank`);
                return false;
            }
            if (got < count) {
                this.bot.log(`WARNING: only ${got}/${count} ${ore} withdrawn — a partial recipe smelts the wrong bar`);
                ScriptRunner.stop(`only ${got} ${ore} in the bank`);
                return false;
            }
        }
        return true;
    }
}

// Why: cast Superheat Item onto the primary ore once per bar at a single-cast pace; ends when the primary ore stack is gone.
class Smelt implements Task {
    constructor(private bot: Superheater) {}

    validate(): boolean {
        if (Bank.isOpen()) {
            return false;
        }
        return this.bot.canSmeltOne();
    }

    async execute(): Promise<void> {
        this.bot.setStatus(`casting ${SUPERHEAT_ITEM} on ${primaryOre(this.bot.recipe())}`);

        if (!(await Game.openSideTab(MAGIC_TAB))) {
            this.bot.log('could not open the magic tab — retrying');
            return;
        }

        const recipe = this.bot.recipe();

        // Why: casting on a partial recipe smelts the wrong bar (iron without coal makes an iron bar), so every cast requires the full set plus a nature rune — exactly what canSmeltOne() checks. Pace each cast on the bar forming: the ore count drops a tick or two after the cast lands, so wait before clicking again.
        const start = barsSmeltable(recipe, ore => Inventory.count(ore));

        while (this.bot.canSmeltOne()) {
            const left = barsSmeltable(recipe, ore => Inventory.count(ore));
            this.bot.log(`casting on ${primaryOre(recipe)} (${left} more bars' worth of ore left, ${Inventory.count(NATURE_RUNE)} ${NATURE_RUNE}s)`);
            const ore = Inventory.first(primaryOre(recipe));
            if (!ore) {
                break;
            }
            if (!(await Game.castOnItem(SUPERHEAT_ITEM, ore))) {
                this.bot.log(`cast-on-item was rejected for ${ore.name} — retrying`);
                await Execution.delayTicks(1);
                continue;
            }
            await Execution.delayTicks(3);
        }

        this.bot.recordSmelt(start - barsSmeltable(recipe, ore => Inventory.count(ore)));

        if (Inventory.count(primaryOre(recipe)) > 0) {
            const left = barsSmeltable(recipe, ore => Inventory.count(ore));
            if (Inventory.count(NATURE_RUNE) === 0) {
                this.bot.log(`out of ${NATURE_RUNE}s with ${left} bars' worth of ore left — banking to restock`);
            } else {
                this.bot.log(`WARNING: stopped early — ${left} more bars' worth of ore left, but the loop bailed. No partial-recipe casts were sent.`);
            }
        }
    }
}

// Why: bank the bars — deposit everything except the nature-rune stack and leave the bank open so the next Restock reuses it.
class BankBars implements Task {
    constructor(private bot: Superheater) {}

    validate(): boolean {
        return !Bank.isOpen() && Inventory.count(primaryOre(this.bot.recipe())) === 0 && Inventory.used() > 0;
    }

    async execute(): Promise<void> {
        this.bot.setStatus('banking bars');

        if (!(await this.bot.openBank())) {
            this.bot.log('could not open the bank — retrying');
            return;
        }

        const before = Inventory.used();

        await Bank.depositAllMatching(
            name => name.toLowerCase() !== NATURE_RUNE.toLowerCase()
        );

        const deposited = before - Inventory.used();
        this.bot.log(
            `deposited ${deposited} items (kept ${Inventory.count(NATURE_RUNE)} ${NATURE_RUNE}s), bank left open`
        );
    }
}
