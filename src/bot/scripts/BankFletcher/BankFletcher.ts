import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import Tile from '../../geometry/Tile.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Inventory, InvItem } from '../../api/inventory/Inventory.js';
import { Bank, withdrawOp } from '../../api/bank/Bank.js';
import { depositAllExcept } from '../../api/bank/Banking.js';
import { Paint } from '../../paint/Paint.js';
import { Skills } from '../../api/skills/Skills.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import { SettingsStore, type SettingsSchema } from '../../runtime/Settings.js';
import type { InvItemSnapshot } from '../../adapter/ClientAdapter.js';
import {
    BOW_STRING,
    EMPTY_READ_LIMIT,
    INSTANT_ACTIONS_PER_TICK,
    LOG_OPTIONS,
    PRODUCT_OPTIONS,
    attachPlanFor,
    bankListState,
    batchRideFloor,
    canWithdrawByName,
    countById,
    exactName,
    fixedWithdrawClicks,
    hasFletchWork,
    instantActionsFor,
    keepNames,
    knifeProductLevel,
    lastItemById,
    logNameMatches,
    makeBatchCount,
    matchProduct,
    needsRestock,
    nextEmptyReadsByKey,
    productNeedsDifferentLog,
    shortBowXpHint,
    shouldStopEmpty,
    shouldStopNoProgress,
    stockAction,
    stringIsStacked,
    stringPlanFor,
    stringWithdrawPlan,
    workKind,
    type AttachPlan,
    type StringPlan,
    type WorkKind
} from './BankFletcherLogic.js';
import { fmtDuration } from '../../paint/paintLogic.js';

const DEFAULT_BANK_STAND = new Tile(3185, 3440, 0);
const FLETCHING_KNIFE = 'Knife';
const BOOTH = { op: 'Use-quickly' };
const LIST_WAIT_TICKS = 7;
const WITHDRAW_CONFIRM_TICKS = 4;
const BATCH_IDLE_TICKS = 12;

export const SETTINGS: SettingsSchema = {
    material: {
        type: 'string',
        default: 'Logs',
        options: LOG_OPTIONS,
        label: 'Log type',
        help: 'the exact log to withdraw and fletch — only regular Logs make Arrow shafts; every log makes a bow. Selects the unstrung wood for String short/long bow. Ignored for the arrow attach products'
    },
    product: {
        type: 'string',
        default: 'Arrow shafts',
        options: PRODUCT_OPTIONS,
        label: 'Fletch product',
        help: 'knife products open the make-menu; string products attach Bow string onto the unstrung bow for this log type; arrow products attach item-on-item (material/knife ignored)'
    },
    bankStand: { type: 'tile', default: DEFAULT_BANK_STAND, label: 'Bank stand tile (x,z)', help: 'stand adjacent to a bank booth — start the bot here' },
    bankBooth: { type: 'string', default: 'Bank booth', label: 'Bank booth loc name' },
    leashRadius: { type: 'number', default: 6, min: 2, max: 20, label: 'Booth search radius (tiles)' }
};

async function withdrawStack(item: InvItemSnapshot, log: (m: string) => void): Promise<boolean> {
    const allOp = withdrawOp(item.ops, 'all') ?? withdrawOp(item.ops, 'any') ?? 'Withdraw-All';
    log(`withdrawing all id ${item.id} ('${allOp}')`);
    return Boolean(await Bank.withdrawById(item.id, allOp));
}

async function clickWithdraw(item: InvItemSnapshot, op: string, log: (m: string) => void, quiet = false): Promise<boolean> {
    if (!quiet) {
        log(`withdrawing id ${item.id} ('${op}')`);
    }
    return Boolean(await Bank.withdrawById(item.id, op));
}

