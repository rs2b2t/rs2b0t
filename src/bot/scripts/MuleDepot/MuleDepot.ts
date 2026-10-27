import { reader } from '../../adapter/ClientAdapter.js';
import type { Player } from '../../api/model/Player.js';
import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { liveCatalog, notedId as catalogNotedId } from '../../api/market/catalog.js';
import { Players } from '../../api/players/Players.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { Trade } from '../../api/trade/Trade.js';
import { Traversal } from '../../api/walking/Traversal.js';
import Tile from '../../geometry/Tile.js';
import { Paint } from '../../paint/Paint.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import {
    APPROACH_RANGE,
    ASK_TTL_MS,
    BANK_RADIUS,
    LEASH_RADIUS,
    PACK,
    TRADE_RANGE,
    TRADE_REQUEST_CHAT,
    TRADE_REQUEST_INTERVAL_MS,
    TRADE_REQUEST_TEXT,
    type DeliveryBatch,
    type DeliveryLine,
    type LoadoutLine,
    type MuleDepotContext,
    type Role,
    type WithdrawalLine
} from './MuleDepotContext.js';
import {
    BANK_OPTIONS,
    DEFAULT_BANK,
    MODE_OPTIONS,
    ROLE_OPTIONS,
    bankTile,
    describeLines,
    isConfiguredAccount,
    isGiverRole,
    isReceiverRole,
    lineKey,
    nextBatchIndex,
    nextUnserved,
    normalizeAccount,
    parseAccounts,
    parseItemNames,
    parseLoadout,
    pickRequestTarget,
    planDeliveries,
    planWithdrawal,
    resolveRole,
    shortfallFor
} from './MuleDepotLogic.js';
import {
    bankRows,
    cleanPack,
    createClientBankTask,
    createCloseBankTask,
    createDumperBankTask,
    createSupermuleBankTask,
    createSupplierBankTask,
    notedIds
} from './BankTasks.js';
import { ApproachPartnerTask, ReturnToDepotTask, WaitTask, WalkToTask } from './MovementTasks.js';
import { TradeRequestTask, TradeScreenTask, giverFlavour, receiverFlavour } from './TradeTasks.js';

const CSV_MODE_OPTIONS = ['list', 'csv'];

/** The dump list a fresh install starts on, grouped as the operator pasted it. Why: `herb` is lower
 *  case on purpose, since the engine calls every unidentified herb `Herb` and matching ignores case. */
const DEFAULT_ITEMS = [
    'Air rune', 'water rune', 'earth rune', 'fire rune', 'cosmic rune', 'law rune', 'mind rune',
    'body rune', 'nature rune', 'chaos rune', 'death rune', 'soul rune', 'blood rune',

    'Bronze arrow', 'iron arrow', 'steel arrow', 'mithril arrow', 'adamant arrow', 'rune arrow',
    'rune dart', 'rune knife',

    'Feather', 'cowhide', 'dragonhide', 'dragon bones', 'big bones',

    'Snape grass', 'unicorn horn', 'limpwurt root', 'herb',

    'Nature talisman', 'half of a key', 'uncut sapphire', 'uncut emerald', 'uncut ruby',
    'uncut diamond', 'chaos talisman', 'rune javelin', 'dragon spear', 'rune spear',
    'shield left half', 'rune longsword', 'adamant platebody', 'rune dagger', 'adamant full helm',
    'rune sq shield', 'rune battleaxe', 'runite bar', 'runite ore', 'rune kiteshield',
    'rune scimitar', 'rune sword', 'rune full helm', 'dragon platelegs', 'dragon plateskirt',
    'dragon chainbody', 'adamant platelegs',

    'Air talisman', 'earth talisman', 'water talisman', 'fire talisman', 'mind talisman',
    'body talisman', 'cosmic talisman',

    'Ashes', 'eye of newt', 'vial', 'vial of water', 'rune essence', 'coal', 'iron ore',
    'gold ore', 'mithril ore', 'adamantite ore', 'runite ore', 'yew logs', 'magic logs',
    'hard leather', 'leather', 'seaweed'
];

