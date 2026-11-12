import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Game } from '../../api/game/Game.js';
import { Inventory, type InvItem } from '../../api/inventory/Inventory.js';
import { Bank } from '../../api/bank/Bank.js';
import { openBankAccess } from '../../api/bank/Banking.js';
import { Skills } from '../../api/skills/Skills.js';
import { Paint } from '../../paint/Paint.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { nearestBankReachable } from '../../api/bank/BankLocations.js';
import { Navigator } from '../../event/webwalk/Navigator.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { actions, reader } from '../../adapter/ClientAdapter.js';
import { Input } from '../../input/Input.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import {
    CANNOT_IDENTIFY,
    HERB_OPTIONS,
    IDENTIFY_OP,
    eligibleHerbs,
    herbByUnidId,
    opIndex,
    type HerbDef
} from './HerbCleanerLogic.js';

const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };

/** Why: long loops must yield to the random-event guardian or its interaction gets raced; ContinueDialog handles ordinary dialogs. */
function mustYield(): boolean {
    return EventSignal.pending() || ChatDialog.isOpen() || ChatDialog.canContinue();
}

export const HERB_CLEANER_SETTINGS: SettingsSchema = {
    herbs: {
        type: 'string[]',
        default: [],
        options: HERB_OPTIONS,
        label: 'Herbs to clean',
        help: 'check specific herbs to restrict the run; leave all unchecked to clean every herb your Herblore level allows — the bot deposits everything from your pack into the bank each cycle, including non-herbs, so start with nothing valuable carried'
    },
    fastBank: {
        type: 'boolean',
        default: true,
        label: 'Instant bank leg',
        help: 'deposit the pack, withdraw a full load of grimy herbs and close in one bank pass; a miss falls back to the confirmed route for that trip'
    }
};

export default class HerbCleaner extends TaskBot {
    override loopDelay = 100;

    private eligible: HerbDef[] = [];
    private deniedKeys = new Set<string>();
    private confirmedEmpty = new Set<string>();
    private plannedLevel = -1;
    private cleaned = 0;
    private trips = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;
    private refused = false;
    private fastBank = true;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(
            () => Game.ingame() && Game.tile() !== null && Skills.level('herblore') > 0,
            8000
        );
        this.refreshEligible();

        if (this.eligible.length === 0) {
            this.log(`No herbs to clean — Herblore ${Skills.level('herblore')} with no selectable herb at or above level. Stopping.`);
            this.requestFinish('no selectable herbs at the player\'s Herblore level');
            return;
        }

        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('herblore');
        this.fastBank = this.settings.bool('fastBank', true);

        this.on('chat.message', e => {
            if (CANNOT_IDENTIFY.test(e.text)) {
                this.refused = true;
            }
        });

