import { Bank } from '../../api/bank/Bank.js';
import { nearestBank } from '../../api/bank/BankLocations.js';
import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Skills } from '../../api/skills/Skills.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { Traversal } from '../../api/walking/Traversal.js';
import type Tile from '../../geometry/Tile.js';
import { XpTracker, jiveFrame, paintLevels } from '../../paint/jive.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { JEWELS, JEWEL_OPTIONS, PACK, castsAffordable, decide, jewelByName, runesPerCast, staffFor, tripPlan, type Jewel, type PackState, type Step } from './logic.js';

const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const MAGIC_TAB = 6;
// Why: the cast's p_delay(1) keeps the player delayed through the next tick's decode and the engine bins an op it decodes while delayed, so one cast lands every three ticks and a click sent sooner is lost.
const CAST_TICKS = 3;
const LAND_TICKS = 2;
/** Past this from the resolved bank an event evade has carried us out of booth range and we walk back. */
const BANK_LEASH = 8;
const WALK_MS = 180_000;
const CONTROL_ROWS = 2;

export const SETTINGS: SettingsSchema = {
    jewel: { type: 'string', default: 'Sapphire ring', options: JEWEL_OPTIONS, label: 'Jewel', help: 'which jewel to enchant this session; an amulet has to be strung first' }
};

export default class JiveEnchanter extends TaskBot {
    override loopDelay = 400;

    private status = 'starting';
    private startedAt = Date.now();
    private xp = new XpTracker(['magic'], Skills);
    private enchanted = 0;
    private trips = 0;
    private banked = 0;
    /** The tick the last cast was clicked on; every later op is paced off it. */
    private castTick = -CAST_TICKS;
    private bankAccess = BOOTH;
    private bankTile: Tile | null = null;
    private bankName = 'the bank';

    jewel: Jewel = JEWELS[0]!;
    staffChecked = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        const pick = this.settings.str('jewel', 'Sapphire ring');
        const jewel = jewelByName(pick);
        if (!jewel) {
            ScriptRunner.stop(`[enchanter] unknown jewel '${pick}'`);
            return;
        }
        this.jewel = jewel;
        this.startedAt = Date.now();
        this.xp.begin();

