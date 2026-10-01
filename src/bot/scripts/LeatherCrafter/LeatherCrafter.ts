import { reader, actions } from '../../adapter/ClientAdapter.js';
import { LoopingBot } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import Tile from '../../geometry/Tile.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { Bank } from '../../api/bank/Bank.js';
import { nearestBankReachable } from '../../api/bank/BankLocations.js';
import { Navigator } from '../../event/webwalk/Navigator.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Paint } from '../../paint/Paint.js';
import { Shop } from '../../api/shop/Shop.js';
import { Skills } from '../../api/skills/Skills.js';
import { Input } from '../../input/Input.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import {
    STALL_TICKS,
    findOp,
    issueHardLeatherBurst,
    newDrain,
    predictLeatherSlots,
    sideCacheFrom,
    stepDrain,
    type SideCache
} from './LeatherCrafterLogic.js';

const NEEDLE = 1733;
const THREAD = 1734;
const COINS = 995;
const THREAD_MAX_PRICE = 3;
const THREAD_SHOPS = [
    { npc: 'Dommik', tile: new Tile(3322, 3194, 0) },
    { npc: 'Rommik', tile: new Tile(2946, 3205, 0) },
    { npc: 'Fancy dress shop owner', tile: new Tile(3281, 3398, 0) }
];
/** A cached bank row: the Withdraw-All target for the leather, learned on a normal trip. */
interface BankRow {
    id: number;
    slot: number;
    comId: number;
    op: number;
}

const HARD_LEATHER = 1743;
const HARDLEATHER_BODY = 1131;
const BANK_STAND = new Tile(3269, 3167, 0);
// Why: a full 26-leather burst drains at the server's 5 user events per tick, so ~6 ticks is the
// floor; the cap leaves room for the re-fires and still bounds a burst the server never drains.
const SETTLE_TICKS = 40;

// Why: tick-bounded, not ms-bounded, because a wall-clock timeout drifts against game time and burns its budget on a lag spike.
const DIALOG_OPENS_TICKS = 5;
const WITHDRAW_LANDS_TICKS = 6;
const SIDE_READY_TICKS = 2;
const DEPOSIT_LANDS_TICKS = 3;
const BANK_LOADS_TICKS = 5;
const BANK_CLOSES_TICKS = 5;
const BANK_CLOSES_MS = 3000;
// Why: budgets, not waits, since every one of these gates a condition and none of them sleeps blind.
const BANK_SETTLE_MS = 1500;
const THREAD_STOCK_MS = 4000;
const SPECULATIVE_CONFIRM_MS = 4000;

// leather_crafting opens as a main modal, skill_multi3 as a chat one
const LEATHER_IF = 2311;
const MULTI3_IF = 8880;
// skill_multi3 "make X" per slot: a = body, b = vambraces, c = chaps
const MULTI3_MAKEX = { a: 8886, b: 8890, c: 8894 };

interface Recipe {
    level: number;
    qty: number;
    label: string;
    // soft leather picks a button on the leather_crafting interface; dragonhide
    // answers the shared skill_multi3 chat dialog instead
    make1?: number;
    make10?: number;
    slot?: 'a' | 'b' | 'c';
}

interface LeatherKind {
    leatherId: number;
    flow: 'interface' | 'single' | 'multi3';
    recipes: Recipe[];
}