        this.log(`HerbCleaner — clean ${this.eligible.map(h => h.name).join(', ')} (Herblore ${Skills.level('herblore')})`);
        this.add(
            new ContinueDialog(),
            new Clean(this),
            new BankTrip(this)
        );
    }

    override async loop(): Promise<number | void> {
        // The eligible set follows a level-up mid-run instead of being frozen at start.
        const level = Skills.level('herblore');
        if (level !== this.plannedLevel) {
            this.plannedLevel = level;
            this.refreshEligible();
        }
        // Why: a withdraw that fails against a loaded bank means that herb is gone, so once every eligible herb is marked the trips have nothing left to fetch.
        if (this.targets().length === 0 && !Bank.isOpen()) {
            this.log('every selected herb is empty in the bank, stopping');
            this.requestFinish('every selected herb is empty in the bank');
            return;
        }
        return super.loop();
    }

    private refreshEligible(): void {
        this.eligible = eligibleHerbs(
            Skills.level('herblore'),
            this.settings.list('herbs', [])
        ).filter(h => !this.deniedKeys.has(h.key));
    }

    setStatus(s: string): void {
        this.status = s;
    }
    targets(): HerbDef[] {
        return this.eligible.filter(h => !this.confirmedEmpty.has(h.key));
    }
    markEmpty(herb: HerbDef): void {
        this.confirmedEmpty.add(herb.key);
        this.log(`${herb.name} is empty in the bank, skipping it on later trips`);
    }
    countClean(n = 1): void {
        this.cleaned += n;
    }
    countTrip(): void {
        this.trips++;
    }
    /** Total eligible cleaned herbs currently held. */
    cleanCount(): number {
        return Inventory.items().filter(i => this.eligible.some(h => h.id === i.id)).length;
    }
    deny(herb: HerbDef): void {
        this.deniedKeys.add(herb.key);
        this.eligible = this.eligible.filter(h => h.key !== herb.key);
        this.log(`Herb ${herb.level} required for ${herb.name} — skipping it`);
        if (this.eligible.length === 0) {
            this.log('no cleanable herbs remain — stopping');
            this.requestFinish('no cleanable herbs remain');
        }
    }
    takeRefusal(): boolean {
        const r = this.refused;
        this.refused = false;
        return r;
    }
    /** The first eligible unidentified herb in the pack, lowest level first. */
    peekCleanable(): { item: InvItem; herb: HerbDef } | null {
        for (const herb of this.eligible) {
            for (const item of Inventory.items()) {
                if (item.id === herb.unidId) {
                    return { item, herb };
                }
            }
        }
        return null;
    }
    /** How many eligible unidentified items sit in the pack. */
    countEligibleUnids(): number {
        return Inventory.items().filter(i => herbByUnidId(i.id) !== null && this.eligible.some(h => h.unidId === i.id)).length;
    }

    /** Why: bank requests are handled in send order, so deposit-all, the Withdraw-Alls and close can all go without a wait. */
    async fastBankTrip(): Promise<boolean> {
        if (!this.fastBank) {
            return false;
        }
        const side = reader.bankSideItems();
        if (side.length === 0) {
            return false;
        }
        // Why: unidentified herbs are separate count-1 rows, and one Deposit-All takes every copy of that id, so send one click per item id rather than per row.
        const deposits = new Map<number, { id: number; slot: number; comId: number; op: number }>();
        for (const item of side) {
            const op = opIndex(item.ops, /deposit[\s-]*all/i);
            if (op === -1) {
                return false;
            }
            if (!deposits.has(item.id)) {
                deposits.set(item.id, { id: item.id, slot: item.slot, comId: item.comId, op });
            }
        }
        // Why: an absent herb is only proof once the bank list has settled; deciding off a loading list would mark a stocked herb empty.
        const bank = Bank.items();
        const draws: { id: number; slot: number; comId: number; op: number; herb: HerbDef }[] = [];
        for (const herb of this.targets()) {
            const item = bank.find(i => i.id === herb.unidId && i.count > 0);
            if (!item) {
                if (Bank.ready()) {
                    this.markEmpty(herb);
                }
                continue;
            }
            const op = opIndex(item.ops, /withdraw[\s-]*all/i);
            if (op === -1) {
                return false;
            }
            draws.push({ id: item.id, slot: item.slot, comId: item.comId, op, herb });
        }
        if (draws.length === 0) {
            return false;
        }

        const beforeUsed = Inventory.used();
        for (const deposit of deposits.values()) {
            Input.invButton(deposit.id, deposit.slot, deposit.comId, deposit.op);
        }
        for (const draw of draws) {
            Input.invButton(draw.id, draw.slot, draw.comId, draw.op);
        }
        actions.closeModal();

        if (!(await Execution.delayUntil(() => this.countEligibleUnids() > 0, 1500))) {
            this.log('instant bank missed: the withdrawal did not land — using the confirmed route');
            return false;
        }
        if (Bank.isOpen()) {
            await Execution.delayUntil(() => !Bank.isOpen(), 1000);
            if (Bank.isOpen()) {
                await Bank.close();
            }
        }

        const withdrew = this.countEligibleUnids();
        const herbs = [...new Set(draws.map(d => d.herb.name))].join(', ');
        this.log(`instant bank: banked ${beforeUsed - (Inventory.used() - withdrew)} items, took ${withdrew} grimy (${herbs})`);
        return true;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#6bbf4a' });
        p.title(`HerbCleaner — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        p.row(`Runtime: ${fmtDuration(mins)}`, `Cleaned: ${this.cleaned}`, `Trips: ${this.trips}`);
        p.row(`Herblore: ${Skills.level('herblore')}`, `Pack: ${Inventory.used()}`, `XP/hr: ${this.xpPerHour()}`);
        p.bar('Pack', Inventory.used() / 28);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }

    private xpPerHour(): string {
        const mins = (Date.now() - this.startedAt) / 60_000;
        if (mins < 0.5) {
            return '—';
        }
        const xp = Skills.xp('herblore') - this.xpAtStart;
        return `${((xp / mins) * 60 / 1000).toFixed(1)}k`;
    }
}

class Clean implements Task {
    constructor(private bot: HerbCleaner) {}

    validate(): boolean {
        if (Bank.isOpen()) {
            return false;
        }
        return this.bot.peekCleanable() !== null;
    }

    async execute(): Promise<void> {
        if (mustYield()) {
            return;
        }
        // Why: interact() fires the driver op with no wait, so every eligible unid is clicked in one pass without a per-item delay.
        // Why: the identifying is gated by a single settle on the clean-id count and herblore xp.
        const beforeClean = this.bot.cleanCount();
        const beforeXp = Skills.xp('herblore');
        const clickedHerbs: HerbDef[] = [];
        for (const herb of this.bot.targets()) {
            for (const item of Inventory.items()) {
                if (item.id === herb.unidId) {
                    await item.interact(IDENTIFY_OP);
                    clickedHerbs.push(herb);
                }
            }
        }

        if (clickedHerbs.length === 0) {
            return;
        }

        this.bot.setStatus(`identifying ${clickedHerbs.length} grimy herb${clickedHerbs.length === 1 ? '' : 's'}`);
        const ok = await Execution.delayUntil(
            () => this.bot.cleanCount() > beforeClean || Skills.xp('herblore') > beforeXp,
            3000
        );
        if (ok) {
            this.bot.countClean(this.bot.cleanCount() - beforeClean);
        } else if (this.bot.takeRefusal()) {
            // Why: the engine refused every click made, level drift in the table, or a non-members world.
            // Why: the herbs clicked are denied, not a re-derived level guess.
            for (const herb of clickedHerbs) {
                this.bot.deny(herb);
            }
        }
        await Execution.delayTicks(1);
    }
}

class BankTrip implements Task {
    constructor(private bot: HerbCleaner) {}

    validate(): boolean {
        return !mustYield() && (Bank.isOpen() || this.bot.countEligibleUnids() === 0);
    }

    async execute(): Promise<void> {
        if (this.bot.countEligibleUnids() > 0) {
            await Bank.close();
            return;
        }
        if (mustYield()) {
            this.bot.log('pausing for a random event');
            return;
        }

        const here = Game.tile();
        const bank = here ? await nearestBankReachable(here, Navigator) : null;
        if (!bank) {
            this.bot.log('no reachable bank');
            return;
        }

        this.bot.setStatus(`banking at ${bank.name}`);
        const near = here !== null && bank.tile.level === here.level && bank.tile.distanceTo(here) <= 4;
        if (!near) {
            if (!(await Traversal.walkResilient(bank.tile, {
                radius: 3,
                attempts: 4,
                timeoutMs: 180_000,
                log: m => this.bot.log(`  ${m}`)
            }))) {
                this.bot.log('walk to the bank failed — retrying');
                return;
            }
        }

        const access = bank.access ?? BOOTH;
        const log = (m: string) => this.bot.log(`  ${m}`);
        if (!(await openBankAccess(bank, access, log))) {
            this.bot.log('could not open the bank — retrying');
            return;
        }

        if (!(await Bank.waitReady()) || !(await Bank.backpackReady())) {
            this.bot.log('bank contents are still loading, retrying');
            return;
        }

        // Why: on a trip that emptied the pack there is nothing to coordinate, so the whole leg goes out in one send-order pass before any wait.
        if (await this.bot.fastBankTrip()) {
            this.bot.countTrip();
            this.bot.log(`banked @ ${bank.name} (instant)`);
            return;
        }
        if (mustYield()) {
            this.bot.log('pausing for a random event');
            return;
        }
        // Why: a missed instant pass may have closed the bank, so the confirmed route needs it open again.
        if (!Bank.isOpen() && !(await openBankAccess(bank, access, log))) {
            this.bot.log('could not reopen the bank — retrying');
            return;
        }

        const beforeDeposit = Inventory.used();
        await Bank.depositAllMatching(() => true);
        const deposited = beforeDeposit - Inventory.used();
        if (Inventory.used() > 0) {
            this.bot.log('items remain after depositing, retrying');
            return;
        }

        let withdrew = 0;
        for (const herb of this.bot.targets()) {
            if (Inventory.isFull()) {
                break;
            }
            if (Bank.ready() && !Bank.items().some(i => i.id === herb.unidId && i.count > 0)) {
                this.bot.markEmpty(herb);
                continue;
            }
            const before = Inventory.countById(herb.unidId);
            if (!(await Bank.withdrawLoad(herb.unidId))) {
                this.bot.log(`withdraw ${herb.name} did not complete, retrying`);
                return;
            }
            withdrew += Inventory.countById(herb.unidId) - before;
        }

        if (!(await Bank.close())) {
            this.bot.log('bank would not close — retrying the trip');
            return;
        }

        if (withdrew > 0 || deposited > 0) {
            this.bot.countTrip();
            this.bot.log(`banked @ ${bank.name}: gave ${deposited} items, took ${withdrew} grimy herbs`);
        } else if (this.bot.targets().length === 0) {
            this.bot.log('nothing to deposit and the bank has no eligible herbs — stopping');
            this.bot.requestFinish('bank has no eligible herbs');
        }
    }
}