        const level = Skills.level('magic');
        if (level < jewel.spell.magic) {
            ScriptRunner.stop(`[enchanter] ${jewel.spell.name} needs Magic ${jewel.spell.magic}, this account has ${level}`);
            return;
        }
        if (!(await this.resolveBank())) {
            return;
        }
        this.log(`[enchanter] ${jewel.spell.name} on ${jewel.label} into ${jewel.product}, banking at ${this.bankName}`);
        this.add(new ContinueDialog(), new WieldStaff(this), new Restock(this), new Enchant(this));
    }

    // Why: the script stands at whichever bank it was started beside, so the nearest one is resolved once and every trip reopens it.
    private async resolveBank(): Promise<boolean> {
        const here = Game.tile();
        if (!here) {
            return false;
        }
        const bank = nearestBank(here);
        if (!bank) {
            ScriptRunner.stop('[enchanter] no reachable bank');
            return false;
        }
        this.bankAccess = bank.access ?? BOOTH;
        this.bankTile = bank.tile;
        this.bankName = bank.name;
        if (bank.tile.level === here.level && bank.tile.distanceTo(here) <= 4) {
            return true;
        }
        this.setStatus(`walking to ${bank.name}`);
        if (!(await Traversal.walkResilient(bank.tile, { radius: 3, attempts: 4, timeoutMs: WALK_MS, log: m => this.log(`  ${m}`) }))) {
            ScriptRunner.stop(`[enchanter] the walk to ${bank.name} failed`);
            return false;
        }
        return true;
    }

    override recoveryAnchor(): Tile | null {
        return this.bankTile;
    }

    async openBank(): Promise<boolean> {
        if (Bank.isOpen()) {
            return true;
        }
        await this.settleCast();
        this.setStatus('opening the bank');
        if (await Bank.openNearest(this.bankAccess.name, this.bankAccess.op, m => this.log(`  ${m}`))) {
            return true;
        }
        const here = Game.tile();
        const strayed = this.bankTile !== null && here !== null && (here.level !== this.bankTile.level || this.bankTile.distanceTo(here) > BANK_LEASH);
        if (!strayed) {
            this.log('[enchanter] could not open the bank, will retry');
            return false;
        }
        this.setStatus(`walking back to ${this.bankName}`);
        await Traversal.walkResilient(this.bankTile!, { radius: 3, attempts: 3, timeoutMs: WALK_MS, log: m => this.log(`  ${m}`) });
        return false;
    }

    noteCast(): void {
        this.castTick = Game.tick();
    }

    // Why: a booth click sent inside the cast's own delay is binned and the open sits out its window before retrying, so every op after a cast waits the cast out first.
    async settleCast(): Promise<void> {
        const since = Game.tick() - this.castTick;
        if (since < CAST_TICKS) {
            await Execution.delayTicks(CAST_TICKS - since);
        }
    }

    setStatus(s: string): void {
        this.status = s;
    }

    wielded(): string[] {
        return Equipment.items().map(i => i.name ?? '');
    }

    jewelsHeld(): number {
        return Inventory.countById(this.jewel.id);
    }

    castsHeld(): number {
        return castsAffordable(this.jewel, this.wielded(), rune => Inventory.count(rune));
    }

    pack(): PackState {
        return { jewels: this.jewelsHeld(), casts: this.castsHeld() };
    }

    step(): Step {
        return decide(this.pack());
    }

    noteEnchant(n: number): void {
        this.enchanted += n;
    }

    noteTrip(banked: number): void {
        this.trips++;
        this.banked += banked;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const { frame: p, page, section } = jiveFrame(ctx, {
            script: 'JiveEnchanter',
            status: this.status,
            pages: ['Statistics', 'Options'],
            sections: ['Overview', 'Supplies']
        });
        const mins = (Date.now() - this.startedAt) / 60_000;
        const runes = runesPerCast(this.jewel, this.wielded());
        const staff = this.wielded().find(name => runes.length < 1 + this.jewel.spell.elements.length && /staff/i.test(name));

        if (page === 'Options') {
            p.statGrid([
                [{ text: `Jewel: ${this.jewel.label}` }, { text: `Spell: Lvl-${this.jewel.spell.level} (Magic ${this.jewel.spell.magic})` }],
                [{ text: `Bank: ${this.bankName}` }, { text: `Staff: ${staff ?? 'none, runes only'}` }]
            ]);
        } else if (section === 'Overview') {
            p.statGrid([
                [{ text: `Runtime: ${fmtDuration(mins)}` }, { text: `Enchanted: ${this.enchanted}` }],
                [{ text: `Trips: ${this.trips}` }, { text: `Casts left: ${this.castsHeld()}` }],
                [{ text: `Banked: ${this.banked}` }, { text: `${this.jewel.label}: ${this.jewelsHeld()}` }]
            ]);
            paintLevels(p, this.xp.progress(), mins, CONTROL_ROWS);
        } else {
            p.statGrid([
                ...runes.map(r => [{ text: `${r.rune}: ${Inventory.count(r.rune)}` }, { text: `${r.count} a cast` }]),
                [{ text: `Product: ${this.jewel.product}` }, { text: `In pack: ${Inventory.count(this.jewel.product)}` }]
            ]);
            p.bar('Pack', Inventory.used() / PACK);
        }

        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}

// Why: a staff that covers the element saves a rune stack and a slot every trip, so the first bank visit wields one when the bank has it and otherwise settles for runes, once.
class WieldStaff implements Task {
    constructor(private bot: JiveEnchanter) {}

    validate(): boolean {
        return !this.bot.staffChecked;
    }

    async execute(): Promise<void> {
        const bot = this.bot;
        const jewel = bot.jewel;
        if (runesPerCast(jewel, bot.wielded()).length < 1 + jewel.spell.elements.length) {
            bot.staffChecked = true;
            return;
        }
        if (!(await bot.openBank())) {
            return;
        }
        if (!(await Execution.delayUntil(() => Bank.isOpen() && Bank.loaded(), 5000))) {
            bot.log('[enchanter] the bank list has not filled in, retrying');
            return;
        }
        const staff = staffFor(jewel, name => Bank.count(name));
        if (!staff) {
            bot.staffChecked = true;
            bot.log('[enchanter] no elemental staff in the bank, casting on runes');
            return;
        }
        if (Inventory.used() > 0) {
            await Bank.depositAllMatching(() => true);
            await Execution.delayTicks(1);
        }
        if (!(await Bank.withdrawX(staff, 1))) {
            bot.log(`[enchanter] could not withdraw the ${staff}, retrying`);
            return;
        }
        if (!(await Bank.close())) {
            bot.log('[enchanter] the bank would not close, retrying');
            return;
        }
        bot.setStatus(`wielding the ${staff}`);
        if (await Equipment.equip(staff)) {
            bot.log(`[enchanter] wielding the ${staff}, so its rune stays in the bank`);
        } else {
            bot.log(`[enchanter] could not wield the ${staff}, casting on runes`);
        }
        bot.staffChecked = true;
    }
}