// Why: the levels and quantities are the engine's craft_leather_table.
// Why: chaps deliberately has no make10, since all three of its buttons make one engine-side.
const LEATHERS: Record<string, LeatherKind> = {
    Leather: {
        leatherId: 1741,
        flow: 'interface',
        recipes: [
            { level: 1, qty: 1, label: 'Leather gloves', make1: 8638, make10: 8636 },
            { level: 7, qty: 1, label: 'Leather boots', make1: 8641, make10: 8639 },
            { level: 9, qty: 1, label: 'Leather cowl', make1: 8653, make10: 8651 },
            { level: 11, qty: 1, label: 'Leather vambraces', make1: 8644, make10: 8642 },
            { level: 14, qty: 1, label: 'Leather body', make1: 8635, make10: 8633 },
            { level: 18, qty: 1, label: 'Leather chaps', make1: 8647, make10: 8645 },
            { level: 38, qty: 1, label: 'Coif', make1: 8650, make10: 8648 }
        ]
    },
    'Hard leather': {
        leatherId: 1743,
        flow: 'single',
        recipes: [{ level: 28, qty: 1, label: 'Hardleather body' }]
    },
    'Green dragon leather': {
        leatherId: 1745,
        flow: 'multi3',
        recipes: [
            { level: 57, qty: 1, label: 'Green vambraces', slot: 'b' },
            { level: 60, qty: 2, label: 'Green chaps', slot: 'c' },
            { level: 63, qty: 3, label: 'Green body', slot: 'a' }
        ]
    },
    'Blue dragon leather': {
        leatherId: 2505,
        flow: 'multi3',
        recipes: [
            { level: 66, qty: 1, label: 'Blue vambraces', slot: 'b' },
            { level: 68, qty: 2, label: 'Blue chaps', slot: 'c' },
            { level: 71, qty: 3, label: 'Blue body', slot: 'a' }
        ]
    },
    'Red dragon leather': {
        leatherId: 2507,
        flow: 'multi3',
        recipes: [
            { level: 73, qty: 1, label: 'Red vambraces', slot: 'b' },
            { level: 75, qty: 2, label: 'Red chaps', slot: 'c' },
            { level: 77, qty: 3, label: 'Red body', slot: 'a' }
        ]
    },
    'Black dragon leather': {
        leatherId: 2509,
        flow: 'multi3',
        recipes: [
            { level: 79, qty: 1, label: 'Black vambraces', slot: 'b' },
            { level: 82, qty: 2, label: 'Black chaps', slot: 'c' },
            { level: 84, qty: 3, label: 'Black body', slot: 'a' }
        ]
    }
};

export const CRAFTER_SETTINGS: SettingsSchema = {
    leatherType: {
        type: 'string',
        default: 'Leather',
        options: Object.keys(LEATHERS),
        label: 'Leather to use',
        help: 'makes the best item your Crafting level allows for this leather; keeps a needle + thread and banks the rest'
    },
    threadPerTrip: { type: 'number', default: 100, min: 1, max: 1000, label: 'Thread to keep stocked' },
    speculativeLoad: {
        type: 'boolean',
        default: true,
        label: 'Speculative bank load',
        help: 'predicts where the withdrawn leather lands, then sends deposit, withdraw, close and the craft uses in a single pass instead of waiting between each; on by default, and a miss just falls back to the confirmed route for that trip'
    }
};

function invById(id: number): number {
    return Inventory.items()
        .filter(i => i.id === id)
        .reduce((n, i) => n + i.count, 0);
}

function opIndex(ops: readonly (string | null)[], pattern: RegExp): number {
    for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        if (op !== null && pattern.test(op)) {
            return i + 1;
        }
    }
    return -1;
}

type WithdrawResult = 'withdrawn' | 'missing' | 'retry';

// the bank helpers are name-keyed, which cannot separate same-named hides/leathers
async function withdrawXById(id: number, count: number): Promise<WithdrawResult> {
    if (count <= 0) {
        return 'withdrawn';
    }
    if (!Bank.ready()) {
        return 'retry';
    }
    const item = Bank.items().find(i => i.id === id);
    if (!item) {
        return 'missing';
    }
    const op = opIndex(item.ops, /withdraw[\s-]*x/i);
    if (op === -1) {
        return 'retry';
    }
    const before = invById(id);
    if (!(await Input.invButton(item.id, item.slot, item.comId, op))) {
        return 'retry';
    }
    if (!(await Execution.delayUntilTicks(() => reader.countDialogOpen(), DIALOG_OPENS_TICKS))) {
        return 'retry';
    }
    if (!actions.answerCountDialog(count)) {
        return 'retry';
    }
    return (await Execution.delayUntilTicks(() => invById(id) > before, WITHDRAW_LANDS_TICKS)) ? 'withdrawn' : 'retry';
}

