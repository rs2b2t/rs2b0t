import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory, type InvItem } from '../../api/inventory/Inventory.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Bank } from '../../api/bank/Bank.js';
import { Skills } from '../../api/skills/Skills.js';
import { Paint } from '../../paint/Paint.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { nearestBank } from '../../api/bank/BankLocations.js';
import { liveCatalog } from '../../api/market/catalog.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { etaHours, levelProgress } from '../../paint/levelProgress.js';
import {
    ALCH_OPTIONS,
    ALCH_OPTION_LABELS,
    DEFAULT_ALCH_ITEMS,
    fmtGp,
    nextAlchTarget,
    selectedAlchItems,
    type AlchItem
} from './AlcherLogic.js';
import type Tile from '../../geometry/Tile.js';

const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const MAGIC_TAB = 6;
const ALCH_SPELL = 'High Level Alchemy';
const FIRE_STAFF = 'Staff of fire';
const NATURE_RUNE = 'Nature rune';
/** High Level Alchemy unlocks at 55 Magic. */
const ALCHEMY_REQUIRED = 55;
// Why: the cast's p_delay(3) leaves the player delayed through tick+4's packet decode and the engine bins an op it decodes while delayed, so the server takes one cast per 5 ticks and no faster.
const ALCH_TICKS = 5;
/** Ticks to give the note before a cast counts as binned. */
const ALCH_LAND_TICKS = 2;
/** Past this from the resolved bank, an evade has carried us out of booth range and we walk back. */
const BANK_LEASH = 8;

const ACCENT = '#ffb347';
const GOOD = '#7fe08a';
const COOL = '#7fb3ff';
const WARN = '#e8c35b';
const BAD = '#ff6b6b';
const DIM = '#8a919a';

export const ALCHER_SETTINGS: SettingsSchema = {
    items: {
        type: 'string[]',
        default: DEFAULT_ALCH_ITEMS,
        options: ALCH_OPTIONS,
        optionLabels: ALCH_OPTION_LABELS,
        label: 'Items to alch',
        help:
            'ticked items are drained richest first: the bot withdraws one as notes, alchs it until '
            + 'the bank is out, then moves to the next. Chips show the alch value each. Leave every '
            + 'chip clear to run the defaults.'
    },
    alchs: {
        type: 'number',
        default: 27,
        min: 1,
        max: 1000,
        label: 'Alchs per trip',
        help: 'how many notes + nature runes to withdraw each trip; both stack in a single slot each, so even 1000 fits in 2 pack slots'
    }
};

export default class Alcher extends TaskBot {
    override loopDelay = 400;

    private selected: AlchItem[] = [];
    /** Keys a loaded bank has confirmed it holds none of. */
    private empty = new Set<string>();
    private alchs = 27;

    // Why: the bank access is resolved once; every trip only opens the booth.
    private bankAccess: { name: string; op: string } = BOOTH;
    private bankTile: Tile | null = null;
    private bankName = 'the bank';

    private trips = 0;
    private alched = 0;
    private gp = 0;
    private status = 'starting';
    private statusColor = DIM;
    private startedAt = Date.now();
    private xpAtStart = 0;
    /** Bank stock per item key, refreshed on every restock. */
    private stock = new Map<string, number>();
    /** Noted id per item key, so a note-mode withdraw knows what to wait for. */
    private noted = new Map<string, number>();
    private events = 0;
    private lastEvent: string | null = null;
    /** The tick the last cast was clicked on; every later op is paced off it. */
    private castTick = -ALCH_TICKS;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.selected = selectedAlchItems(this.settings.list('items', DEFAULT_ALCH_ITEMS));
        this.alchs = this.settings.num('alchs', 27);

        if (Skills.level('magic') < ALCHEMY_REQUIRED) {
            this.log(`${ALCH_SPELL} needs ${ALCHEMY_REQUIRED} Magic (have ${Skills.level('magic')}) — stopping`);
            ScriptRunner.stop(`${ALCH_SPELL} needs ${ALCHEMY_REQUIRED} Magic`);
            return;
        }

        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('magic');

