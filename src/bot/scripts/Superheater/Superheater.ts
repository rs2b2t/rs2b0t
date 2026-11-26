import type { Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { Game, waitForPlayerTile } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Bank } from '../../api/bank/Bank.js';
import { BankMagicBot } from '../../api/magic/BankMagicBot.js';
import { Skills } from '../../api/skills/Skills.js';
import { Paint } from '../../paint/Paint.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { actions, reader } from '../../adapter/ClientAdapter.js';
import { Input } from '../../input/Input.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import {
    BAR_OPTIONS,
    MAGIC_REQUIRED,
    NATURES_DEFAULT,
    NATURES_MIN,
    NATURE_RUNE,
    SUPERHEAT_FIRES,
    barsPerTrip,
    barsSmeltable,
    opIndex,
    primaryOre,
    recipeForBar,
    wantsGoldsmithGauntlets,
    withdrawSet,
    type Recipe
} from './SuperheaterLogic.js';

const MAGIC_TAB = 6;
const SUPERHEAT_ITEM = 'Superheat Item';

/** Why: long loops must yield to the random-event guardian or its interaction gets raced; ContinueDialog handles ordinary dialogs. */
function mustYield(): boolean {
    return EventSignal.pending() || ChatDialog.isOpen() || ChatDialog.canContinue();
}

export const SUPERHEATER_SETTINGS: SettingsSchema = {
    useFireRunes: { type: 'boolean', default: false, label: 'Use fire runes instead of a staff' },
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
    },
    goldsmithGauntlets: {
        type: 'boolean',
        default: true,
        label: 'Goldsmith gauntlets',
        help: 'gold only: withdraw and wear the Goldsmith gauntlet for 2.5x Smithing XP; the run stops if none is in the bank',
        showIf: { key: 'bar', anyOf: ['Gold'] }
    },
    fastBank: {
        type: 'boolean',
        default: true,
        label: 'Instant bank leg',
        help: 'single-ore bars: deposit, top up natures, withdraw the whole ore load and close in one pass; a miss falls back to the confirmed route for that trip',
        showIf: { key: 'bar', anyOf: ['Iron', 'Silver', 'Gold', 'Blurite'] }
    }
};

export default class Superheater extends BankMagicBot {
    override loopDelay = 400;

    private bar: Recipe = recipeForBar('Bronze')!;
    private natures = NATURES_DEFAULT;
    useFireRunes = false;
    private goldsmith = true;
    private fastBank = true;

    private smelted = 0;
    private trips = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;
    private magicXpAtStart = 0;

    override async onStart(): Promise<void> {
        await waitForPlayerTile();

        const barName = this.settings.str('bar', 'Bronze');
        this.bar = recipeForBar(barName) ?? recipeForBar('Bronze')!;
        this.useFireRunes = this.settings.bool('useFireRunes', false);
        this.natures = this.settings.num('natures', NATURES_DEFAULT);
        this.goldsmith = this.settings.bool('goldsmithGauntlets', true);
        this.fastBank = this.settings.bool('fastBank', true);

        if (Skills.level('magic') < MAGIC_REQUIRED) {
            this.log(`Superheat Item needs ${MAGIC_REQUIRED} Magic (have ${Skills.level('magic')}) — stopping`);
            this.requestFinish(`Superheat Item needs ${MAGIC_REQUIRED} Magic`);
            return;
        }
        if (Skills.level('smithing') < this.bar.level) {
            this.log(`${this.bar.bar} bars need ${this.bar.level} Smithing (have ${Skills.level('smithing')}) — stopping`);
            this.requestFinish(`${this.bar.bar} bars need ${this.bar.level} Smithing`);
            return;
        }

        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('smithing');
        this.magicXpAtStart = Skills.xp('magic');

        const plan = Object.entries(withdrawSet(this.bar, this.useFireRunes)).map(([ore, n]) => `${n} ${ore}`).join(' + ');
        this.log(`Superheater — ${this.bar.bar} via ${SUPERHEAT_ITEM} (${plan}), keeping ${this.natures} ${NATURE_RUNE}s`);
        if (!(await this.resolveBank())) {
            return;
        }
        this.add(
            new ContinueDialog(),
            this.fireStaffTask(() => this.useFireRunes, mustYield),
            new EnsureGauntlets(this),
            new Restock(this),
            new Smelt(this)
        );
    }

    // Why: once at the bank the scene lookup picks the closest booth/chest, so no stored stand is needed.
    override async openBank(): Promise<boolean> {
        if (Bank.isOpen()) {
            return true;
        }
        this.setStatus('opening bank');
        this.log(`opening ${this.bankAccess.name} (${this.bankAccess.op})`);
        if (!(await this.openResolvedBank())) {
            this.log('could not open the bank — retrying');
            return false;
        }
        this.log('bank open');
        return true;
    }