// Why: the fused bank tail needs to send without waiting, so it resolves the row and dispatches the
// click in one step and lets a later confirm stand in for all of them.
async function fireWithdrawAllById(id: number, diag?: (msg: string) => void): Promise<{ ok: boolean; missing: boolean }> {
    if (!Bank.ready()) {
        return { ok: false, missing: false };
    }
    let item = Bank.items().find(i => i.id === id);
    if (!item) {
        // Why: a deposit can leave the bank list briefly rowless, so absence only counts once the list has moved on.
        const gen = Bank.snapshotGeneration();
        await Execution.delayUntil(() => Bank.snapshotGeneration() > gen || !Bank.isOpen(), BANK_SETTLE_MS);
        item = Bank.items().find(i => i.id === id);
        if (!item) {
            diag?.(`ready=${Bank.ready()} open=${Bank.isOpen()} gen=${Bank.snapshotGeneration()} rows=${JSON.stringify(Bank.items().map(r => [r.id, r.count]))}`);
            return { ok: false, missing: true };
        }
    }
    if (!item) {
        return { ok: false, missing: false };
    }
    const op = opIndex(item.ops, /withdraw[\s-]*all/i);
    if (op === -1) {
        return { ok: false, missing: false };
    }
    return { ok: Input.invButton(item.id, item.slot, item.comId, op), missing: false };
}

// Why: fires one Deposit-All per distinct id with no wait between them. The server handles the
// queued inv-button requests in send order, so the withdrawal that follows is the confirmation.
function fireDepositAllExceptIds(keep: ReadonlySet<number>): boolean {
    const side = reader.bankSideItems();
    if (side.length === 0) {
        return false;
    }
    const sent = new Set<number>();
    for (const item of side) {
        if (keep.has(item.id) || sent.has(item.id)) {
            continue;
        }
        const op = opIndex(item.ops, /deposit[\s-]*all/i);
        if (op === -1 || !Input.invButton(item.id, item.slot, item.comId, op)) {
            return false;
        }
        sent.add(item.id);
    }
    return true;
}

// deposits by object id: the leathers and their products share display names in
// places, so a name-keyed deposit would bank the wrong thing
async function depositAllExceptIds(keep: Set<number>): Promise<boolean> {
    for (let guard = 0; guard < 32; guard++) {
        let items = reader.bankSideItems();
        if (items.length === 0 && Inventory.used() > 0 && Bank.isOpen()) {
            await Execution.delayUntilTicks(() => reader.bankSideItems().length > 0 || !Bank.isOpen(), SIDE_READY_TICKS);
            items = reader.bankSideItems();
        }
        if (items.length === 0) {
            return Inventory.used() === 0;
        }
        const item = items.find(i => !keep.has(i.id));
        if (!item) {
            return true;
        }
        const op = opIndex(item.ops, /deposit[\s-]*all/i);
        if (op === -1) {
            return false;
        }
        if (!(await Input.invButton(item.id, item.slot, item.comId, op))) {
            return false;
        }
        if (!(await Execution.delayUntilTicks(() => !reader.bankSideItems().some(i => i.slot === item.slot && i.id === item.id), DEPOSIT_LANDS_TICKS))) {
            return false;
        }
    }
    return false;
}

export default class LeatherCrafter extends LoopingBot {
    override loopDelay = 100;

    private kind: LeatherKind = LEATHERS.Leather;
    private kindLabel = 'Leather';
    private recipe: Recipe | null = null;
    private threadStock = 100;
    private threadVendor: (typeof THREAD_SHOPS)[number] | null = null;
    private restockBank: Tile | null = null;
    private speculative = true;
    private bankRow: BankRow | null = null;
    private sideCache: SideCache | null = null;
    private tabComId: number | null = null;