        this.log(`Alcher — ${ALCH_SPELL} on ${this.selected.length} item(s), richest first: ${this.selected.map(i => i.label).join(', ')}`);
        if (!(await this.resolveBank())) {
            return;
        }
        this.add(new EnsureGear(this), new Restock(this), new Alch(this));
    }

    override async loop(): Promise<number | void> {
        this.sampleEvent();
        if (this.targets().length === 0 && !this.packAlchable()) {
            this.log('the bank is out of every selected item — stopping');
            ScriptRunner.stop('the bank is out of every selected item');
            return;
        }
        return super.loop();
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
        this.bankTile = bank.tile;
        this.bankName = bank.name;
        this.log(`banking at ${bank.name} (${this.bankAccess.name} / ${this.bankAccess.op})`);

        const near = bank.tile.level === here.level && bank.tile.distanceTo(here) <= 4;
        if (near) {
            return true;
        }
        this.setStatus(`walking to ${bank.name}`, WARN);
        if (!(await Traversal.walkResilient(bank.tile, { radius: 3, attempts: 4, timeoutMs: 180_000, log: m => this.log(`  ${m}`) }))) {
            this.log('walk to the bank failed — stopping');
            ScriptRunner.stop('walk to the bank failed');
            return false;
        }
        return true;
    }

    override recoveryAnchor(): Tile | null {
        return this.bankTile;
    }

    // Why: once at the bank the scene lookup picks the closest booth/chest, so no stored stand is needed.
    // Why: an event evade can carry us past booth range, so a failed open walks back to the resolved tile.
    async openBank(): Promise<boolean> {
        if (Bank.isOpen()) {
            return true;
        }
        await this.settleCast();
        this.setStatus('opening bank', COOL);
        if (await Bank.openNearest(this.bankAccess.name, this.bankAccess.op, m => this.log(`  ${m}`))) {
            return true;
        }
        const here = Game.tile();
        const strayed = this.bankTile !== null
            && here !== null
            && (here.level !== this.bankTile.level || this.bankTile.distanceTo(here) > BANK_LEASH);
        if (!strayed) {
            this.log('could not open the bank — retrying');
            return false;
        }
        this.setStatus(`walking back to ${this.bankName}`, WARN);
        this.log(`drifted off the bank stand — walking back to ${this.bankName}`);
        await Traversal.walkResilient(this.bankTile!, { radius: 3, attempts: 3, timeoutMs: 120_000, log: m => this.log(`  ${m}`) });
        return false;
    }

    noteCast(): void {
        this.castTick = Game.tick();
    }
    // Why: the engine drops any op it decodes while the player is delayed, so a booth click sent inside the cast's own delay is binned and the open sits out its 8s window before retrying.
    async settleCast(): Promise<void> {
        const since = Game.tick() - this.castTick;
        if (since < ALCH_TICKS) {
            await Execution.delayTicks(ALCH_TICKS - since);
        }
    }

    setStatus(s: string, color = DIM): void {
        this.status = s;
        this.statusColor = color;
    }
    items(): AlchItem[] {
        return this.selected;
    }
    /** Selected items the bank has not been confirmed out of, richest first. */
    targets(): AlchItem[] {
        return this.selected.filter(i => !this.empty.has(i.key));
    }
    target(): AlchItem | null {
        return nextAlchTarget(this.selected, this.empty);
    }
    isEmpty(item: AlchItem): boolean {
        return this.empty.has(item.key);
    }
    markEmpty(item: AlchItem): void {
        this.empty.add(item.key);
        this.stock.set(item.key, 0);
        this.log(`the bank is out of ${item.label} — moving on`);
    }
    alchTarget(): number {
        return this.alchs;
    }

    // Why: the paint asks for this on the first frame, before the obj catalogue has been scanned, so a miss falls back to the unnoted id and is retried rather than cached.
    /** The noted id an item lands as in note mode. */
    notedId(item: AlchItem): number {
        const hit = this.noted.get(item.key);
        if (hit !== undefined) {
            return hit;
        }
        const id = liveCatalog().notedOf.get(item.id);
        if (id === undefined) {
            return item.id;
        }
        this.noted.set(item.key, id);
        return id;
    }
    notesHeld(item: AlchItem): number {
        return Inventory.countById(this.notedId(item));
    }
    /** Every selected item's notes in the pack, so the rune top-up covers all of them. */
    notesInPack(): number {
        return this.selected.reduce((sum, item) => sum + this.notesHeld(item), 0);
    }
    /** The richest selected item with notes in the pack, whether or not the bank still has it. */
    packAlchable(): AlchItem | null {
        return this.selected.find(item => this.notesHeld(item) > 0) ?? null;
    }
    noteInPack(item: AlchItem): InvItem | null {
        const id = this.notedId(item);
        return Inventory.items().find(i => i.id === id) ?? null;
    }
    /** Whether the pack can fund one cast: a note to alch and a nature rune. */
    canAlchOne(): boolean {
        return this.packAlchable() !== null && Inventory.count(NATURE_RUNE) > 0;
    }

    bankStock(item: AlchItem): number {
        return this.stock.get(item.key) ?? 0;
    }
    setBankStock(item: AlchItem, n: number): void {
        this.stock.set(item.key, n);
    }
    /** Alchs the bank still holds across every item still in play. */
    fuel(): number {
        return this.targets().reduce((sum, item) => sum + this.bankStock(item), 0);
    }
    countTrip(): void {
        this.trips++;
    }
    countAlch(item: AlchItem, n: number): void {
        this.alched += n;
        this.gp += n * item.alchValue;
    }

    // Why: Supervisor already labels the event it took the loop over for, so the paint reads that
    // Why: rather than paying for a detect scan of its own.
    private sampleEvent(): void {
        const now = ScriptRunner.ctx?.activeEvent ?? null;
        if (now !== null && this.lastEvent === null) {
            this.events++;
        }
        this.lastEvent = now;
    }

    private minutes(): number {
        return (Date.now() - this.startedAt) / 60_000;
    }
    private perHour(n: number): number {
        const mins = this.minutes();
        return mins < 0.5 ? 0 : (n / mins) * 60;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        this.sampleEvent();
        const event = ScriptRunner.ctx?.activeEvent ?? null;
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: event ? BAD : ACCENT });
        const target = this.target();
        p.title(`Alcher — ${event ? `⚡ ${event}` : (target?.label ?? 'out of stock')}`);

        const mins = this.minutes();
        const tab = p.tabs('alch', ['Run', 'Stock', 'Magic']);

        if (tab === 'Run') {
            const alchHr = this.perHour(this.alched);
            p.cells([
                { text: `Runtime ${fmtDuration(mins)}` },
                { text: `Alchs ${this.alched.toLocaleString()}`, color: GOOD },
                { text: `Alch/hr ${alchHr > 0 ? Math.round(alchHr).toLocaleString() : '—'}` }
            ]);
            p.cells([
                { text: `Profit ${fmtGp(this.gp)}`, color: ACCENT },
                { text: `gp/hr ${alchHr > 0 ? fmtGp(this.perHour(this.gp)) : '—'}`, color: ACCENT },
                { text: `Trips ${this.trips}` }
            ]);
            const fuel = this.fuel();
            const fuelMins = alchHr > 0 ? (fuel / alchHr) * 60 : 0;
            p.cells([
                { text: `Notes ${this.notesInPack().toLocaleString()}` },
                { text: `Runes ${Inventory.count(NATURE_RUNE).toLocaleString()}`, color: Inventory.count(NATURE_RUNE) > 0 ? undefined : BAD },
                { text: `Fuel ${fuelMins > 0 ? fmtDuration(fuelMins) : '—'}` }
            ]);
            // Why: the chatbox dock is 150px, which is title + tabs + three rows + one bar + status + the buttons. A second bar pushes Pause/Stop off the panel.
            p.bar('HP', Skills.hpFraction());
            p.cells([
                { text: `▸ ${this.status}`, color: event ? BAD : this.statusColor, weight: 2 },
                { text: `events ${this.events}`, color: this.events > 0 ? WARN : DIM }
            ]);
        } else if (tab === 'Stock') {
            const active = this.target();
            const row = (alch: string, label: string, pack: string, bank: string): string =>
                `${alch.padStart(6)}  ${label.padEnd(19)}${pack.padStart(5)} ${bank.padStart(7)}`;
            const rows = this.items().map(item => ({
                text: row(String(item.alchValue), item.label, String(this.notesHeld(item)), String(this.bankStock(item))),
                color: this.isEmpty(item) ? DIM : item.key === active?.key ? ACCENT : undefined
            }));
            p.text(row('alch', 'item', 'pack', 'bank'), DIM);
            p.fill('alchstock', rows, {
                reserve: 26,
                footer: `${this.targets().length}/${this.items().length} in play · ${this.fuel().toLocaleString()} alchs banked · ${fmtGp(this.targets().reduce((sum, i) => sum + this.bankStock(i) * i.alchValue, 0))}`
            });
        } else {
            const gained = Skills.xp('magic') - this.xpAtStart;
            const prog = levelProgress(Skills.level('magic'), Skills.xp('magic'));
            const rate = this.perHour(gained);
            const eta = etaHours(prog.remaining, rate);
            p.bar(`Magic ${prog.level}`, prog.fraction);
            p.cells([
                { text: `${prog.remaining.toLocaleString()} to ${Math.min(99, prog.level + 1)}` },
                { text: `${rate > 0 ? `${(rate / 1000).toFixed(1)}k` : '—'}/hr`, color: GOOD },
                { text: eta === null ? 'eta —' : `eta ${fmtDuration(eta * 60)}` }
            ]);
            p.cells([
                { text: `Session +${gained.toLocaleString()}`, color: GOOD },
                { text: `Total ${Skills.xp('magic').toLocaleString()}` }
            ]);
            p.text(`${this.alched.toLocaleString()} casts · ${fmtGp(this.gp)} · ${fmtGp(this.alched > 0 ? this.gp / this.alched : 0)} per cast`, DIM);
        }
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}

