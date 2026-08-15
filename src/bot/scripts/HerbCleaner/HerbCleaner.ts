import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory, type InvItem } from '../../api/inventory/Inventory.js';
import { Bank } from '../../api/bank/Bank.js';
import { Skills } from '../../api/skills/Skills.js';
import { Paint } from '../../paint/Paint.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { nearestBank } from '../../api/bank/BankLocations.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import {
    CANNOT_IDENTIFY,
    HERB_OPTIONS,
    IDENTIFY_OP,
    eligibleHerbs,
    herbByUnidId,
    type HerbDef
} from './HerbCleanerLogic.js';

const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };

export const HERB_CLEANER_SETTINGS: SettingsSchema = {
    herbs: {
        type: 'string[]',
        default: [],
        options: HERB_OPTIONS,
        label: 'Herbs to clean',
        help: 'check specific herbs to restrict the run; leave all unchecked to clean every herb your Herblore level allows — the bot deposits everything from your pack into the bank each cycle, including non-herbs, so start with nothing valuable carried'
    }
};

export default class HerbCleaner extends TaskBot {
    override loopDelay = 100;

    private eligible: HerbDef[] = [];
    private deniedKeys = new Set<string>();
    private plannedLevel = -1;
    private cleaned = 0;
    private trips = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;
    private refused = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(
            () => Game.ingame() && Game.tile() !== null && Skills.level('herblore') > 0,
            8000
        );
        this.refreshEligible();

        if (this.eligible.length === 0) {
            this.log(`No herbs to clean — Herblore ${Skills.level('herblore')} with no selectable herb at or above level. Stopping.`);
            ScriptRunner.stop('no selectable herbs at the player\'s Herblore level');
            return;
        }

        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('herblore');

        this.on('chat.message', e => {
            if (CANNOT_IDENTIFY.test(e.text)) {
                this.refused = true;
            }
        });

        this.log(`HerbCleaner — clean ${this.eligible.map(h => h.name).join(', ')} (Herblore ${Skills.level('herblore')})`);
        this.add(
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
        return this.eligible;
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
            ScriptRunner.stop('no cleanable herbs remain');
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
            // Why: the engine refused every click made — level drift in the table, or a non-members world.
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
        return this.bot.countEligibleUnids() === 0;
    }

    async execute(): Promise<void> {
        const here = Game.tile();
        const bank = here ? nearestBank(here) : null;
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
        if (!(await Bank.openNearestAccess(access, m => this.bot.log(`  ${m}`)))) {
            this.bot.log('could not open the bank — retrying');
            return;
        }

        this.bot.log('bank opened, starting withdraw/deposit cycle');

        // Why: withdrawXById returns false when bankBackpackReady fails, so the withdraw can start without waiting on Bank.loaded() and retry next tick.
        // Why: depositing only happens when the pack is full and no withdraw landed.
        let withdrew = 0;
        let deposited = 0;
        const startMs = Date.now();
        const maxBankTime = 15_000;

        while (Date.now() - startMs < maxBankTime) {
            // Try to withdraw herbs first — this fails quickly if bank not loaded.
            let gotAny = false;
            for (const herb of this.bot.targets()) {
                if (Inventory.isFull()) {
                    this.bot.log(`pack full, need to deposit before withdrawing ${herb.name}`);
                    break;
                }
                const want = Inventory.free();
                if (want <= 0) break;
                const before = Inventory.countById(herb.unidId);
                this.bot.log(`trying to withdraw ${want} ${herb.name} (have ${before})`);
                if (await Bank.withdrawXById(herb.unidId, want)) {
                    const got = Inventory.countById(herb.unidId) - before;
                    withdrew += got;
                    gotAny = true;
                    this.bot.log(`withdrew ${got} ${herb.name}`);
                } else {
                    this.bot.log(`withdraw ${herb.name} failed (bank not ready or empty)`);
                }
            }

            // If we got herbs, we're done banking — no need to deposit clean herbs
            // this cycle (they'll be deposited next trip if needed).
            if (gotAny) {
                this.bot.log('got herbs, closing bank');
                break;
            }

            // No herbs withdrawn. Maybe pack is full (no room to withdraw)?
            // Deposit to make space, then retry.
            if (Inventory.isFull()) {
                this.bot.log('pack full, depositing everything');
                const beforeDeposit = Inventory.used();
                await Bank.depositAllMatching(() => true);
                deposited = Math.max(deposited, beforeDeposit - Inventory.used());
                this.bot.log(`deposited ${deposited} items`);
                // After depositing, loop will retry withdraw immediately.
                continue;
            }

            // Bank might still be loading. Wait a tick and retry.
            await Execution.delayTicks(1);
        }

        if (!(await Bank.close())) {
            this.bot.log('bank would not close — retrying the trip');
            return;
        }

        if (withdrew > 0 || deposited > 0) {
            this.bot.countTrip();
            this.bot.log(`banked @ ${bank.name}: gave ${deposited} items, took ${withdrew} grimy herbs`);
        } else {
            this.bot.log('nothing to deposit and the bank has no eligible herbs — stopping');
            ScriptRunner.stop('bank has no eligible herbs');
        }
    }
}