/** The supply list a fresh install starts on: a stack of each starter rune. */
const DEFAULT_LOADOUT = ['10000 Air rune', '10000 Mind rune'];

/**
 * Slots one loadout line takes: one for anything that stacks or notes, one per unit otherwise.
 * Why: an unknown item is guessed at one slot, and nearly everything tradeable stacks or notes.
 */
function slotsForLoadoutLine(line: LoadoutLine): number {
    const catalog = liveCatalog();
    const record = line.id >= 0 ? catalog.byId.get(line.id) : undefined;
    if (!record) {
        return 1;
    }
    return record.stackable || catalogNotedId(catalog, line.id) !== null ? 1 : Math.max(1, line.quantity);
}

export const SETTINGS: SettingsSchema = {
    mode: {
        type: 'string',
        default: 'Dump',
        options: [...MODE_OPTIONS],
        label: 'Mode',
        help: 'Dump moves the item list from every mule to one supermule. Supply hands one loadout to each account, once each.'
    },
    designation: {
        type: 'string',
        default: 'Mule',
        options: [...ROLE_OPTIONS],
        label: 'Designation',
        help: 'Dump: Mule or Supermule. Supply: Supplier or Client. A designation from the other mode is refused at startup.'
    },
    bank: {
        type: 'string',
        default: DEFAULT_BANK,
        options: BANK_OPTIONS,
        label: 'Bank',
        help: 'the depot. Every account on both sides uses the same one.'
    },
    accounts: {
        type: 'string',
        default: '',
        label: 'Accounts',
        help: 'comma-separated names. Mule: the supermule. Supermule: an allow-list of mules, order irrelevant. Supplier: the clients, in the order they are served. Client: the supplier.'
    },
    items: {
        type: 'string[]',
        default: DEFAULT_ITEMS,
        label: 'Item list (Dump)',
        showIf: { key: 'mode', anyOf: ['Dump'] },
        help: 'exact item names. A mule withdraws these and trades the lot; its pack holds nothing else. One name can sit on several bank rows, such as every unidentified herb being called Herb, and all of them are taken.',
        csvToggle: 'itemsMode'
    },
    itemsMode: {
        type: 'string',
        default: 'csv',
        options: CSV_MODE_OPTIONS,
        optionLabels: { list: 'List (chips)', csv: 'CSV (paste)' },
        label: 'Item list entry mode',
        showIf: { key: 'mode', anyOf: ['Dump'] },
        help: 'CSV renders the item list as a paste box.'
    },
    loadout: {
        type: 'string[]',
        default: DEFAULT_LOADOUT,
        label: 'Loadout (Supply)',
        showIf: { key: 'mode', anyOf: ['Supply'] },
        help: 'one entry per line as "<quantity> <item name or id>". The quantity is optional and defaults to 1, and a bare number is an item id. A loadout wider than one trade is delivered over several.',
        csvToggle: 'loadoutMode'
    },
    loadoutMode: {
        type: 'string',
        default: 'csv',
        options: CSV_MODE_OPTIONS,
        optionLabels: { list: 'List (chips)', csv: 'CSV (paste)' },
        label: 'Loadout entry mode',
        showIf: { key: 'mode', anyOf: ['Supply'] },
        help: 'CSV renders the loadout as a paste box.'
    },
    tradeSlots: {
        type: 'number',
        default: PACK,
        min: 1,
        max: PACK,
        label: 'Slots per batch',
        showIf: { key: 'mode', anyOf: ['Supply'] },
        help: 'slots one trade may fill. A loadout wider than this is delivered over several trades.'
    }
};

/**
 * A shared-bank depot for a group of accounts. Four roles off two settings: Dump/Mule,
 * Dump/Supermule, Supply/Supplier and Supply/Client, all working at the same bank.
 */
export default class MuleDepot extends TaskBot implements MuleDepotContext {
    override loopDelay = 600;

    private roleValue: Role = 'Mule';
    private bankTileValue: Tile = bankTile(DEFAULT_BANK);
    private bankLabel = DEFAULT_BANK;
    private accountList: string[] = [];
    private items: string[] = [];
    private lines: LoadoutLine[] = [];
    private batches: DeliveryBatch[] = [];
    private slotWidth = PACK;