    private crafted = 0;
    private xpAtStart = 0;
    private status = 'starting';
    private startedAt = Date.now();

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && reader.sceneState() === 2 && Game.tile() !== null && Skills.level('crafting') > 0, 0);

        this.kindLabel = this.settings.str('leatherType', 'Leather');
        this.kind = LEATHERS[this.kindLabel] ?? LEATHERS.Leather;
        this.threadStock = this.settings.num('threadPerTrip', 100);
        this.speculative = this.settings.bool('speculativeLoad', true);
        this.bankRow = null;
        this.sideCache = null;
        this.tabComId = null;
        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('crafting');

        this.pickRecipe();
        if (!this.recipe) {
            const need = Math.min(...this.kind.recipes.map(r => r.level));
            ScriptRunner.stop(`Crafting ${Skills.level('crafting')} is too low for ${this.kindLabel} (needs ${need})`);
            return;
        }
        this.log(`LeatherCrafter — ${this.kindLabel} -> ${this.recipe.label} (level ${this.recipe.level}, ${this.recipe.qty} per item)`);
    }

    // best = the highest-level item this Crafting level unlocks for the chosen leather
    private pickRecipe(): void {
        const level = Skills.level('crafting');
        const usable = this.kind.recipes.filter(r => r.level <= level).sort((a, b) => b.level - a.level);
        const next = usable[0] ?? null;
        if (next && next.label !== this.recipe?.label) {
            if (this.recipe) {
                this.log(`levelled up — switching to ${next.label}`);
            }
            this.recipe = next;
        }
    }

    async loop(): Promise<void> {
        this.pickRecipe();
        if (!this.recipe) {
            return;
        }

        const leather = invById(this.kind.leatherId);
        const thread = invById(THREAD);
        const used = Inventory.used();
        if (this.threadVendor) {
            this.log(`loop: buying thread (leather ${leather}, thread ${thread}, used ${used})`);
            await this.buyThread();
            return;
        }
        if (this.restockBank) {
            this.log(`loop: restock trip — banking (leather ${leather}, thread ${thread}, used ${used})`);
            await this.bankLeg();
            return;
        }
        if (leather >= this.recipe.qty && thread > 0) {
            this.log(`loop: crafting (leather ${leather}, thread ${thread}, used ${used})`);
            await this.craftLeg();
            return;
        }
        this.log(`loop: out of leather or thread — banking (leather ${leather}, thread ${thread}, used ${used})`);
        await this.bankLeg();
    }

    private async bankLeg(): Promise<boolean> {
        const here = Game.tile();
        // Why: walk to whichever bank is cheapest to reach rather than an air-nearest tile, so the bot banks from wherever the player already is. Bank contents are account-wide, so nothing else changes.
        const picked = here ? await nearestBankReachable(here, Navigator) : null;
        const stand = this.restockBank ?? picked?.tile ?? BANK_STAND;
        if (here) {
            this.log(`bank leg: from (${here.x}, ${here.z}, ${here.level}) standing near ${picked?.name ?? 'no picked bank'} (stand ${stand})`);
        }
        if (!here || Math.max(Math.abs(here.x - stand.x), Math.abs(here.z - stand.z)) > 4) {
            this.setStatus('walking to the bank');
            this.log(`bank leg: walking to ${picked?.name ?? stand}`);
            if (!(await Traversal.walkResilient(stand, { radius: 3, attempts: 2, timeoutMs: 45_000, log: m => this.log(`  ${m}`) }))) {
                this.log('bank leg: walk failed — retrying');
                return true;
            }
            this.log('bank leg: arrived at the bank');
        }

        this.setStatus('banking');
        this.log('bank leg: opening the bank');
        if (!(await Bank.openNearest('Bank booth', 'Use-quickly', m => this.log(`  ${m}`)))) {
            this.log('bank leg: could not open the bank — retrying');
            return true;
        }
        this.log('bank leg: bank opened');
        // Why: ready(), not loaded(), because loaded() means "the list is non-empty" and so cannot
        // tell a still-loading bank from a drained one, which would send us down the "no leather" stop.
        if (!(await Execution.delayUntilTicks(() => Bank.ready() || !Bank.isOpen(), BANK_LOADS_TICKS))) {
            this.log('bank leg: bank contents not ready — retrying');
            return true;
        }
        this.log(`bank leg: bank contents ready (row ${this.bankRow ? `${this.bankRow.id}@${this.bankRow.slot} op${this.bankRow.op}` : 'unseen'}, tab ${this.tabComId}, side ${this.sideCache ? 'yes' : 'no'})`);

        // Why: the speculative leg replaces the rest of this leg, so it runs before anything is spent on
        // the confirmed path. It needs a cached row from an earlier trip, so the first trip is normal.
        if (this.speculative && this.bankRow && (await this.speculativeLeg())) {
            return true;
        }

        const before = invById(this.kind.leatherId);
        const free = reader.inventorySize() - Inventory.used();

        // Why: the rows are only readable while the body is still in the pack, so learn them before the deposit goes out.
        const firstPackItem = reader.inventory()[0];
        if (firstPackItem) {
            this.tabComId = firstPackItem.comId;
        }
        this.sideCache = sideCacheFrom(reader.bankSideItems(), this.productId, findOp) ?? this.sideCache;
        const leatherRow = Bank.items().find(i => i.id === this.kind.leatherId);
        if (leatherRow) {
            const op = findOp(leatherRow.ops, /withdraw[\s-]*all/i);
            if (op !== -1) {
                this.bankRow = { id: leatherRow.id, slot: leatherRow.slot, comId: leatherRow.comId, op };
            }
        }

        if (!fireDepositAllExceptIds(new Set([NEEDLE, THREAD, this.kind.leatherId]))) {
            if (!(await depositAllExceptIds(new Set([NEEDLE, THREAD, this.kind.leatherId])))) {
                this.log('bank leg: bank inventory view not ready — retrying');
                return true;
            }
        }
        this.log('bank leg: deposited — now restocking');

        if (invById(NEEDLE) === 0 && !(await this.withdrawRequired(NEEDLE, 1, 'needle', 'no needle in the bank'))) {
            return true;
        }
        if (invById(THREAD) < 5) {
            this.log('bank leg: thread low — withdrawing thread');
            const result = await withdrawXById(THREAD, this.threadStock);
            if (result === 'retry') {
                this.log('bank leg: could not withdraw thread — retrying');
                return true;
            }
            if (result === 'missing' && invById(THREAD) === 0) {
                await this.fundThread(stand);
                return true;
            }
        }

        const load = await fireWithdrawAllById(this.kind.leatherId, m => this.log(`bank leg: MISSING ${m}`));
        if (load.missing) {
            // Why: missing is only claimed once ready() proved the list landed, so an empty row here
            // is a drained bank rather than a list still in flight.
            ScriptRunner.stop(`no ${this.kindLabel} left in the bank`);
            return true;
        }
        if (!load.ok && !(await this.withdrawRequired(this.kind.leatherId, free, this.kindLabel, `no ${this.kindLabel} left in the bank`))) {
            return true;
        }
        if (load.ok) {
            // Why: the pack filling is the only confirmation worth waiting on, because a deposit
            // that did not land leaves no free slot, so the withdrawal is what proves both.
            await Execution.delayUntilTicks(
                () => invById(this.kind.leatherId) > before || Inventory.isFull(),
                WITHDRAW_LANDS_TICKS
            );
        }
        await Bank.close(BANK_CLOSES_MS);
        if (!Bank.isOpen()) {
            this.restockBank = null;
        }
        this.log(`bank leg: loaded ${invById(this.kind.leatherId)} ${this.kindLabel} (${Inventory.used()}/${reader.inventorySize()} slots used)`);
        return true;
    }

    private async fundThread(stand: Tile): Promise<void> {
        if (!(await depositAllExceptIds(new Set([NEEDLE, THREAD, COINS])))) return;
        const available = Bank.items().find(item => item.id === COINS)?.count ?? 0;
        const needed = Math.max(0, this.threadStock * THREAD_MAX_PRICE - invById(COINS));
        if (needed > 0 && available > 0 && (await withdrawXById(COINS, Math.min(available, needed))) !== 'withdrawn') return;
        if (invById(COINS) === 0) {
            ScriptRunner.stop('no thread or coins in the bank');
            return;
        }
        this.restockBank = stand;
        this.threadVendor = THREAD_SHOPS.reduce((nearest, shop) => (stand.distanceTo(shop.tile) < stand.distanceTo(nearest.tile) ? shop : nearest));
        actions.closeModal();
        await Execution.delayUntilTicks(() => !Bank.isOpen(), BANK_CLOSES_TICKS);
    }

    private async buyThread(): Promise<void> {
        const vendor = this.threadVendor!;
        if (Bank.isOpen()) {
            actions.closeModal();
            if (!(await Execution.delayUntilTicks(() => !Bank.isOpen(), BANK_CLOSES_TICKS))) return;
        }
        this.setStatus(`buying thread from ${vendor.npc}`);
        const here = Game.tile();
        if (!here || vendor.tile.distanceTo(here) > 4) {
            if (!(await Traversal.walkResilient(vendor.tile, { radius: 2, attempts: 2, timeoutMs: 45_000, log: message => this.log(message) }))) return;
        }
        if (!(await Shop.open(vendor.npc))) return;
        await Shop.buy('Thread', Math.max(0, this.threadStock - invById(THREAD)));
        await Shop.close();
        if (invById(THREAD) > 0) {
            this.threadVendor = null;
        } else if (invById(COINS) === 0) {
            ScriptRunner.stop('not enough coins to buy thread');
        } else {
            this.setStatus('waiting for thread stock');
            await Execution.delayUntil(() => invById(THREAD) > 0 || invById(COINS) === 0, THREAD_STOCK_MS);
        }
    }

    private async withdrawRequired(id: number, count: number, label: string, stopReason: string): Promise<boolean> {
        const result = await withdrawXById(id, count);
        if (result === 'withdrawn') {
            return true;
        }
        if (result === 'retry') {
            this.log(`could not withdraw ${label} — retrying`);
            return false;
        }
        ScriptRunner.stop(stopReason);
        return false;
    }

    private async craftLeg(): Promise<void> {
        const recipe = this.recipe!;
        const needle = Inventory.items().find(i => i.id === NEEDLE);
        const leathers = Inventory.items().filter(i => i.id === this.kind.leatherId);
        if (!needle || leathers.length === 0) {
            return;
        }

        const before = invById(this.kind.leatherId);
        this.setStatus(`making ${recipe.label}`);
        this.log(`craft leg: making ${recipe.label} (leather ${before}, thread ${invById(THREAD)}, used ${Inventory.used()})`);

        if (this.kind.flow === 'single') {
            // Why: no make-X interface exists for hard leather; the server crafts synchronously and always consumes first-in-inventory, so spam the last slot exactly leather-count times (GemCutter pattern, count-capped so no dead packets queue behind the bank open).
            const lastSlot = leathers[leathers.length - 1]!;
            const bursts = await issueHardLeatherBurst(
                Array.from({ length: before }, () => lastSlot),
                target => needle.useOn(target)
            );
            this.log(`craft leg: hard leather burst made ${bursts}`);
            if (bursts === 0) {
                return;
            }
            await this.watchBurst(before);
        } else if (!(await needle.useOn(leathers[0]))) {
            return;
        } else if (this.kind.flow === 'interface') {
            if (!(await Execution.delayUntil(() => reader.modals().main === LEATHER_IF, 5000))) {
                return;
            }
            actions.ifButton(recipe.make10 ?? recipe.make1!);
            await this.awaitCrafting(before);
        } else {
            if (!(await Execution.delayUntil(() => reader.modals().chat === MULTI3_IF, 5000))) {
                return;
            }
            actions.ifButton(MULTI3_MAKEX[recipe.slot!]);
            if (!(await Execution.delayUntilTicks(() => reader.countDialogOpen(), DIALOG_OPENS_TICKS))) {
                return;
            }
            actions.answerCountDialog(Math.floor(before / recipe.qty));
            await this.awaitCrafting(before);
        }

        const used = before - invById(this.kind.leatherId);
        if (used > 0) {
            this.crafted += Math.floor(used / recipe.qty);
            this.log(`craft leg: made ${Math.floor(used / recipe.qty)} ${recipe.label} (leather now ${invById(this.kind.leatherId)}, used ${Inventory.used()})`);
        } else {
            this.log(`craft leg: no leather consumed (leather ${before} unchanged)`);
        }
    }

    // Watches the leather count per tick until the burst stops draining; quiet ticks re-fire at the slots still holding leather.
    private async watchBurst(before: number): Promise<void> {
        const needle = Inventory.items().find(i => i.id === NEEDLE);
        let state = newDrain(before);
        let left = before;
        for (let tick = 0; tick < SETTLE_TICKS; tick++) {
            await Execution.delayTicks(1);
            left = invById(this.kind.leatherId);
            const step = stepDrain(state, left, invById(THREAD) === 0);
            state = step.state;
            if (step.action === 'done') {
                return;
            }
            if (step.action === 'refire') {
                const remaining = Inventory.items().filter(i => i.id === this.kind.leatherId);
                if (!needle || remaining.length === 0) {
                    return;
                }
                const sent = await issueHardLeatherBurst(
                    Array.from({ length: remaining.length }, () => remaining[remaining.length - 1]!),
                    target => needle.useOn(target)
                );
                this.log(`craft leg: no progress for ${STALL_TICKS} ticks with ${left} leather left, re-fire ${state.refires} sent ${sent} uses`);
                if (sent === 0) {
                    return;
                }
            }
        }
        this.log(`craft leg: burst watcher gave up after ${SETTLE_TICKS} ticks with ${left} leather left`);
    }

    // craft batches tick along item by item; stop waiting once the leather stops moving
    private async awaitCrafting(before: number): Promise<void> {
        let last = before;
        for (let idle = 0; idle < 8; idle++) {
            const settled = await Execution.delayUntil(() => invById(this.kind.leatherId) < last, 4000);
            const now = invById(this.kind.leatherId);
            if (now < this.recipe!.qty || invById(THREAD) === 0) {
                return;
            }
            if (!settled && now === last) {
                return;
            }
            last = now;
        }
    }

    /** One pass for deposit, withdraw, close and every craft use, aimed at the predicted landing slots. */
    private async speculativeLeg(): Promise<boolean> {
        const row = this.bankRow;
        const tab = this.tabComId;
        if (!row || tab === null || !this.sideCache) {
            return false;
        }
        // Why: the prediction only accounts for the needle, thread, leftover leather and the body it
        // is about to deposit, so anything else in the pack makes the slot count unknowable.
        const pack = reader.bankSideItems();
        const needle = pack.find(i => i.id === NEEDLE);
        const known = new Set([NEEDLE, THREAD, this.kind.leatherId, this.productId]);
        if (!needle || pack.some(i => !known.has(i.id))) {
            return false;
        }
        const slots = predictLeatherSlots(
            pack.map(i => ({ slot: i.slot, id: i.id })),
            new Set([this.productId]),
            reader.inventorySize()
        );
        if (slots.length === 0) {
            return false;
        }

        // Why: the order is the point, and nothing waits. The deposit frees slots, the withdrawal fills the predicted ones, and the uses then name slots the server is about to populate.
        const body = pack.find(i => i.id === this.productId);
        if (body && this.sideCache) {
            Input.invButton(body.id, body.slot, this.sideCache.comId, this.sideCache.op);
        }
        Input.invButton(row.id, row.slot, row.comId, row.op);
        actions.closeModal();

        let sent = 0;
        for (const slot of slots) {
            if (!Input.useItemOnItem(NEEDLE, needle.slot, tab, this.kind.leatherId, slot, tab)) {
                break;
            }
            sent++;
        }

        // Why: a miss falls through to the confirmed path rather than latching, since the server drops a mispredicted use harmlessly.
        const arrived = await Execution.delayUntil(
            () => invById(this.kind.leatherId) > 0 || invById(this.productId) > 0,
            SPECULATIVE_CONFIRM_MS
        );
        if (!arrived) {
            this.log(`speculative load missed (nothing landed from ${sent} uses) — banking the confirmed way`);
            return false;
        }
        const total = invById(this.kind.leatherId) + invById(this.productId);
        if (total !== slots.length) {
            this.log(`speculative load missed (pack held ${total}, predicted ${slots.length}) — banking the confirmed way`);
            return false;
        }
        this.log(`speculative load: ${sent} uses at predicted slots`);

        const before = invById(this.kind.leatherId);
        await this.watchBurst(before);
        this.crafted += invById(this.productId);
        this.restockBank = null;
        return true;
    }

    /** The crafted product's object id, which is what the bank-side rows carry after a trip. */
    private get productId(): number {
        return this.kind.leatherId === HARD_LEATHER ? HARDLEATHER_BODY : this.kind.leatherId;
    }

    private setStatus(s: string): void {
        this.status = s;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#b07d4a' });
        p.title(`Leather Crafter — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        const xp = Skills.xp('crafting') - this.xpAtStart;
        p.row(`Runtime: ${fmtDuration(mins)}`, `Made: ${this.crafted}`, `XP/hr: ${mins > 0.5 ? Math.round((xp / mins) * 60) : 0}`);
        p.row(`Item: ${this.recipe?.label ?? '-'}`, `Craft lvl: ${Skills.level('crafting')}`, `Thread: ${invById(THREAD)}`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}
