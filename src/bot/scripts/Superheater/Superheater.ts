import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Bank } from '../../api/bank/Bank.js';
import { openBankAccess } from '../../api/bank/Banking.js';
import { Skills } from '../../api/skills/Skills.js';
import { Paint } from '../../paint/Paint.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { nearestBankReachable, type BankLocation } from '../../api/bank/BankLocations.js';
import { Navigator } from '../../event/webwalk/Navigator.js';
import { actions, reader } from '../../adapter/ClientAdapter.js';
import { Input } from '../../input/Input.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import {
    BAR_OPTIONS,
    FIRE_STAVES,
    MAGIC_REQUIRED,
    NATURES_DEFAULT,
    NATURES_MIN,
    NATURE_RUNE,
    barsPerTrip,
    barsSmeltable,
    opIndex,
    pickFireStaff,
    primaryOre,
    recipeForBar,
    wantsGoldsmithGauntlets,
    withdrawSet,
    type Recipe
} from './SuperheaterLogic.js';

const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const MAGIC_TAB = 6;
const SUPERHEAT_ITEM = 'Superheat Item';

/** Why: long loops must yield to the random-event guardian or its interaction gets raced; ContinueDialog handles ordinary dialogs. */
function mustYield(): boolean {
    return EventSignal.pending() || ChatDialog.isOpen() || ChatDialog.canContinue();
}

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

export default class Superheater extends TaskBot {
    override loopDelay = 400;

    private bar: Recipe = recipeForBar('Bronze')!;
    private natures = NATURES_DEFAULT;
    private goldsmith = true;
    private fastBank = true;