// Why: everything but the spell's runes and the jewel goes in, products and the old weapon included, so the withdrawal always starts from a known pack.
class Restock implements Task {
    constructor(private bot: JiveEnchanter) {}

    validate(): boolean {
        return this.bot.staffChecked && this.bot.step().kind === 'bank';
    }

    async execute(): Promise<void> {
        const bot = this.bot;
        const jewel = bot.jewel;
        if (!(await bot.openBank())) {
            return;
        }
        bot.setStatus('banking the load');
        const products = Inventory.count(jewel.product);
        const wielded = bot.wielded();
        const keep = new Set(runesPerCast(jewel, wielded).map(r => r.rune.toLowerCase()));
        await Bank.depositAllMatching((name, id) => id !== jewel.id && !keep.has(name.toLowerCase()));
        if (!(await Execution.delayUntil(() => Bank.isOpen() && Bank.loaded(), 5000))) {
            bot.log(Bank.isOpen() ? '[enchanter] the bank list has not filled in, retrying this trip' : '[enchanter] the bank window closed, retrying this trip');
            return;
        }

        const plan = tripPlan(
            jewel,
            wielded,
            { jewels: bot.jewelsHeld(), rune: name => Inventory.count(name) },
            { jewels: Bank.countById(jewel.id), rune: name => Bank.count(name) }
        );
        if (!plan.ok) {
            await Bank.close();
            bot.setStatus('stopped');
            ScriptRunner.stop(`[enchanter] ${plan.reason}`);
            return;
        }
        if (plan.jewels > 0) {
            bot.setStatus(`withdrawing ${plan.jewels} ${jewel.label}`);
            if (!(await Bank.withdrawXById(jewel.id, plan.jewels))) {
                bot.log(`[enchanter] could not withdraw ${plan.jewels} ${jewel.label}, retrying this trip`);
                return;
            }
        }
        for (const r of plan.runes) {
            if (!Bank.isOpen() || !Bank.loaded()) {
                bot.log('[enchanter] the bank window closed mid-withdrawal, retrying this trip');
                return;
            }
            bot.setStatus(`withdrawing ${r.count} ${r.rune}`);
            if (!(await Bank.withdrawX(r.rune, r.count))) {
                bot.log(`[enchanter] could not withdraw ${r.count} ${r.rune}, retrying this trip`);
                return;
            }
        }
        if (!(await Bank.close())) {
            bot.log('[enchanter] the bank would not close, retrying');
            return;
        }
        bot.noteTrip(products);
        const took = [`${plan.jewels} ${jewel.label}`, ...plan.runes.map(r => `${r.count} ${r.rune}`)].join(' + ');
        bot.log(`[enchanter] banked ${products} ${jewel.product}, took ${took}`);
    }
}

// Why: one cast per call, so the supervisor gets the loop back between casts and a random event can break in.
class Enchant implements Task {
    constructor(private bot: JiveEnchanter) {}

    validate(): boolean {
        return this.bot.staffChecked && !Bank.isOpen() && this.bot.step().kind === 'cast';
    }

    async execute(): Promise<void> {
        const bot = this.bot;
        const jewel = bot.jewel;
        await bot.settleCast();
        if (!(await Game.openSideTab(MAGIC_TAB))) {
            bot.log('[enchanter] could not open the magic tab, retrying');
            return;
        }
        const item = Inventory.items().find(i => i.id === jewel.id);
        if (!item) {
            return;
        }
        const before = bot.jewelsHeld();
        bot.setStatus(`enchanting ${jewel.label}`);
        if (!(await Game.castOnItem(jewel.spell.name, item))) {
            bot.log('[enchanter] the cast was rejected, retrying');
            await Execution.delayTicks(1);
            return;
        }
        bot.noteCast();
        if (!(await Execution.delayUntilTicks(() => bot.jewelsHeld() < before, LAND_TICKS))) {
            bot.log(`[enchanter] the cast on ${jewel.label} landed nothing, retrying`);
            return;
        }
        bot.noteEnchant(before - bot.jewelsHeld());
    }
}