// Why: set the staff of fire once. Deposit everything, withdraw one, close so Wield is a backpack op, wield, reopen.
class EnsureGear implements Task {
    constructor(private bot: Alcher) {}

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
        this.bot.setStatus(`wielding ${FIRE_STAFF}`, WARN);
        if (!(await Equipment.equip(FIRE_STAFF))) {
            this.bot.log(`could not wield ${FIRE_STAFF} — stopping`);
            ScriptRunner.stop(`could not wield ${FIRE_STAFF}`);
            return;
        }
        this.bot.log(`wore ${FIRE_STAFF} — casts need only ${NATURE_RUNE}s now`);
        await this.bot.openBank();
    }
}

// Why: restock keeps the runes and any notes still worth alching, then tops the pack up from the
// Why: richest item the bank still holds. Items the bank is out of are marked so the next trip
// Why: drops to the item below them.
class Restock implements Task {
    constructor(private bot: Alcher) {}

    validate(): boolean {
        // Why: fire whenever the pack cannot cover one cast. A bank short of the trip amount still yields a partial load that gets alched, so a shortfall never turns into a loop.
        return !this.bot.canAlchOne();
    }

    async execute(): Promise<void> {
        if (!(await this.bot.openBank())) {
            return;
        }

        // Why: clear coins and whatever random events left in the pack; the nature runes and any
        // Why: notes still to alch stay, so a short bank stock never starts from scratch.
        this.bot.setStatus('restocking', COOL);
        const keep = new Set(this.bot.items().map(item => this.bot.notedId(item)));
        if (Inventory.used() > 0) {
            const before = Inventory.used();
            const runes = NATURE_RUNE.toLowerCase();
            await Bank.depositAllMatching((name, id) => name.toLowerCase() !== runes && !keep.has(id));
            await Execution.delayTicks(1);
            const cleared = before - Inventory.used();
            if (cleared > 0) {
                this.bot.log(`cleared ${cleared} items from the pack`);
            }
        }

        // Why: note mode makes the withdraw return the item as notes, which a single cast alchs in full. The bank resets to item mode on open, so set it after opening.
        await Bank.setNoteMode(true);

        if (!Bank.ready()) {
            // Why: a zero count only proves the bank is out once the bank has said what it holds; before that it is a list still in flight.
            this.bot.log('bank item list not loaded yet — retrying restock');
            await Execution.delayUntil(() => Bank.ready(), 5000);
            return;
        }

        // Why: the loaded snapshot reading zero is what proves an item gone, so a withdraw that
        // Why: fails for a transient reason (backpack not ready, no count dialog) is retried
        // Why: instead of retiring an item the bank still holds.
        for (const item of this.bot.targets()) {
            const stock = Bank.countById(item.id);
            this.bot.setBankStock(item, stock);
            if (stock === 0) {
                this.bot.markEmpty(item);
            }
        }

        const target = this.bot.target();
        if (!target) {
            this.bot.log('the bank is out of every selected item — stopping');
            ScriptRunner.stop('the bank is out of every selected item');
            return;
        }

        const want = this.bot.alchTarget();
        const held = this.bot.notesHeld(target);
        if (held < want) {
            await Bank.withdrawXById(target.id, want - held, this.bot.notedId(target));
            const got = this.bot.notesHeld(target) - held;
            if (got === 0) {
                this.bot.log(`withdraw of ${target.label} landed nothing against ${this.bot.bankStock(target)} banked — retrying`);
                return;
            }
            this.bot.log(`withdrew ${got} ${target.label} (noted, ${target.alchValue}gp each)`);
        }

        const needRunes = this.bot.notesInPack() - Inventory.count(NATURE_RUNE);
        if (needRunes > 0) {
            const before = Inventory.count(NATURE_RUNE);
            const ok = await Bank.withdrawX(NATURE_RUNE, needRunes);
            const got = Inventory.count(NATURE_RUNE) - before;
            if (got > 0) {
                this.bot.log(`withdrew ${got} ${NATURE_RUNE}s`);
            }
            if (!ok || got === 0) {
                this.bot.log(`no ${NATURE_RUNE}s in the bank — stopping`);
                ScriptRunner.stop(`no ${NATURE_RUNE}s in the bank`);
                return;
            }
        }

        if (!(await Bank.close())) {
            this.bot.log('bank would not close — retrying');
            return;
        }

        this.bot.countTrip();
        this.bot.log(`restocked: ${this.bot.notesHeld(target)} ${target.label} notes + ${Inventory.count(NATURE_RUNE)} ${NATURE_RUNE}s`);
    }
}

