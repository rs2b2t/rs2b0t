import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { Inventory, type InvItem } from '../api/hud/Inventory.js';
import { Bank } from '../api/hud/Bank.js';
import { Skills } from '../api/hud/Skills.js';
import { Paint } from '../api/hud/Paint.js';
import { Traversal } from '../api/Traversal.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { nearestBank } from '../api/BankLocations.js';
import { fmtDuration } from '../api/hud/paintLogic.js';
import {
    CANNOT_IDENTIFY,
    HERB_OPTIONS,
    IDENTIFY_OP,
    eligibleHerbs,
    herbByUnidId,
    type HerbDef
} from './HerbCleanerLogic.js';

export const HERB_CLEANER_SETTINGS: SettingsSchema = {
    herbs: {
        type: 'string[]',
        default: [],
        options: HERB_OPTIONS,
        label: 'Herbs to clean',
        help: 'pick the herbs to identify; leave all unchecked to clean every herb your Herblore level allows'
    }
};

export default class HerbCleaner extends TaskBot {
    override loopDelay = 100;

    private eligible: HerbDef[] = [];
    private cleaned = 0;
    private trips = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;
    private refused = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.eligible = eligibleHerbs(
            Skills.level('herblore'),
            this.settings.list('herbs', [])
        );

        if (this.eligible.length === 0) {
            this.log(`No herbs to clean — Herblore ${Skills.level('herblore')} with no selectable herb above or at level. Stopping.`);
            ScriptRunner.stop();
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
        this.eligible = this.eligible.filter(h => h !== herb);
        this.log(`Herblore ${herb.level} required for ${herb.name} — skipping it.`);
        if (this.eligible.length === 0) {
            this.log('no cleanable herbs remain — stopping');
            ScriptRunner.stop();
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
        // Spam-click every eligible unid in one pass — interact() only fires the
        // driver op (no wait), so per-item delay is skipped. The identifying is
        // gated by a single settle on the clean-id count / herblore xp.
        const beforeClean = this.bot.cleanCount();
        const beforeXp = Skills.xp('herblore');
        let clicked = 0;
        for (const herb of this.bot.targets()) {
            for (const item of Inventory.items()) {
                if (item.id === herb.unidId) {
                    await item.interact(IDENTIFY_OP);
                    clicked++;
                }
            }
        }

        if (clicked === 0) {
            return;
        }

        this.bot.setStatus(`identifying ${clicked} grimy herb${clicked === 1 ? '' : 's'}`);
        const ok = await Execution.delayUntil(
            () => this.bot.cleanCount() > beforeClean || Skills.xp('herblore') > beforeXp,
            3000
        );
        if (ok) {
            this.bot.countClean(this.bot.cleanCount() - beforeClean);
        } else if (this.bot.takeRefusal()) {
            // Level gate normally prevents this — drop anything unexpected.
            for (const herb of [...this.bot.targets()]) {
                if (herb.level > Skills.level('herblore')) {
                    this.bot.deny(herb);
                }
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
        const near = here !== null && bank.tile.distanceTo(here) <= 4;
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

        if (!(await Bank.openNearest('Bank booth', 'Use-quickly', m => this.bot.log(`  ${m}`)))
            && !(await Bank.openNearest('Bank booth', 'Bank', m => this.bot.log(`  ${m}`)))) {
            this.bot.log('could not open the bank — retrying');
            return;
        }

        const beforeDeposit = Inventory.used();
        await Bank.depositAllMatching(() => true);
        const deposited = beforeDeposit - Inventory.used();

        let withdrew = 0;
        for (const herb of this.bot.targets()) {
            if (Inventory.isFull()) {
                break;
            }
            const want = Inventory.free();
            if (want <= 0) {
                break;
            }
            const before = Inventory.countById(herb.unidId);
            if (await Bank.withdrawXById(herb.unidId, want)) {
                withdrew += Inventory.countById(herb.unidId) - before;
            }
        }

        await Bank.close();

        if (withdrew > 0 || deposited > 0) {
            this.bot.countTrip();
            this.bot.log(`banked @ ${bank.name}: gave ${deposited} items, took ${withdrew} grimy herbs`);
        } else {
            this.bot.log('nothing to deposit and the bank has no eligible herbs — stopping');
            ScriptRunner.stop();
        }
    }
}