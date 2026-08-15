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
    CHISEL_ID,
    GEM_OPTIONS,
    eligibleGems,
    gemByUncutId,
    type GemDef
} from './GemCutterLogic.js';

const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };

export const GEM_CUTTER_SETTINGS: SettingsSchema = {
    gems: {
        type: 'string[]',
        default: [],
        options: GEM_OPTIONS,
        label: 'Gems to cut',
        help: 'check specific gems to restrict the run; leave all unchecked to cut every gem your Crafting level allows — the bot deposits everything from your pack into the bank each cycle, including non-gems, so start with nothing valuable carried'
    }
};

export default class GemCutter extends TaskBot {
    override loopDelay = 100;

    private eligible: GemDef[] = [];
    private deniedKeys = new Set<string>();
    private confirmedEmpty = new Set<string>(); // gems confirmed empty in bank
    private plannedLevel = -1;
    private trips = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;
    private refused = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(
            () => Game.ingame() && Game.tile() !== null && Skills.level('crafting') > 0,
            8000
        );
        this.refreshEligible();

        if (this.eligible.length === 0) {
            this.log(`No gems to cut — Crafting ${Skills.level('crafting')} with no selectable gem at or above level. Stopping.`);
            ScriptRunner.stop('no selectable gems at the player\'s Crafting level');
            return;
        }

        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('crafting');

        this.on('chat.message', e => {
            if (e.text.includes('You need a Crafting level of') && e.text.includes('to cut')) {
                this.refused = true;
            }
        });