    private batchIndex = 0;
    private served = new Set<string>();
    // Lines the bank could not supply after enough reads; they are reported, not retried for ever.
    private unavailable = new Set<string>();
    // What each client was given, by line key, to report a shortfall per account.
    private delivered = new Map<string, Map<string, number>>();
    // The lines a completed stake put up, credited to the client when the window confirms.
    private pendingDelivery: DeliveryLine[] = [];
    private requestCursor = 0;
    private asker: string | null = null;
    private askerAt = 0;
    private lastTradeRequestAt: number | null = null;

    private transfers = 0;
    private unitsMoved = 0;
    private screensOpened = 0;
    private screensSucceeded = 0;
    private screensFailed = 0;
    private status = 'starting';
    private startedAt = Date.now();

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        this.startedAt = Date.now();

        const mode = this.settings.str('mode', 'Dump');
        const designation = this.settings.str('designation', 'Mule');
        const role = resolveRole(mode, designation);
        if (!role) {
            this.log(`MuleDepot: '${mode}' + '${designation}' is not a pair — use Dump with Mule or Supermule, Supply with Supplier or Client`);
            throw new Error(`MuleDepot: invalid mode/designation pair '${mode}' + '${designation}'`);
        }
        this.roleValue = role;

        this.bankLabel = this.settings.str('bank', DEFAULT_BANK);
        this.bankTileValue = bankTile(this.bankLabel);
        this.accountList = parseAccounts(this.settings.str('accounts', ''));
        if (this.accountList.length === 0) {
            this.log('MuleDepot: no accounts configured. Every role needs at least one partner name.');
            throw new Error('MuleDepot: no accounts configured');
        }

        this.items = parseItemNames(this.settings.list('items', []));
        this.slotWidth = Math.max(1, Math.min(PACK, Math.floor(this.settings.num('tradeSlots', PACK))));
        this.readLoadout();
        this.refuseIfMisconfigured();

        this.on('chat.message', e => {
            // Why: a client that wants to trade says so in chat. Without this the depot asks
            // whichever account is nearest, which after a mule stops is one that never answers.
            if (e.type !== TRADE_REQUEST_CHAT || !e.username || !TRADE_REQUEST_TEXT.test(e.text)) {
                return;
            }
            const name = normalizeAccount(e.username);
            if (isConfiguredAccount(name, this.accountList)) {
                this.asker = name;
                this.askerAt = Date.now();
                this.log(`${name} asked to trade`);
            }
        });

        this.log(`MuleDepot ${role} at ${this.bankLabel} — ${this.describeRole()}`);

        if (!await this.walkToBank()) {
            ScriptRunner.stop(`MuleDepot: the walk to ${this.bankLabel} failed`);
            return;
        }
        // Why: a pack the run starts with is the operator's own goods, and banking it first is
        // what makes "offer the whole pack" mean "offer the list".
        if (!await cleanPack(this, new Set())) {
            ScriptRunner.stop(`MuleDepot: could not bank the ${this.packUsed()} slot(s) the pack started with`);
            return;
        }