    // Why: the bank access is resolved once; every trip only opens the booth.
    private bank: BankLocation | null = null;
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
        this.goldsmith = this.settings.bool('goldsmithGauntlets', true);
        this.fastBank = this.settings.bool('fastBank', true);

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
            new ContinueDialog(),
            new EnsureGear(this),
            new EnsureGauntlets(this),
            new Restock(this),
            new Smelt(this)
        );
    }

    // Why: resolve the cheapest reachable bank once and walk to it; later trips reuse bankAccess.
    async resolveBank(): Promise<boolean> {
        const here = Game.tile();
        if (!here) {
            return false;
        }
        const bank = await nearestBankReachable(here, Navigator);
        if (!bank) {
            this.log('no reachable bank — stopping');
            ScriptRunner.stop('no reachable bank');
            return false;
        }
        this.bank = bank;
        this.bankAccess = bank.npcAccess ?? bank.access ?? BOOTH;
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
        if (!(await openBankAccess(this.bank, BOOTH, m => this.log(`  ${m}`)))) {
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
    /** Gold bars only: the 2.5x gauntlets are worth stopping for when the toggle is on. */
    needsGauntlets(): boolean {
        return wantsGoldsmithGauntlets(this.bar.bar, this.goldsmith);
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

    /** Why: bank requests are handled in send order, so deposit, Withdraw-All, close and the ore landing can all go without a wait. */
    async fastRestock(): Promise<boolean> {
        if (!this.fastBank || this.bar.ingredients.length !== 1) {
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

    // Why: Bank.isOpen() only proves the component exists. The item list fills a beat after opening and again after every deposit, so a count of zero can be a list that has not loaded rather than an empty bank. Before halting on "out of X", confirm the bank is ready and every named item reads zero; otherwise retry.
    async bankTrulyOutOf(...names: string[]): Promise<boolean> {
        const settled = await Execution.delayUntil(() => Bank.ready(), 3500);
        if (!settled) {
            return false;
        }
        return names.every(name => Bank.count(name) === 0);
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

// Why: set a fire-rune staff once. Deposit everything, withdraw one, close so Wield is a backpack op, wield, reopen.
class EnsureGear implements Task {
    constructor(private bot: Superheater) {}

    validate(): boolean {
        return !mustYield() && pickFireStaff(name => Equipment.contains(name)) === undefined;
    }

    async execute(): Promise<void> {
        if (!(await this.bot.openBank())) {
            return;
        }
        if (mustYield()) {
            return;
        }
        if (Inventory.used() > 0) {
            await Bank.depositAllMatching(() => true);
            await Execution.delayTicks(1);
        }
        let staff = pickFireStaff(name => Inventory.count(name) > 0);
        if (!staff) {
            staff = pickFireStaff(name => Bank.count(name) > 0);
            if (!staff) {
                // The bank list may still be settling after open, so re-check before declaring every fire staff gone.
                if (!(await this.bot.bankTrulyOutOf(...FIRE_STAVES))) {
                    this.bot.log('withdraw of a fire staff stalled but the bank list is still settling — retrying');
                    return;
                }
                this.bot.log('no fire staff in the bank — stopping');
                ScriptRunner.stop('no fire staff in the bank');
                return;
            }
            this.bot.log(`withdrawing ${staff}`);
            if (!(await Bank.withdrawX(staff, 1))) {
                if (!(await this.bot.bankTrulyOutOf(...FIRE_STAVES))) {
                    this.bot.log(`withdraw of ${staff} stalled but the bank list is still settling — retrying`);
                    return;
                }
                this.bot.log('no fire staff in the bank — stopping');
                ScriptRunner.stop('no fire staff in the bank');
                return;
            }
        }
        if (!(await Bank.close())) {
            this.bot.log('bank would not close — retrying');
            return;
        }
        // Why: close leaves Deposit-* ops on the side pack for a beat, so wait for Wield before equip.
        await Execution.delayUntil(
            () => !Bank.isOpen() && (Inventory.first(staff)?.actions().some(o => /wield|wear|equip/i.test(o)) ?? false),
            3000
        );
        if (mustYield()) {
            return;
        }
        this.bot.setStatus(`wielding ${staff}`);
        if (!(await Equipment.equip(staff))) {
            this.bot.log(`could not wield ${staff} — stopping`);
            ScriptRunner.stop(`could not wield ${staff}`);
            return;
        }
        this.bot.log(`wore ${staff} — casts need only ${NATURE_RUNE}s now`);
        await this.bot.openBank();
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
            if (Bank.count('Goldsmith gauntlet') === 0) {
                if (!(await this.bot.bankTrulyOutOf('Goldsmith gauntlet'))) {
                    return;
                }
                this.bot.log('no Goldsmith gauntlet in the bank — stopping');
                ScriptRunner.stop('no Goldsmith gauntlet in the bank');
                return;
            }
            this.bot.log('withdrawing Goldsmith gauntlet');
            if (!(await Bank.withdrawX('Goldsmith gauntlet', 1))) {
                if (!(await this.bot.bankTrulyOutOf('Goldsmith gauntlet'))) {
                    return;
                }
                this.bot.log('no Goldsmith gauntlet in the bank — stopping');
                ScriptRunner.stop('no Goldsmith gauntlet in the bank');
                return;
            }
        }
        if (!(await Bank.close())) {
            this.bot.log('bank would not close — retrying');
            return;
        }
        await Execution.delayUntil(
            () => !Bank.isOpen() && (Inventory.first('Goldsmith gauntlet')?.actions().some(o => /wear|wield|equip/i.test(o)) ?? false),
            3000
        );
        if (mustYield()) {
            return;
        }
        this.bot.setStatus('wearing Goldsmith gauntlet');
        if (!(await Equipment.equip('Goldsmith gauntlet'))) {
            this.bot.log('could not equip the Goldsmith gauntlet — stopping');
            ScriptRunner.stop('could not equip the Goldsmith gauntlet');
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
        return !mustYield() && !this.bot.canSmeltOne();
    }

    async execute(): Promise<void> {
        if (!(await this.openBank())) {
            return;
        }
        if (mustYield()) {
            this.bot.log('pausing for a random event');
            return;
        }

        // Why: clear whatever is left, bars, partial ores and junk, keeping only nature runes, so every restock starts from a known-empty pack.
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
            await Bank.depositAllMatching(name => name.toLowerCase() !== NATURE_RUNE.toLowerCase());
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
            ScriptRunner.stop(`no ${NATURE_RUNE}s in the bank`);
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
            return this.withdrawAllOf(ore, withdrawSet(recipe)[ore]);
        }
        const set = withdrawSet(recipe);
        for (const [ore, count] of Object.entries(set)) {
            this.bot.log(`withdrawing ${count} ${ore}`);
            const before = Inventory.count(ore);
            const ok = await Bank.withdrawX(ore, count);
            const got = Inventory.count(ore) - before;
            this.bot.log(`got ${got} ${ore}`);
            if (!ok || got === 0) {
                // The bank list can read zero while it is still loading after open or deposit, so verify it is settled before declaring the ore gone.
                if (!(await this.bot.bankTrulyOutOf(ore))) {
                    this.bot.log(`withdraw of ${ore} stalled but the bank list is still settling — retrying`);
                    return false;
                }
                if (Bank.count(ore) > 0) {
                    this.bot.log(`bank still has ${ore} but the withdraw stalled — retrying`);
                    return false;
                }
                this.bot.log(`no ${ore} in the bank (wanted ${count}) — stopping`);
                ScriptRunner.stop(`no ${ore} in the bank`);
                return false;
            }
            if (got < count) {
                // Same settling guard before concluding the bank is short on this ore.
                if (!(await this.bot.bankTrulyOutOf(ore))) {
                    this.bot.log(`partial withdraw of ${ore} but the bank list is still settling — retrying`);
                    return false;
                }
                this.bot.log(`WARNING: only ${got}/${count} ${ore} withdrawn — a partial recipe smelts the wrong bar`);
                ScriptRunner.stop(`only ${got} ${ore} in the bank`);
                return false;
            }
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
            ScriptRunner.stop(`no ${ore} in the bank`);
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
            ScriptRunner.stop(`no ${ore} in the bank`);
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

        // Why: casting on a partial recipe smelts the wrong bar, iron without coal makes an iron bar, so every cast needs the full set plus a nature rune, which is what canSmeltOne() checks. Pace each cast on the bar forming: the ore count drops a tick or two after the cast lands, so wait before clicking again.
        const start = barsSmeltable(recipe, ore => Inventory.count(ore));

        while (this.bot.canSmeltOne()) {
            // Why: the guardian needs the interaction, so stop casting the moment an event or dialog is up.
            if (mustYield()) {
                this.bot.log('pausing for a random event');
                return;
            }
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