// Why: one cast per call. Supervisor.intercept only runs between loop iterations, so the old
// Why: while loop held the loop for all 27 casts of a trip and gave random events no point to
// Why: break in; the bot alched on through swarms and dwarves until it died.
class Alch implements Task {
    constructor(private bot: Alcher) {}

    validate(): boolean {
        if (Bank.isOpen()) {
            return false;
        }
        return this.bot.canAlchOne();
    }

    async execute(): Promise<void> {
        const target = this.bot.packAlchable();
        if (!target) {
            return;
        }
        this.bot.setStatus(`alching ${target.label}`, GOOD);

        // Why: waiting the cast out at the END of the call put the loop's own 400ms gap between the delay expiring and the next click, which sent it most of a tick late and let a hiccup carry it into the tick before the one it was aimed at, where the engine bins it. Waiting the remainder here sends every click on the tick.
        await this.bot.settleCast();

        if (!(await Game.openSideTab(MAGIC_TAB))) {
            this.bot.log('could not open the magic tab — retrying');
            return;
        }

        const note = this.bot.noteInPack(target);
        if (!note) {
            return;
        }
        const before = this.bot.notesHeld(target);
        if (!(await Game.castOnItem(ALCH_SPELL, note))) {
            this.bot.log('cast-on-item was rejected — retrying');
            await Execution.delayTicks(1);
            return;
        }
        this.bot.noteCast();

        if (!(await Execution.delayUntilTicks(() => this.bot.notesHeld(target) < before, ALCH_LAND_TICKS))) {
            this.bot.log(`the cast on ${target.label} landed nothing — retrying`);
            return;
        }
        this.bot.countAlch(target, before - this.bot.notesHeld(target));
    }
}