async function withdrawExact(
    item: InvItemSnapshot,
    n: number,
    got: () => number,
    log: (m: string) => void
): Promise<boolean> {
    if (n <= 0) {
        return true;
    }
    const before = got();
    const tenOp = withdrawOp(item.ops, '10');
    const oneOp = withdrawOp(item.ops, '1') ?? withdrawOp(item.ops, 'any');
    const plan = fixedWithdrawClicks(n);
    const canFixed = plan.every(amount => (amount === 10 ? tenOp : oneOp));
    if (canFixed && plan.length > 0) {
        log(`withdrawing ${n} of id ${item.id} (${plan.join('+')})`);
        let remaining = n;
        let current = item;
        while (remaining > 0 && !Inventory.isFull()) {
            const clickBefore = got();
            const burst = fixedWithdrawClicks(remaining).slice(0, INSTANT_ACTIONS_PER_TICK);
            if (burst.length === 0) {
                break;
            }
            const expected = burst.reduce((sum, amount) => sum + amount, 0);
            for (const amount of burst) {
                const op = amount === 10 ? tenOp : oneOp;
                if (!op || !(await clickWithdraw(current, op, log, true))) {
                    return got() > before;
                }
            }
            await Execution.delayUntilTicks(
                () => got() - clickBefore >= expected || Inventory.isFull(),
                WITHDRAW_CONFIRM_TICKS
            );
            const gained = got() - clickBefore;
            if (gained <= 0) {
                break;
            }
            remaining -= gained;
            const next = Bank.items().find(i => i.id === item.id);
            if (!next) {
                break;
            }
            current = next;
        }
        return got() > before;
    }
    if (item.name && canWithdrawByName(Bank.items(), item.id)) {
        log(`withdrawing ${n} ${item.name}`);
        if (!(await Bank.withdrawX(item.name, n))) {
            return false;
        }
        return got() > before || Inventory.isFull();
    }
    log(`withdrawing ${n} of id ${item.id}`);
    if (!(await Bank.withdrawXById(item.id, n))) {
        return false;
    }
    return got() > before || Inventory.isFull();
}

export default class BankFletcher extends TaskBot {
    override loopDelay = 600;

    private made = 0;
    private trips = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;
    private emptyReads: Record<string, number> = {};

    private material = 'Logs';
    private product = 'Arrow shafts';
    private bankStand = DEFAULT_BANK_STAND;
    private boothName = 'Bank booth';
    private leash = 6;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.material = this.settings.str('material', 'Logs');
        this.product = this.settings.str('product', 'Arrow shafts');
        this.bankStand = this.settings.tile('bankStand', DEFAULT_BANK_STAND);
        this.boothName = this.settings.str('bankBooth', 'Bank booth');
        this.leash = this.settings.num('leashRadius', 6);

        const kind = this.workKind();
        const attach = attachPlanFor(this.product);
        const stringing = stringPlanFor(this.product, this.material);
        const knifeLevel = knifeProductLevel(this.product, this.material);
        const need = attach?.level ?? stringing?.level ?? knifeLevel;
        if (need !== null && need !== undefined && Skills.level('fletching') < need) {
            this.log(`BankFletcher: Fletching ${need} required for ${this.product} (have ${Skills.level('fletching')}) — stopping.`);
            throw new Error('BankFletcher: fletching level too low for the chosen product');
        }
        if (kind === 'string' && !stringing) {
            this.log(`BankFletcher: Stringing '${this.product}' needs a known log type, not '${this.material}' — stopping.`);
            throw new Error('BankFletcher: stringing needs a known log type');
        }
        if (kind === 'knife' && productNeedsDifferentLog(this.product, this.material)) {
            this.log(`BankFletcher: Arrow shafts fletch only from regular Logs, not '${this.material}' — pick Logs or a bow product. Stopping.`);
            throw new Error('BankFletcher: arrow shafts require regular Logs');
        }

        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('fletching');
        this.emptyReads = {};