        this.add(new ContinueDialog(), ...this.composeTasks());
    }

    /** Stop on a configuration no retry can fix, naming what is missing. */
    private refuseIfMisconfigured(): void {
        if (this.roleValue === 'Mule' && this.items.length === 0) {
            throw new Error('MuleDepot: dump mode needs an item list');
        }
        if ((this.roleValue === 'Supplier' || this.roleValue === 'Client') && this.batches.length === 0) {
            throw new Error('MuleDepot: supply mode needs a loadout');
        }
    }

    private readLoadout(): void {
        if (this.roleValue !== 'Supplier' && this.roleValue !== 'Client') {
            return;
        }
        const { lines, problems } = parseLoadout(this.settings.list('loadout', []));
        for (const problem of problems) {
            this.log(`MuleDepot: loadout line ${problem.line} (${problem.raw}) — ${problem.reason}`);
        }
        this.lines = lines;
        this.batches = planDeliveries(lines, slotsForLoadoutLine, this.slotWidth);
    }

    private describeRole(): string {
        switch (this.roleValue) {
            case 'Mule':
                return `dumping ${this.items.length} listed item(s) to ${this.accountList[0]}`;
            case 'Supermule':
                return `receiving from ${this.accountList.length} account(s)`;
            case 'Supplier':
                return `supplying ${this.batches.length} batch(es) to ${this.accountList.length} account(s)`;
            case 'Client':
                return `receiving ${this.batches.length} batch(es) from ${this.accountList[0]}`;
        }
    }

    private async walkToBank(): Promise<boolean> {
        if (this.atBank()) {
            return true;
        }
        this.setStatus(`walking to ${this.bankLabel}`);
        return Traversal.walkResilient(this.bankTileValue, {
            radius: 3,
            attempts: 6,
            timeoutMs: 240_000,
            log: message => this.log(`  ${message}`)
        });
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#a0e6c8' });
        p.title(`MuleDepot — ${this.roleValue} — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        p.row(`Runtime: ${fmtDuration(mins)}`, `Bank: ${this.bankLabel}`);
        if (this.roleValue === 'Supplier' || this.roleValue === 'Client') {
            const batch = this.currentBatch();
            p.row(`Client: ${this.currentClient() ?? 'done'}`, `Batch: ${batch ? `${batch.index + 1}/${this.batches.length}` : '—'}`, `Served: ${this.served.size}`);
            p.row(`Transfer: ${this.unitsMoved}`, `Batch holds: ${describeLines(batch?.lines ?? [])}`, '');
        } else {
            p.row(`Transfer: ${this.unitsMoved}`, `Accounts: ${this.accountList.length}`, isGiverRole(this.roleValue) ? 'giving' : 'taking');
            p.row(`Listed items: ${this.items.length}`, `Pack: ${this.packUsed()}/${PACK}`, '');
        }
        p.row(`Screens: ${this.screensOpened}`, `Completed: ${this.screensSucceeded}`, `Failed: ${this.screensFailed}`);
        ScriptRunner.paintControls(p);
        p.end();
    }

    // ── MuleDepotContext ──

    role(): Role { return this.roleValue; }
    bankTile(): Tile { return this.bankTileValue; }
    bankName(): string { return this.bankLabel; }
    accounts(): string[] { return this.accountList; }

    /** Total units in the pack, which is what a trade transfer is measured in. */
    packUnits(): number {
        return reader.inventory().reduce((sum, item) => sum + Math.max(1, item.count), 0);
    }
    packUsed(): number { return Inventory.used(); }
    packFree(): number { return Inventory.free(); }
    packNames(): string[] {
        return [...new Set(Inventory.items().map(item => item.name).filter((name): name is string => name !== null))];
    }
    /**
     * Whether the pack holds anything the depot did not plan. Why: a dumper's listed goods stay in
     * the pack on purpose, so `packUsed() > 0` would re-open the bank every loop and starve the trade.
     */
    packStrays(): boolean {
        if (this.roleValue !== 'Mule') {
            return this.packUsed() > 0;
        }
        const listed = this.items.map(name => name.toLowerCase());
        return Inventory.items().some(item => item.name !== null && !listed.includes(item.name!.toLowerCase()));
    }

    atBank(): boolean {
        const here = Game.tile();
        return here !== null && this.bankTileValue.distanceTo(here) <= BANK_RADIUS;
    }

    awayFromDepot(): boolean {
        const here = Game.tile();
        return here === null || this.bankTileValue.distanceTo(here) > LEASH_RADIUS;
    }

    dumpItems(): string[] { return this.items; }
    deliveries(): DeliveryBatch[] { return this.batches; }

    currentClient(): string | null {
        return nextUnserved(this.accountList, this.served);
    }

    currentBatch(): DeliveryBatch | null {
        return this.currentClient() === null ? null : this.batches[this.batchIndex] ?? null;
    }

    planDumpWithdrawal(): WithdrawalLine[] {
        if (this.roleValue !== 'Mule') {
            return [];
        }
        return planWithdrawal(this.items, bankRows(), this.packFree(), notedIds());
    }

    /** How much of a line the pack holds, noted and unnoted, since note mode decides which arrives. */
    private heldOf(line: DeliveryLine): { unnoted: number; noted: number; notedId: number } {
        // Why: a name-only loadout line carries no id, so it is counted by name and given the id
        // of the slot it sits in, or it reads as holding nothing and stakes nothing.
        if (line.id < 0) {
            const slot = Inventory.items().find(item => (item.name ?? '').toLowerCase() === line.name.toLowerCase());
            return {
                unnoted: line.name.length > 0 ? Inventory.count(line.name) : 0,
                noted: 0,
                notedId: slot?.id ?? -1
            };
        }
        const catalog = liveCatalog();
        const noted = catalogNotedId(catalog, line.id);
        return {
            unnoted: Inventory.countById(line.id),
            noted: noted === null ? 0 : Inventory.countById(noted),
            notedId: noted ?? line.id
        };
    }

    /**
     * The batch trimmed to what the pack holds. Why: staking more than is carried has the window
     * refuse the offer, leaving the loop offering into a window that never opens.
     */
    loadoutInPack(): DeliveryLine[] {
        const batch = this.currentBatch();
        if (!batch) {
            return [];
        }
        const out: DeliveryLine[] = [];
        for (const line of batch.lines) {
            const held = this.heldOf(line);
            const quantity = Math.min(line.quantity, held.unnoted + held.noted);
            if (quantity < 1) {
                continue;
            }
            // Why: an id-only line carries no name, and an offer click can only be aimed by the name
            // the client shows, so take both off whichever form the pack holds.
            const packId = held.noted > 0 ? held.notedId : line.id;
            const name = line.name.length > 0
                ? line.name
                : Inventory.items().find(item => item.id === packId)?.name ?? '';
            out.push({ id: packId, name, quantity });
        }
        return out;
    }

    /** How much of a line is already on our side of the open trade, if there is one. */
    private offeredOf(line: DeliveryLine): number {
        if (!Trade.active()) {
            return 0;
        }
        return Trade.myOffer().reduce((sum, offer) => {
            const matches = line.name.length > 0
                ? (offer.name ?? '').toLowerCase() === line.name.toLowerCase()
                : offer.id === line.id;
            return sum + (matches ? Math.max(1, offer.count) : 0);
        }, 0);
    }

    isPartner(name: string | null): boolean {
        return isConfiguredAccount(name, this.accountList);
    }

    /**
     * Whether this role wants a window with `name`. Why: the engine pairs a trade with whichever
     * side answers first, so a supplier asks one client and declines the rest.
     */
    acceptsTradeWith(name: string): boolean {
        if (this.roleValue !== 'Supplier') {
            return this.isPartner(name);
        }
        const client = this.currentClient();
        return client !== null
            && this.batchComplete()
            && normalizeAccount(client) === normalizeAccount(name);
    }
    nearestPartner(range: number = TRADE_RANGE): Player | null {
        if (this.accountList.length === 0) {
            return null;
        }
        return Players.query().name(...this.accountList).within(range).nearest();
    }

    /**
     * The partner by name, with no distance filter. Why: a walker cannot always close the last
     * tile, and a range gate here would hide a partner who is plainly on screen.
     */
    nearestAccount(): Player | null {
        return Players.query().name(...this.accountList).nearest();
    }

    /**
     * The account to offer a window to, rotating. Why: a trade opens only when both sides click, and
     * asking the nearest lets a finished mule, which lingers on the bank tile, starve every other.
     */
    offerTarget(): Player | null {
        const asker = this.asker !== null && Date.now() - this.askerAt < ASK_TTL_MS ? this.asker : null;
        const name = pickRequestTarget({
            asker,
            accounts: this.accountList,
            cursor: this.requestCursor,
            acceptable: candidate => this.acceptsTradeWith(candidate),
            visible: candidate => Players.query().name(candidate).nearest() !== null
        });
        return name === null ? null : Players.query().name(name).nearest();
    }
    tradeRequestDue(): boolean {
        return this.lastTradeRequestAt === null
            || Date.now() - this.lastTradeRequestAt >= TRADE_REQUEST_INTERVAL_MS;
    }
    markTradeRequest(): void {
        this.lastTradeRequestAt = Date.now();
        // Why: the cursor moves on every attempt, not only after a transfer, since a stopped mule
        // stays visible on the bank tile and would hold the rotation for ever.
        if (isReceiverRole(this.roleValue) && this.accountList.length > 0) {
            this.requestCursor = (this.requestCursor + 1) % this.accountList.length;
        }
    }

    recordTradeScreenOpen(): number { return ++this.screensOpened; }
    recordTradeScreenSuccess(): number { return ++this.screensSucceeded; }
    recordTradeScreenFailure(): number { return ++this.screensFailed; }

    recordTransfer(amount: number): number {
        this.transfers++;
        this.unitsMoved += Math.max(0, amount);
        // Why: a served account is retired as the asker, so the next ask goes to someone else.
        this.asker = null;
        return this.transfers;
    }

    batchShortfall(): DeliveryLine[] {
        const batch = this.currentBatch();
        if (!batch) {
            return [];
        }
        const wanted = batch.lines.filter(line => !this.unavailable.has(lineKey(line)));
        return shortfallFor(wanted, line => {
            const held = this.heldOf(line);
            // Why: staking takes the goods out of the pack, so a batch that is already up must still
            // count as complete or the supplier declines the window it just opened.
            return held.unnoted + held.noted + this.offeredOf(line);
        });
    }

    batchComplete(): boolean {
        return this.batchShortfall().length === 0;
    }

    markUnavailable(line: DeliveryLine): void {
        this.unavailable.add(lineKey(line));
    }

    setPendingDelivery(lines: DeliveryLine[]): void {
        this.pendingDelivery = lines.map(line => ({ ...line }));
    }

    /** Nothing of the current batch could be supplied: count it as attempted and move on. */
    skipBatch(): void {
        this.pendingDelivery = [];
        this.advanceBatch();
    }

    /** One batch landed: credit each line to the client, then advance. */
    markBatchServed(_amount: number): void {
        const client = this.currentClient();
        if (client === null) {
            return;
        }
        const delivered = this.delivered.get(client) ?? new Map<string, number>();
        for (const line of this.pendingDelivery) {
            const key = lineKey(line);
            delivered.set(key, (delivered.get(key) ?? 0) + line.quantity);
        }
        this.delivered.set(client, delivered);
        this.pendingDelivery = [];
        this.advanceBatch();
    }

    private advanceBatch(): void {
        const client = this.currentClient();
        if (client === null) {
            return;
        }
        const moved = nextBatchIndex(this.batchIndex, this.batches.length);
        this.batchIndex = moved.index;
        if (!moved.clientDone) {
            return;
        }
        this.served.add(normalizeAccount(client));
        if (this.currentClient() === null) {
            this.finishSupply();
        }
    }

    /** Stop with what was delivered, and name every shortfall rather than reporting a clean pass. */
    private finishSupply(): void {
        const requested = new Map<string, { name: string; quantity: number }>();
        for (const line of this.lines) {
            const key = lineKey(line);
            const held = requested.get(key);
            if (held) {
                held.quantity += line.quantity;
            } else {
                requested.set(key, { name: line.name || `#${line.id}`, quantity: line.quantity });
            }
        }

        const short: string[] = [];
        for (const client of this.accountList) {
            const delivered = this.delivered.get(client) ?? new Map<string, number>();
            const parts: string[] = [];
            for (const [key, want] of requested) {
                const got = delivered.get(key) ?? 0;
                if (got < want.quantity) {
                    parts.push(`${want.quantity - got} ${want.name}`);
                }
            }
            if (parts.length > 0) {
                short.push(`${client}: ${parts.join(' + ')}`);
            }
        }

        const supplied = `MuleDepot: supplied ${this.batches.length} batch(es) to ${this.served.size} account(s), ${this.unitsMoved} item(s) moved`;
        if (short.length === 0) {
            ScriptRunner.stop(supplied);
            return;
        }

        const shown = short.slice(0, 4).join('; ');
        const more = short.length > 4 ? `; +${short.length - 4} more account(s)` : '';
        ScriptRunner.stop(`${supplied} — short: ${shown}${more}`);
    }

    async walkTo(dest: Tile, radius = 2): Promise<void> {
        const here = Game.tile();
        if (here && dest.distanceTo(here) <= radius) {
            return;
        }
        if (!Game.ingame()) {
            await Execution.delayUntil(() => Game.ingame(), 30_000);
        }
        await Traversal.walkResilient(dest, { radius, attempts: 6, timeoutMs: 240_000, log: message => this.log(`  ${message}`) });
    }

    currentTile(): Tile | null {
        const tile = Game.tile();
        return tile === null ? null : Tile.from(tile);
    }
    setStatus(status: string): void { this.status = status; }

    // ── composition ──

    /**
     * One ordered task list per role. Role differences are predicates and a bank policy; no role
     * subclasses another and no two share a walk.
     */
    private composeTasks(): Task[] {
        const trade = new TradeScreenTask(this, isGiverRole(this.roleValue) ? giverFlavour(this) : receiverFlavour(this));
        const closeBank = createCloseBankTask(this);
        const carrying = (): boolean => !Trade.active()
            && this.packUsed() > 0
            && (this.roleValue !== 'Supplier' || this.batchComplete());

        switch (this.roleValue) {
            case 'Mule':
                return [
                    trade,
                    closeBank,
                    createDumperBankTask(this),
                    new WalkToTask(this, () => this.bankTile(), () => !carrying() && !this.atBank(), 3, 'walking to the bank'),
                    new ApproachPartnerTask(this, carrying, TRADE_RANGE, APPROACH_RANGE),
                    new TradeRequestTask(this, {
                        ready: carrying,
                        candidate: () => this.nearestAccount(),
                        status: () => 'requesting a trade with {name}'
                    }),
                    new ReturnToDepotTask(this),
                    new WaitTask(this, () => carrying() && this.nearestAccount() === null, () => 'no supermule in sight')
                ];
            case 'Supermule':
                return [
                    trade,
                    closeBank,
                    createSupermuleBankTask(this),
                    new TradeRequestTask(this, {
                        ready: () => !Trade.active() && this.packUsed() === 0,
                        candidate: () => this.offerTarget(),
                        status: () => 'offering a trade to {name}'
                    }),
                    new ReturnToDepotTask(this),
                    new WaitTask(this, () => !Trade.active() && this.packUsed() === 0, () => `waiting for a trade from ${this.accountList.length} account(s)`)
                ];
            case 'Supplier':
                return [
                    trade,
                    closeBank,
                    createSupplierBankTask(this),
                    new WalkToTask(
                        this,
                        () => this.bankTile(),
                        () => !Trade.active() && !this.batchComplete() && !this.atBank(),
                        3,
                        'returning to the bank for the next batch'
                    ),
                    new ApproachPartnerTask(this, carrying, TRADE_RANGE, APPROACH_RANGE),
                    new TradeRequestTask(this, {
                        ready: carrying,
                        candidate: () => this.offerTarget(),
                        status: () => 'requesting a trade with {name}'
                    }),
                    new ReturnToDepotTask(this),
                    new WaitTask(this, () => carrying() && this.nearestAccount() === null, () => 'no client in sight')
                ];
            case 'Client':
                return [
                    trade,
                    closeBank,
                    createClientBankTask(this),
                    new WalkToTask(this, () => this.bankTile(), () => !Trade.active() && !this.atBank(), BANK_RADIUS, 'walking to the depot'),
                    new TradeRequestTask(this, {
                        ready: () => !Trade.active() && this.packUsed() === 0,
                        candidate: () => this.offerTarget(),
                        status: () => 'offering a trade to {name}'
                    }),
                    new ReturnToDepotTask(this),
                    new WaitTask(this, () => !Trade.active() && this.packUsed() === 0, () => `waiting for ${this.accountList[0] ?? 'the supplier'}`)
                ];
        }
    }
}