    override setStatus(s: string): void {
        this.status = s;
    }
    recipe(): Recipe {
        return this.bar;
    }
    /** Gold bars only: the 2.5x gauntlets are worth stopping for when the toggle is on. */
    needsGauntlets(): boolean {
        return wantsGoldsmithGauntlets(this.bar.bar, this.goldsmith);
    }
    // Why: a nature rune funds each cast, so a smelt needs the full ingredient set AND one nature rune.
    canSmeltOne(): boolean {
        return this.bar.ingredients.every(i => Inventory.count(i.ore) >= i.perBar) && this.fundedCasts() > 0;
    }
    fundedCasts(): number {
        const natures = Inventory.count(NATURE_RUNE);
        return this.useFireRunes ? Math.min(natures, Math.floor(Inventory.count('Fire rune') / SUPERHEAT_FIRES)) : natures;
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

    /** Why: bank requests are handled in send order, so deposit, Withdraw-All, close and the ore landing can all go without a wait. */
    async fastRestock(): Promise<boolean> {
        if (!this.fastBank || this.useFireRunes || this.bar.ingredients.length !== 1) {
            return false;
        }
        const side = reader.bankSideItems();
        if (side.length === 0) {
            return false;
        }
        const barName = `${this.bar.bar} bar`.toLowerCase();
        const bar = side.find(i => (i.name ?? '').toLowerCase() === barName);
        if (!bar) {
            return false;
        }
        // Why: anything other than the bars being deposited and the nature stack makes the free-slot count unknowable.
        const natures = side.find(i => (i.name ?? '').toLowerCase() === NATURE_RUNE.toLowerCase());
        const known = new Set<number>([bar.id, ...(natures ? [natures.id] : [])]);
        if (side.some(i => !known.has(i.id))) {
            return false;
        }

        const oreName = primaryOre(this.bar);
        const ore = Bank.items().find(i => (i.name ?? '').toLowerCase() === oreName.toLowerCase());
        if (!ore) {
            return false;
        }
        const barOp = opIndex(bar.ops, /deposit[\s-]*all/i);
        const oreOp = opIndex(ore.ops, /withdraw[\s-]*all/i);
        if (barOp === -1 || oreOp === -1) {
            return false;
        }

        // Why: deposit and withdrawal are handled in send order, so the ore fills the slots the bars just freed without a wait.
        Input.invButton(bar.id, bar.slot, bar.comId, barOp);
        Input.invButton(ore.id, ore.slot, ore.comId, oreOp);
        actions.closeModal();

        if (!(await Execution.delayUntil(() => Inventory.count(oreName) > 0, 1500))) {
            this.log('instant bank missed: the withdrawal did not land — using the confirmed route');
            return false;
        }
        if (Bank.isOpen()) {
            await Execution.delayUntil(() => !Bank.isOpen(), 1000);
            if (Bank.isOpen()) {
                await Bank.close();
            }
        }
        this.log(`instant bank: ${Inventory.count(oreName)} ${oreName}, ${Inventory.count(NATURE_RUNE)} ${NATURE_RUNE}s`);
        return true;
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

// Why: gold bars get 2.5x Smithing XP with the gauntlets, so the toggle stops the run rather than quietly smelting at the base rate.
class EnsureGauntlets implements Task {
    constructor(private bot: Superheater) {}

    validate(): boolean {
        return !mustYield() && this.bot.needsGauntlets() && !Equipment.contains('Goldsmith gauntlet');
    }

    async execute(): Promise<void> {
        if (!(await this.bot.openBank())) {
            return;
        }
        if (mustYield()) {
            return;
        }
        if (Inventory.first('Goldsmith gauntlet') === null) {
            const available = Bank.count('Goldsmith gauntlet') !== 0;
            if (available) this.bot.log('withdrawing Goldsmith gauntlet');
            if (!available || !(await Bank.withdrawX('Goldsmith gauntlet', 1))) {
                if (await this.bot.bankTrulyOutOf('Goldsmith gauntlet')) {
                    this.bot.log('no Goldsmith gauntlet in the bank — stopping');
                    this.bot.requestFinish('no Goldsmith gauntlet in the bank');
                }
                return;
            }
        }
        if (!(await this.bot.closeBankToEquip('Goldsmith gauntlet')) || mustYield()) {
            return;
        }
        this.bot.setStatus('wearing Goldsmith gauntlet');
        if (!(await Equipment.equip('Goldsmith gauntlet'))) {
            this.bot.log('could not equip the Goldsmith gauntlet — stopping');
            this.bot.requestFinish('could not equip the Goldsmith gauntlet');
            return;
        }
        this.bot.log('wore the Goldsmith gauntlet — gold bars give 2.5x Smithing XP');
        await this.bot.openBank();
    }
}

// Why: restock tops up nature runes, withdraws one trip's ores and closes; the bank is normally already open.
class Restock implements Task {
    constructor(private bot: Superheater) {}

    validate(): boolean {
        return !mustYield() && (Bank.isOpen() || !this.bot.canSmeltOne());
    }

    async execute(): Promise<void> {
        if (!(await this.openBank())) {
            return;
        }
        if (mustYield()) {
            this.bot.log('pausing for a random event');
            return;
        }

        if (this.bot.canSmeltOne()) {
            await Bank.close();
            return;
        }

        this.bot.setStatus('restocking');
        // Why: runes stack, so the exact top-up can run before the fused pass and still only fires when the pack cannot cover the next trip.
        if (!(await this.topUpNatures())) {
            return;
        }
        if (mustYield()) {
            this.bot.log('pausing for a random event');
            return;
        }
        // Why: on a completed trip the pack holds only bars and natures, so the whole leg can go out in one pass before any wait.
        if (await this.bot.fastRestock()) {
            this.bot.countTrip();
            this.bot.log(
                `restocked: ${Object.entries(withdrawSet(this.bot.recipe())).map(([ore, n]) => `${n} ${ore}`).join(' + ')} + ${Inventory.count(NATURE_RUNE)} ${NATURE_RUNE}s (instant)`
            );
            return;
        }
        if (Inventory.used() > 0) {
            const before = Inventory.used();
            await Bank.depositAllMatching(name => name.toLowerCase() !== NATURE_RUNE.toLowerCase() && !(this.bot.useFireRunes && name.toLowerCase() === 'fire rune'));
            // Why: depositAllMatching waits for each row to leave the side pack, and the ore withdrawal that follows confirms the bank update; the old extra tick bought nothing.
            const cleared = before - Inventory.used();
            if (cleared > 0) {
                this.bot.log(`cleared ${cleared} items from the pack`);
            }
        }
        if (mustYield()) {
            this.bot.log('pausing for a random event');
            return;
        }
        if (this.bot.useFireRunes) {
            const casts = Math.min(Inventory.count(NATURE_RUNE), barsPerTrip(this.bot.recipe(), true));
            const need = casts * SUPERHEAT_FIRES - Inventory.count('Fire rune');
            if (need > 0) await Bank.withdrawX('Fire rune', need);
            if (Inventory.count('Fire rune') < SUPERHEAT_FIRES) {
                if (await this.bot.bankTrulyOutOf('Fire rune')) this.bot.requestFinish('not enough Fire runes for one cast');
                return;
            }
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
            `restocked for ${barsSmeltable(this.bot.recipe(), ore => Inventory.count(ore))} ${this.bot.recipe().bar} bars`
        );
    }

    private async openBank(): Promise<boolean> {
        return this.bot.openBank();
    }

    private async topUpNatures(): Promise<boolean> {
        if (mustYield()) {
            return false;
        }
        const have = Inventory.count(NATURE_RUNE);
        // Why: only top up when the pack cannot cover the next trip. Carrying more than the casts-per-inventory amount buys nothing.
        const coversTrip = have >= barsPerTrip(this.bot.recipe());
        const want = this.bot.natureTarget() - have;
        if (coversTrip || want <= 0) {
            return true;
        }
        if (!(await Bank.waitReady(3500))) return false;
        if (Bank.count(NATURE_RUNE) === 0) {
            if (have > 0) return true;
            this.bot.requestFinish(`no ${NATURE_RUNE}s in the bank`);
            return false;
        }
        const before = have;

        // Why: a small top-up fits the five-events-a-tick budget with fixed clicks, so the common case skips the X dialog; a large target still uses one exact X withdraw instead of dozens of clicks.
        if (want <= 50) {
            for (let pass = 0; pass < 2 && Inventory.count(NATURE_RUNE) < this.bot.natureTarget(); pass++) {
                let need = this.bot.natureTarget() - Inventory.count(NATURE_RUNE);
                let sent = 0;
                while (need > 0 && sent < 5) {
                    const take = need >= 10 ? 10 : need >= 5 ? 5 : 1;
                    if (!(await Bank.withdraw(NATURE_RUNE, `Withdraw-${take}`))) {
                        break;
                    }
                    need -= take;
                    sent++;
                }
                if (sent === 0) {
                    break;
                }
                await Execution.delayUntil(() => Inventory.count(NATURE_RUNE) > before, 1500);
            }
            if (Inventory.count(NATURE_RUNE) > before && Inventory.count(NATURE_RUNE) >= barsPerTrip(this.bot.recipe())) {
                this.bot.log(`topped up ${NATURE_RUNE}s to ${Inventory.count(NATURE_RUNE)}`);
                return true;
            }
        }

        if (Inventory.count(NATURE_RUNE) > 0 && Bank.count(NATURE_RUNE) === 0) return true;
        const remaining = this.bot.natureTarget() - Inventory.count(NATURE_RUNE);
        if (remaining > 0 && (await Bank.withdrawX(NATURE_RUNE, remaining))) {
            this.bot.log(`topped up ${NATURE_RUNE}s to ${Inventory.count(NATURE_RUNE)}`);
            return true;
        }
        if (Inventory.count(NATURE_RUNE) === before && Bank.count(NATURE_RUNE) === 0) {
            // The bank list may still be settling, so confirm the runes are gone before stopping.
            if (!(await this.bot.bankTrulyOutOf(NATURE_RUNE))) {
                this.bot.log('nature-rune count is still settling — retrying');
                return false;
            }
            this.bot.log(`no ${NATURE_RUNE}s in the bank — stopping`);
            this.bot.requestFinish(`no ${NATURE_RUNE}s in the bank`);
        }
        return false;
    }

    private async withdrawOres(): Promise<boolean> {
        if (mustYield()) {
            return false;
        }
        const recipe = this.bot.recipe();
        // Why: a one-ore recipe fills the 27 free slots with a single Withdraw-All click, skipping the count dialog and its two server waits.
        if (recipe.ingredients.length === 1) {
            const ore = recipe.ingredients[0].ore;
            return this.withdrawAllOf(ore, withdrawSet(recipe, this.bot.useFireRunes)[ore]);
        }
        if (!(await Bank.waitReady(3500))) return false;
        const bars = Math.min(barsPerTrip(recipe, this.bot.useFireRunes), this.bot.fundedCasts(), barsSmeltable(recipe, ore => Bank.count(ore)));
        if (!bars) {
            this.bot.requestFinish(`the bank cannot supply one ${recipe.bar} bar`);
            return false;
        }
        for (const { ore, perBar } of recipe.ingredients) {
            if (mustYield() || !(await Bank.withdrawX(ore, bars * perBar))) return false;
        }
        return true;
    }

    /** Single-ingredient recipe: one Withdraw-All fills every free slot, so a short bank still smelts what is there. */
    private async withdrawAllOf(ore: string, count: number): Promise<boolean> {
        this.bot.log(`withdrawing all ${ore} (up to ${count})`);
        const before = Inventory.count(ore);
        if (!(await Bank.withdrawLoad(ore))) {
            if (!(await this.bot.bankTrulyOutOf(ore))) {
                this.bot.log(`withdraw of ${ore} stalled but the bank list is still settling — retrying`);
                return false;
            }
            if (Bank.count(ore) > 0) {
                this.bot.log(`bank still has ${ore} but the withdraw stalled — retrying`);
                return false;
            }
            this.bot.log(`no ${ore} in the bank — stopping`);
            this.bot.requestFinish(`no ${ore} in the bank`);
            return false;
        }
        const got = Inventory.count(ore) - before;
        this.bot.log(`got ${got} ${ore}`);
        if (got === 0) {
            if (!(await this.bot.bankTrulyOutOf(ore))) {
                this.bot.log(`withdraw of ${ore} landed nothing but the bank list is still settling — retrying`);
                return false;
            }
            this.bot.log(`no ${ore} in the bank — stopping`);
            this.bot.requestFinish(`no ${ore} in the bank`);
            return false;
        }
        if (got < count) {
            this.bot.log(`WARNING: only ${got}/${count} ${ore} withdrawn — smelting what the bank has`);
        }
        return true;
    }
}

// Why: cast Superheat Item onto the primary ore once per bar at a single-cast pace; ends when the primary ore stack is gone.
class Smelt implements Task {
    constructor(private bot: Superheater) {}

    validate(): boolean {
        if (Bank.isOpen() || mustYield()) {
            return false;
        }
        return this.bot.canSmeltOne();
    }

    async execute(): Promise<void> {
        this.bot.setStatus(`casting ${SUPERHEAT_ITEM} on ${primaryOre(this.bot.recipe())}`);

        if (mustYield()) {
            this.bot.log('pausing for a random event');
            return;
        }
        if (!(await Game.openSideTab(MAGIC_TAB))) {
            this.bot.log('could not open the magic tab — retrying');
            return;
        }

        const recipe = this.bot.recipe();

        const name = primaryOre(recipe);
        const ore = Inventory.first(name);
        if (!ore) return;
        const before = Inventory.count(name);
        if (!(await Game.castOnItem(SUPERHEAT_ITEM, ore))) {
            this.bot.log(`cast-on-item was rejected for ${ore.name}`);
            await Execution.delayTicks(1);
            return;
        }
        await Execution.delayTicks(3);
        if (Inventory.count(name) < before) this.bot.recordSmelt(1);
    }
}