        this.log(`GemCutter — cut ${this.eligible.map(g => g.name).join(', ')} (Crafting ${Skills.level('crafting')})`);
        this.add(
            new Cut(this),
            new BankTrip(this)
        );
    }

    override async loop(): Promise<number | void> {
        const level = Skills.level('crafting');
        if (level !== this.plannedLevel) {
            this.plannedLevel = level;
            this.refreshEligible();
        }
        // Stop if all eligible gems are confirmed empty in bank
        const remaining = this.eligible.filter(g => !this.confirmedEmpty.has(g.key));
        if (remaining.length === 0) {
            this.log('All selected gems confirmed empty in bank — stopping');
            ScriptRunner.stop('all gems confirmed empty in bank');
            return;
        }
        return super.loop();
    }

    private refreshEligible(): void {
        this.eligible = eligibleGems(
            Skills.level('crafting'),
            this.settings.list('gems', [])
        ).filter(g => !this.deniedKeys.has(g.key));
    }

    setStatus(s: string): void {
        this.status = s;
    }
    targets(): GemDef[] {
        return this.eligible.filter(g => !this.confirmedEmpty.has(g.key));
    }
    countTrip(): void {
        this.trips++;
    }
    deny(gem: GemDef): void {
        this.deniedKeys.add(gem.key);
        this.eligible = this.eligible.filter(g => g.key !== gem.key);
        this.log(`Crafting ${gem.level} required for ${gem.name} — skipping it`);
        if (this.eligible.length === 0) {
            this.log('no cuttable gems remain — stopping');
            ScriptRunner.stop('no cuttable gems remain');
        }
    }
    takeRefusal(): boolean {
        const r = this.refused;
        this.refused = false;
        return r;
    }
    markEmpty(gem: GemDef): void {
        this.confirmedEmpty.add(gem.key);
        this.log(`${gem.name} confirmed empty in bank — skipping on future trips`);
    }
    /** The first eligible uncut gem in the pack, lowest level first. */
    peekCuttable(): { item: InvItem; gem: GemDef } | null {
        for (const gem of this.eligible) {
            for (const item of Inventory.items()) {
                if (item.id === gem.uncutId) {
                    return { item, gem };
                }
            }
        }
        return null;
    }
    /** How many eligible uncut gems sit in the pack. */
    countEligibleUncuts(): number {
        return Inventory.items().filter(i => gemByUncutId(i.id) !== null && this.eligible.some(g => g.uncutId === i.id)).length;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#8a6de9' });
        p.title(`GemCutter — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        const xpGained = Skills.xp('crafting') - this.xpAtStart;
        p.row(`Runtime: ${fmtDuration(mins)}`, `XP gained: ${xpGained.toLocaleString()}`, `Trips: ${this.trips}`);
        p.row(`Crafting: ${Skills.level('crafting')}`, `Pack: ${Inventory.used()}`, `XP/hr: ${this.xpPerHour()}`);
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
        const xp = Skills.xp('crafting') - this.xpAtStart;
        return `${((xp / mins) * 60 / 1000).toFixed(1)}k`;
    }
}

class Cut implements Task {
    constructor(private bot: GemCutter) {}

    validate(): boolean {
        if (Bank.isOpen()) {
            return false;
        }
        // Need both chisel and uncut gems
        const chisel = Inventory.items().find(i => i.id === CHISEL_ID);
        return chisel !== null && this.bot.peekCuttable() !== null;
    }

    async execute(): Promise<void> {
        const chisel = Inventory.items().find(i => i.id === CHISEL_ID);
        if (!chisel) {
            return;
        }

        // Find the LAST uncut gem in inventory (highest slot index)
        // Clicking the last slot lets the game process from the end of the stack
        let targetItem: InvItem | null = null;
        let targetGem: GemDef | null = null;
        for (const gem of this.bot.targets()) {
            const items = Inventory.items().filter(i => i.id === gem.uncutId);
            if (items.length > 0) {
                targetItem = items[items.length - 1]; // last slot
                targetGem = gem;
                break;
            }
        }

        if (!targetItem || !targetGem) {
            return;
        }

        this.bot.setStatus(`cutting ${targetGem.name}s`);

        // Spam click the chisel on the LAST uncut gem repeatedly
        // Clicking the last slot lets the game process from the end of the stack
        const startXp = Skills.xp('crafting');
        const maxSpam = 60; // safety cap

        for (let i = 0; i < maxSpam; i++) {
            if (Inventory.countById(targetGem.uncutId) === 0) break;
            if (Inventory.countById(CHISEL_ID) === 0) break; // chisel broke
            chisel.useOn(targetItem); // fire and forget - true spam
        }

        // Settle: wait for xp to increase
        await Execution.delayUntil(
            () => Skills.xp('crafting') > startXp,
            3000
        );

        if (this.bot.takeRefusal()) {
            this.bot.deny(targetGem);
        }
        await Execution.delayTicks(1);
    }
}

class BankTrip implements Task {
    constructor(private bot: GemCutter) {}

    validate(): boolean {
        return this.bot.countEligibleUncuts() === 0;
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

        // 1. Deposit everything EXCEPT chisel
        this.bot.log('depositing inventory (keeping chisel)');
        await Bank.depositAllMatching((_name, id) => id !== CHISEL_ID);
        await Execution.delayTicks(1);

        // 2. Ensure we have a chisel
        if (Inventory.countById(CHISEL_ID) === 0) {
            this.bot.log('withdrawing chisel');
            if (!(await Bank.withdrawXById(CHISEL_ID, 1))) {
                this.bot.log('no chisel in bank — stopping');
                ScriptRunner.stop('no chisel in bank');
                return;
            }
            this.bot.log('got chisel');
        }

        // 3. Withdraw gems
        let withdrew = 0;
        let deposited = 0;
        const startMs = Date.now();
        const maxBankTime = 15_000;

        while (Date.now() - startMs < maxBankTime) {
            let gotAny = false;
            for (const gem of this.bot.targets()) {
                if (Inventory.isFull()) {
                    this.bot.log(`pack full, need to deposit before withdrawing ${gem.name}`);
                    break;
                }
                const want = Inventory.free();
                if (want <= 0) break;
                const before = Inventory.countById(gem.uncutId);
                this.bot.log(`trying to withdraw ${want} ${gem.name} (have ${before})`);
                if (await Bank.withdrawXById(gem.uncutId, want)) {
                    const got = Inventory.countById(gem.uncutId) - before;
                    withdrew += got;
                    gotAny = true;
                    this.bot.log(`withdrew ${got} ${gem.name}`);
                } else {
                    this.bot.log(`withdraw ${gem.name} failed — marking empty in bank`);
                    this.bot.markEmpty(gem);
                }
            }

            if (gotAny) {
                this.bot.log('got gems, closing bank');
                break;
            }

            if (Inventory.isFull()) {
                this.bot.log('pack full, depositing everything (keeping chisel)');
                const beforeDeposit = Inventory.used();
                await Bank.depositAllMatching((_name, id) => id !== CHISEL_ID);
                deposited = Math.max(deposited, beforeDeposit - Inventory.used());
                this.bot.log(`deposited ${deposited} items`);
                continue;
            }

            await Execution.delayTicks(1);
        }

        if (!(await Bank.close())) {
            this.bot.log('bank would not close — retrying the trip');
            return;
        }

        if (withdrew > 0 || deposited > 0) {
            this.bot.countTrip();
            this.bot.log(`banked @ ${bank.name}: gave ${deposited} items, took ${withdrew} uncut gems`);
        } else {
            this.bot.log('nothing to deposit and the bank has no eligible gems — stopping');
            ScriptRunner.stop('bank has no eligible gems');
        }
    }
}