        if (stringing) {
            this.log(`BankFletcher stringing '${stringing.displayName}' (u id ${stringing.unstrungId}) at ${this.bankStand} (booth '${this.boothName}', r${this.leash})`);
        } else if (attach) {
            this.log(`BankFletcher attaching '${attach.inputs[0]}' onto '${attach.inputs[1]}' → ${attach.product} at ${this.bankStand} (booth '${this.boothName}', r${this.leash})`);
        } else {
            this.log(`BankFletcher fletching '${this.material}' → ${this.product} at ${this.bankStand} (booth '${this.boothName}', r${this.leash})`);
        }
        this.add(new ContinueDialog(), new FletchDialog(this), new BankTrip(this), new InstantAttach(this), new Fletch(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#c9a0ff' });
        p.title(`BankFletcher — ${this.status}`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        const xph = mins > 0.5 ? `${(((Skills.xp('fletching') - this.xpAtStart) / mins) * 60 / 1000).toFixed(1)}k` : '—';
        p.row(`Runtime: ${fmtDuration(mins)}`, `XP/hr: ${xph}`);
        p.row(`${this.product}: ${this.made}`, `Bank trips: ${this.trips}`);
        const stringing = this.stringPlan();
        const paintPlan = this.attachPlan();
        if (stringing) {
            p.row(`String: ${this.packCountById(stringing.stringId)}`, `(u): ${this.packCountById(stringing.unstrungId)}`);
        } else if (paintPlan) {
            p.row(`${paintPlan.inputs[0]}: ${this.packCount(paintPlan.inputs[0])}`, `${paintPlan.inputs[1]}: ${this.packCount(paintPlan.inputs[1])}`);
        } else {
            p.row(`Logs left: ${this.logCount()}`, `Knife: ${this.knifeCount() > 0 ? 'held' : 'missing'}`);
            const hint = shortBowXpHint(this.product, this.material, Skills.level('fletching'));
            if (hint) {
                p.row(hint);
            }
        }

        p.gap();
        const picked = p.select('product', 'product', PRODUCT_OPTIONS, this.product);
        if (picked && picked !== this.product) {
            this.switchProduct(picked);
        }
        ScriptRunner.paintControls(p);
        p.end();
    }

    private switchProduct(product: string): void {
        this.product = product;
        SettingsStore.save('BankFletcher', 'product', product);
        this.log(`fletch product switched to ${product} (from the paint)`);
    }

    setStatus(s: string): void { this.status = s; }
    recordMade(n: number): void { this.made += n; }
    countTrip(): void { this.trips++; }
    productName(): string { return this.product; }
    materialName(): string { return this.material; }
    knifeName(): string { return FLETCHING_KNIFE; }
    bankTile(): Tile { return this.bankStand; }
    boothLocName(): string { return this.boothName; }
    leashRadius(): number { return this.leash; }
    emptyReadCount(key: string): number { return this.emptyReads[key] ?? 0; }
    noteEmpty(key: string, action: ReturnType<typeof stockAction>): void {
        this.emptyReads = nextEmptyReadsByKey(this.emptyReads, key, action);
    }

    workKind(): WorkKind {
        return workKind(this.product);
    }

    attachPlan(): AttachPlan | null {
        return attachPlanFor(this.product);
    }

    stringPlan(): StringPlan | null {
        return stringPlanFor(this.product, this.material);
    }

    keepList(): string[] {
        return keepNames(this.workKind(), this.knifeName());
    }

    packCount(name: string): number {
        const pat = name.toLowerCase();
        return Inventory.items().filter(i => i.name?.toLowerCase().includes(pat)).reduce((n, i) => n + Math.max(1, i.count), 0);
    }

    packItem(name: string): InvItem | null {
        const pat = name.toLowerCase();
        return Inventory.items().find(i => i.name?.toLowerCase().includes(pat)) ?? null;
    }

    packCountById(id: number): number {
        return countById(Inventory.items(), id);
    }

    packItemById(id: number): InvItem | null {
        return lastItemById(Inventory.items(), id);
    }

    logCount(): number {
        return Inventory.items().filter(i => logNameMatches(i.name, this.material)).reduce((n, i) => n + Math.max(1, i.count), 0);
    }

    lastLog(): InvItem | null {
        const items = Inventory.items();
        for (let i = items.length - 1; i >= 0; i--) {
            if (logNameMatches(items[i].name, this.material)) {
                return items[i];
            }
        }
        return null;
    }

    knifeItem(): InvItem | null {
        return exactName(Inventory.items(), FLETCHING_KNIFE);
    }

    knifeCount(): number {
        return this.knifeItem() === null ? 0 : 1;
    }

    instantInput0(): InvItem | null {
        const stringing = this.stringPlan();
        if (stringing) {
            return this.packItemById(stringing.stringId);
        }
        const attach = this.attachPlan();
        return attach ? this.packItem(attach.inputs[0]) : null;
    }

    instantInput1(): InvItem | null {
        const stringing = this.stringPlan();
        if (stringing) {
            return this.packItemById(stringing.unstrungId);
        }
        const attach = this.attachPlan();
        return attach ? this.packItem(attach.inputs[1]) : null;
    }

    instantInput0Count(): number {
        const stringing = this.stringPlan();
        if (stringing) {
            return this.packCountById(stringing.stringId);
        }
        const attach = this.attachPlan();
        return attach ? this.packCount(attach.inputs[0]) : 0;
    }

    instantInput1Count(): number {
        const stringing = this.stringPlan();
        if (stringing) {
            return this.packCountById(stringing.unstrungId);
        }
        const attach = this.attachPlan();
        return attach ? this.packCount(attach.inputs[1]) : 0;
    }

    instantProductCount(): number {
        const stringing = this.stringPlan();
        if (stringing) {
            return this.packCountById(stringing.strungId);
        }
        const attach = this.attachPlan();
        return attach ? Inventory.count(attach.product) : 0;
    }

    canWork(): boolean {
        const kind = this.workKind();
        return hasFletchWork({
            kind,
            logCount: this.logCount(),
            knifeCount: this.knifeCount(),
            input0: this.instantInput0Count(),
            input1: this.instantInput1Count()
        });
    }

    mustRestock(): boolean {
        const kind = this.workKind();
        return needsRestock({
            kind,
            logCount: this.logCount(),
            knifeCount: this.knifeCount(),
            input0: this.instantInput0Count(),
            input1: this.instantInput1Count()
        });
    }
}

class FletchDialog implements Task {
    constructor(private bot: BankFletcher) {}
    validate(): boolean { return this.bot.workKind() === 'knife' && ChatDialog.isMakeMenu(); }
    async execute(): Promise<void> {
        this.bot.setStatus('choosing product');
        const products = ChatDialog.makeProducts();
        const match = matchProduct(products, this.bot.productName());
        if (!match) {
            ScriptRunner.stop(`BankFletcher: '${this.bot.productName()}' isn't offered for '${this.bot.materialName()}' (menu: [${products.join(', ')}]) — refusing to make the wrong item`);
            return;
        }
        const start = this.bot.logCount();
        const count = makeBatchCount(start);
        let usedMakeX = false;
        let picked = await ChatDialog.makeX(match, count);
        if (!picked && ChatDialog.isMakeMenu()) {
            this.bot.log(`Make-X missed for *${this.bot.productName()}* — retrying`);
            picked = await ChatDialog.makeX(match, count);
        }
        if (picked) {
            usedMakeX = true;
        } else if (ChatDialog.isMakeMenu()) {
            // No Make-X / count dialog failed, fall back to largest fixed qty once.
            this.bot.log(`Make-X failed for *${this.bot.productName()}* — falling back to fixed qty`);
            picked = await ChatDialog.make(match);
        }
        if (!picked) {
            this.bot.log(`make menu open but couldn't pick *${this.bot.productName()}* — products: [${products.join(', ')}]`);
            await Execution.delayTicks(1);
            return;
        }

        // Do NOT treat "make menu still open" as production started, that thrashed Make-X
        // every tick. Wait for the menu to leave and work to begin.
        const started = await Execution.delayUntil(
            () =>
                !ChatDialog.isMakeMenu()
                && (Game.animating() || this.bot.logCount() < start || ChatDialog.canContinue()),
            5000
        );
        if (!started) {
            return;
        }

        // Why: Make-X consumes `count` logs without reopening the menu, so the batch is ridden to completion (#177).
        // Why: brief !animating gaps are not a bail-out condition, or logs are left behind.
        const floor = batchRideFloor(start, count, usedMakeX);
        let mark = this.bot.logCount();
        let idle = 0;
        for (let guard = 0; guard < 400 && this.bot.logCount() > floor; guard++) {
            if (ChatDialog.canContinue()) {
                return;
            }
            // Menu back = batch finished or interrupted, re-pick next tick if logs remain.
            if (ChatDialog.isMakeMenu()) {
                return;
            }
            await Execution.delayTicks(1);
            const now = this.bot.logCount();
            if (now < mark) {
                this.bot.recordMade(mark - now);
                mark = now;
                idle = 0;
            } else if (++idle >= BATCH_IDLE_TICKS) {
                return;
            }
        }
    }
}

class BankTrip implements Task {
    constructor(private bot: BankFletcher) {}
    validate(): boolean {
        return this.bot.mustRestock();
    }
    async execute(): Promise<void> {
        this.bot.setStatus('banking');
        const opened = (await Bank.openBooth(this.bot.bankTile(), this.bot.boothLocName(), BOOTH.op, m => this.bot.log(`  ${m}`)))
            || (await Bank.openNearest(this.bot.boothLocName(), BOOTH.op, m => this.bot.log(`  ${m}`)));
        if (!opened) {
            this.bot.log('could not open the bank — will retry');
            return;
        }
        try {
            const stringingEarly = this.bot.stringPlan();
            const stringLocked = Boolean(
                stringingEarly
                && this.bot.packCountById(stringingEarly.unstrungId) === 0
                && this.bot.packCountById(stringingEarly.stringId) > 0
                && Inventory.used() >= 27
            );
            const keep = stringLocked ? [] : this.bot.keepList();
            if (stringLocked) {
                this.bot.log('pack is only bow string — depositing to make room for unstrung');
            }
            await Bank.depositAllMatching(depositAllExcept(keep), m => this.bot.log(`  ${m}`));
            this.bot.countTrip();

            const arrived = await Execution.delayUntilTicks(
                () => Bank.loaded() || !Bank.isOpen(),
                LIST_WAIT_TICKS
            );
            const state = bankListState(Bank.isOpen(), Bank.loaded());
            if (state === 'closed') {
                this.bot.log('bank window closed — will retry');
                return;
            }

            const stringing = this.bot.stringPlan();
            if (stringing) {
                await this.withdrawStringing(stringing, !arrived);
                return;
            }

            const plan = this.bot.attachPlan();
            if (plan) {
                for (const input of plan.inputs) {
                    const pat = input.toLowerCase();
                    const bankItem = Bank.items().find(i => i.name !== null && i.name.toLowerCase().includes(pat));
                    const action = stockAction({
                        state: bankListState(Bank.isOpen(), Bank.loaded()),
                        hasItem: Boolean(bankItem?.name),
                        waitTimedOut: !arrived
                    });
                    this.bot.noteEmpty(input, action);
                    if (action === 'ok' && bankItem?.name) {
                        const bankName = bankItem.name;
                        const allOp = withdrawOp(bankItem.ops, 'all') ?? withdrawOp(bankItem.ops, 'any') ?? 'Withdraw-All';
                        this.bot.log(`withdrawing all ${bankName} ('${allOp}')`);
                        await Bank.withdraw(bankName, allOp);
                        await Execution.delayUntilTicks(
                            () => this.bot.packCount(input) > 0 || Bank.count(bankName) === 0,
                            WITHDRAW_CONFIRM_TICKS
                        );
                        continue;
                    }
                    if (action.startsWith('retry')) {
                        this.bot.log(`no '${input}' in the bank list yet (${action}) — will retry`);
                        return;
                    }
                    if (shouldStopEmpty(this.bot.emptyReadCount(input))) {
                        ScriptRunner.stop(`BankFletcher: bank is out of '${input}'`);
                    } else {
                        this.bot.log(`bank snapshot missed '${input}' (${this.bot.emptyReadCount(input)}/${EMPTY_READ_LIMIT}) — will retry`);
                    }
                    return;
                }
                return;
            }

            const logItem = Bank.items().find(i => logNameMatches(i.name, this.bot.materialName()));
            const logAction = stockAction({
                state: bankListState(Bank.isOpen(), Bank.loaded()),
                hasItem: Boolean(logItem?.name),
                waitTimedOut: !arrived
            });
            const logKey = this.bot.materialName();
            this.bot.noteEmpty(logKey, logAction);
            if (logAction !== 'ok' || !logItem?.name) {
                if (logAction.startsWith('retry')) {
                    this.bot.log(`'${logKey}' unread (${logAction}) — will retry`);
                    return;
                }
                if (shouldStopEmpty(this.bot.emptyReadCount(logKey))) {
                    ScriptRunner.stop(`BankFletcher: bank is out of '${logKey}' — fletching complete`);
                } else {
                    this.bot.log(
                        `bank snapshot missed '${logKey}' `
                        + `(${this.bot.emptyReadCount(logKey)}/${EMPTY_READ_LIMIT}) — will retry`
                    );
                }
                return;
            }
            const logName = logItem.name;

            if (this.bot.knifeCount() === 0) {
                const knifeBank = exactName(Bank.items(), this.bot.knifeName());
                const knifeAction = stockAction({
                    state: bankListState(Bank.isOpen(), Bank.loaded()),
                    hasItem: Boolean(knifeBank?.name),
                    waitTimedOut: !arrived
                });
                if (knifeAction !== 'ok' || !knifeBank?.name) {
                    if (knifeAction.startsWith('retry')) {
                        this.bot.log('knife unread in the bank list — will retry');
                        return;
                    }
                    this.bot.setStatus('error: no Knife');
                    this.bot.log('No Knife in bank or inventory.');
                    ScriptRunner.stop('BankFletcher: no Knife in bank or inventory');
                    return;
                }
                const knifeName = knifeBank.name;
                const knifeOps = knifeBank.ops.filter((o): o is string => o !== null);
                const oneOp = withdrawOp(knifeOps, '1') ?? withdrawOp(knifeOps, 'any') ?? 'Withdraw-1';
                this.bot.log(`withdrawing ${knifeName} ('${oneOp}')`);
                await Bank.withdraw(knifeName, oneOp);
                await Execution.delayUntilTicks(() => Inventory.contains(knifeName), WITHDRAW_CONFIRM_TICKS);
            }

            this.bot.log(`withdrawing ${logName}`);
            if (!(await Bank.withdrawLoad(logName))) {
                this.bot.log(`could not withdraw ${logName} — will retry`);
            }
        } finally {
            // Why: leave the bank so knife/log item-on-item can run (#484).
            // Why: multibox / renderer-off still needs the close packet, or Fletch validates but never progresses.
            if (Bank.isOpen()) {
                if (!(await Bank.close())) {
                    this.bot.log('could not close the bank after withdraw — will retry');
                }
            }
        }
    }

    private async withdrawStringing(plan: StringPlan, waitTimedOut: boolean): Promise<void> {
        const listState = () => bankListState(Bank.isOpen(), Bank.loaded());
        const stringSlots = (): number => Inventory.items().filter(i => i.id === plan.stringId).length;
        const stacked = stringIsStacked(this.bot.packCountById(plan.stringId), stringSlots());
        const load = stringWithdrawPlan(stringSlots(), stacked);
        if (load.stringExact > 0) {
            const stringItem = Bank.items().find(i => i.id === plan.stringId)
                ?? exactName(Bank.items(), BOW_STRING);
            const action = stockAction({
                state: listState(),
                hasItem: Boolean(stringItem),
                waitTimedOut
            });
            this.bot.noteEmpty(BOW_STRING, action);
            if (action === 'ok' && stringItem) {
                if (!(await withdrawExact(stringItem, load.stringExact, () => this.bot.packCountById(plan.stringId), m => this.bot.log(m)))) {
                    return;
                }
            } else if (action.startsWith('retry')) {
                this.bot.log(`no '${BOW_STRING}' in the bank list yet (${action}) — will retry`);
                return;
            } else if (shouldStopEmpty(this.bot.emptyReadCount(BOW_STRING))) {
                ScriptRunner.stop(`BankFletcher: bank is out of '${BOW_STRING}'`);
                return;
            } else {
                this.bot.log(`bank snapshot missed '${BOW_STRING}' (${this.bot.emptyReadCount(BOW_STRING)}/${EMPTY_READ_LIMIT}) — will retry`);
                return;
            }
        }

        const unstrung = Bank.items().find(i => i.id === plan.unstrungId);
        const unstrungAction = stockAction({
            state: listState(),
            hasItem: Boolean(unstrung),
            waitTimedOut
        });
        const unstrungKey = `unstrung:${plan.unstrungId}`;
        this.bot.noteEmpty(unstrungKey, unstrungAction);
        if (unstrungAction === 'ok' && unstrung) {
            if (!load.unstrungAll || Inventory.isFull()) {
                return;
            }
            const before = this.bot.packCountById(plan.unstrungId);
            if (!(await withdrawStack(unstrung, m => this.bot.log(m)))) {
                return;
            }
            await Execution.delayUntilTicks(
                () =>
                    this.bot.packCountById(plan.unstrungId) > before
                    || Inventory.isFull()
                    || !Bank.items().some(i => i.id === plan.unstrungId),
                WITHDRAW_CONFIRM_TICKS
            );
            return;
        }
        if (unstrungAction.startsWith('retry')) {
            this.bot.log(`no ${plan.displayName} (u id ${plan.unstrungId}) in the bank list yet (${unstrungAction}) — will retry`);
            return;
        }
        if (shouldStopEmpty(this.bot.emptyReadCount(unstrungKey))) {
            ScriptRunner.stop(`BankFletcher: bank is out of unstrung ${plan.displayName}`);
        } else {
            this.bot.log(
                `bank snapshot missed unstrung ${plan.displayName} `
                + `(${this.bot.emptyReadCount(unstrungKey)}/${EMPTY_READ_LIMIT}) — will retry`
            );
        }
    }
}

class Fletch implements Task {
    constructor(private bot: BankFletcher) {}
    validate(): boolean {
        return this.bot.workKind() === 'knife'
            && this.bot.logCount() > 0
            && this.bot.knifeCount() > 0
            && !ChatDialog.isOpen()
            && !Bank.isOpen();
    }
    async execute(): Promise<void> {
        for (let n = 0; n < 30 && this.bot.logCount() > 0; n++) {
            if (ChatDialog.isMakeMenu() || ChatDialog.canContinue()) { return; }
            const knife = this.bot.knifeItem();
            const log = this.bot.lastLog();
            if (!knife || !log) { await Execution.delayTicks(2); return; }
            this.bot.setStatus(`fletching ${this.bot.productName()}`);
            const before = this.bot.logCount();
            if (!(await knife.useOn(log))) { await Execution.delayTicks(1); continue; }
            await Execution.delayUntil(
                () => ChatDialog.isMakeMenu() || this.bot.logCount() < before || ChatDialog.canContinue(),
                8000
            );
            if (ChatDialog.isMakeMenu()) { return; }
        }
    }
}

class InstantAttach implements Task {
    constructor(private bot: BankFletcher) {}
    validate(): boolean {
        const kind = this.bot.workKind();
        return (kind === 'attach' || kind === 'string')
            && this.bot.instantInput0Count() > 0
            && this.bot.instantInput1Count() > 0
            && !ChatDialog.isOpen()
            && !Bank.isOpen();
    }
    async execute(): Promise<void> {
        const stringing = this.bot.stringPlan();
        const attach = this.bot.attachPlan();
        const perAction = stringing?.perAction ?? attach?.perAction ?? 1;
        this.bot.setStatus(stringing ? `stringing ${stringing.displayName}` : `attaching ${attach?.product ?? 'product'}s`);
        let noProgress = 0;
        for (let n = 0; n < 80; n++) {
            if (ChatDialog.isOpen()) { return; }
            const want = instantActionsFor(this.bot.instantInput0Count(), this.bot.instantInput1Count(), perAction);
            if (want === 0) { return; }
            const before = this.bot.instantProductCount();
            const before0 = this.bot.instantInput0Count();
            const before1 = this.bot.instantInput1Count();
            let sent = 0;
            for (let i = 0; i < want; i++) {
                const a = this.bot.instantInput0();
                const b = this.bot.instantInput1();
                if (!a || !b) { break; }
                if (await a.useOn(b)) { sent++; }
            }
            await Execution.delayTicks(1);
            const now = this.bot.instantProductCount();
            if (now > before) {
                this.bot.recordMade(now - before);
                noProgress = 0;
            } else if (this.bot.instantInput0Count() < before0 || this.bot.instantInput1Count() < before1) {
                noProgress = 0;
            } else {
                noProgress++;
                if (shouldStopNoProgress(noProgress, sent)) {
                    return;
                }
            }
        }
    }
}
