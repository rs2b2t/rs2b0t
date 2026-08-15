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
    BATCH,
    CUSTOM,
    HERB_OPTIONS,
    SECONDARY_OPTIONS,
    VIAL_OF_WATER_ID,
    herbByName,
    secondaryByName,
    type HerbDef,
    type SecondaryDef
} from './PotionMakerLogic.js';

const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };

export const POTION_MAKER_SETTINGS: SettingsSchema = {
    herb: {
        type: 'string',
        default: CUSTOM,
        options: [...HERB_OPTIONS, CUSTOM],
        label: 'Herb',
        help: 'Which herb to turn into unfinished potions. Choose Custom to reveal a free-text field.'
    },
    herbCustom: {
        type: 'string',
        default: 'Guam leaf',
        label: 'Custom herb',
        showIf: { key: 'herb', anyOf: [CUSTOM] },
        help: 'Shown when Herb is Custom — a clean herb name like "guam leaf" or "ranarr".'
    },
    secondary: {
        type: 'string',
        default: CUSTOM,
        options: [...SECONDARY_OPTIONS, CUSTOM],
        label: 'Secondary',
        help: 'Which secondary to finish the potions with. Choose Custom to reveal a free-text field.'
    },
    secondaryCustom: {
        type: 'string',
        default: 'Eye of newt',
        label: 'Custom secondary',
        showIf: { key: 'secondary', anyOf: [CUSTOM] },
        help: 'Shown when Secondary is Custom — a secondary name like "eye of newt" or "snape".'
    }
};

export default class PotionMaker extends TaskBot {
    override loopDelay = 100;

    private herb: HerbDef | null = null;
    private secondary: SecondaryDef | null = null;

    herbDef(): HerbDef | null {
        return this.herb;
    }
    secondaryDef(): SecondaryDef | null {
        return this.secondary;
    }
    private batches = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(
            () => Game.ingame() && Game.tile() !== null && Skills.level('herblore') > 0,
            8000
        );

        const herbChoice = this.settings.str('herb', CUSTOM);
        const herbRaw = herbChoice === CUSTOM ? this.settings.str('herbCustom', '') : herbChoice;
        this.herb = herbByName(herbRaw);
        if (!this.herb) {
            this.log(`Unknown herb "${herbRaw}" — stopping`);
            ScriptRunner.stop('unknown herb');
            return;
        }

        const secondaryChoice = this.settings.str('secondary', CUSTOM);
        const secondaryRaw = secondaryChoice === CUSTOM ? this.settings.str('secondaryCustom', '') : secondaryChoice;
        this.secondary = secondaryByName(secondaryRaw);
        if (!this.secondary) {
            this.log(`Unknown secondary "${secondaryRaw}" — stopping`);
            ScriptRunner.stop('unknown secondary');
            return;
        }

        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('herblore');

        this.log(`PotionMaker — ${this.herb.name} + ${this.secondary.name} at the nearest bank`);
        this.add(
            new RestockIngredients(this),
            new MakeUnfinished(this),
            new FinishPotions(this)
        );
    }

    setStatus(s: string): void {
        this.status = s;
    }
    countBatch(): void {
        this.batches++;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#6aa84f' });
        p.title(`PotionMaker — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        const xpGained = Skills.xp('herblore') - this.xpAtStart;
        p.row(`Runtime: ${fmtDuration(mins)}`, `XP gained: ${xpGained.toLocaleString()}`, `Batches: ${this.batches}`);
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

// Why: it runs only when the pack holds neither herbs nor unfinished potions, so it never interrupts the middle of a make.

/** First leg: withdraws the water and herb halves of a batch into an empty pack, then closes the bank. */
class RestockIngredients implements Task {
    constructor(private bot: PotionMaker) {}

    validate(): boolean {
        const herb = this.bot.herbDef();
        if (!herb) {
            return false;
        }
        return Inventory.countById(herb.id) === 0 && Inventory.countById(herb.unfId) === 0;
    }

    async execute(): Promise<void> {
        const herb = this.bot.herbDef();
        if (!herb) {
            return;
        }

        if (!Bank.isOpen()) {
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
        }

        if (Inventory.used() > 0) {
            this.bot.log('bank open, depositing inventory');
            await Bank.depositAllMatching(() => true);
            await Execution.delayTicks(1);
        }

        if (!(await Bank.withdrawXById(VIAL_OF_WATER_ID, BATCH))) {
            this.bot.log('no vials of water in the bank — stopping');
            ScriptRunner.stop('no vials of water in the bank');
            return;
        }
        if (!(await Bank.withdrawXById(herb.id, BATCH))) {
            this.bot.log(`no ${herb.name} in the bank — stopping`);
            ScriptRunner.stop(`no ${herb.name} in the bank`);
            return;
        }

        if (!(await Bank.close())) {
            this.bot.log('bank would not close — retrying the trip');
            return;
        }

        this.bot.countBatch();
        this.bot.log(`withdrew ${Inventory.countById(VIAL_OF_WATER_ID)} vials of water + ${Inventory.countById(herb.id)} ${herb.name}`);
    }
}

// Why: clicking the last slots lets the game drain the stacks from the end, the same way GemCutter's cut spam does.

/** Second leg: spam-uses the last herb on the last vial of water to turn the batch into unfinished potions. */
class MakeUnfinished implements Task {
    constructor(private bot: PotionMaker) {}

    validate(): boolean {
        const herb = this.bot.herbDef();
        if (Bank.isOpen() || !herb) {
            return false;
        }
        return Inventory.countById(herb.id) > 0 && Inventory.countById(VIAL_OF_WATER_ID) > 0;
    }

    async execute(): Promise<void> {
        const herb = this.bot.herbDef();
        if (!herb) {
            return;
        }
        this.bot.setStatus(`making ${herb.name} unfinished potions`);

        const herbItem = this.lastItem(herb.id);
        const vialItem = this.lastItem(VIAL_OF_WATER_ID);
        if (!herbItem || !vialItem) {
            return;
        }

        const startXp = Skills.xp('herblore');
        const maxSpam = BATCH * 4; // safety cap

        for (let i = 0; i < maxSpam; i++) {
            if (Inventory.countById(herb.id) === 0) break;
            if (Inventory.countById(VIAL_OF_WATER_ID) === 0) break;
            herbItem.useOn(vialItem); // fire and forget - true spam
        }

        // Settle: wait for the batch to convert into unfinished potions (xp tick).
        await Execution.delayUntil(
            () => Inventory.countById(herb.id) === 0 || Skills.xp('herblore') > startXp,
            8000
        );

        await Execution.delayTicks(1);
    }

    private lastItem(id: number): InvItem | null {
        const items = Inventory.items().filter(i => i.id === id);
        return items.length === 0 ? null : items[items.length - 1];
    }
}

/** Third leg: withdraws the secondary, spam-uses it on the unfinished potions, then deposits the finished batch. */
class FinishPotions implements Task {
    constructor(private bot: PotionMaker) {}

    validate(): boolean {
        if (Bank.isOpen() || !this.bot.herbDef() || !this.bot.secondaryDef()) {
            return false;
        }
        const herb = this.bot.herbDef()!;
        return Inventory.countById(herb.id) === 0 && Inventory.countById(herb.unfId) > 0;
    }

    async execute(): Promise<void> {
        const herb = this.bot.herbDef();
        const secondary = this.bot.secondaryDef();
        if (!herb || !secondary) {
            return;
        }
        const here = Game.tile();
        const bank = here ? nearestBank(here) : null;
        if (!bank) {
            this.bot.log('no reachable bank');
            return;
        }

        this.bot.setStatus(`withdrawing ${secondary.name}`);
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

        if (!(await Bank.withdrawXById(secondary.id, BATCH))) {
            this.bot.log(`no ${secondary.name} in the bank — stopping`);
            ScriptRunner.stop(`no ${secondary.name} in the bank`);
            return;
        }
        if (!(await Bank.close())) {
            this.bot.log('bank would not close — retrying the trip');
            return;
        }

        this.bot.setStatus(`finishing ${herb.name} potions`);
        const secItem = this.lastItem(secondary.id);
        const unfItem = this.lastItem(herb.unfId);
        if (secItem && unfItem) {
            const startXp = Skills.xp('herblore');
            const maxSpam = BATCH * 4; // safety cap

            for (let i = 0; i < maxSpam; i++) {
                if (Inventory.countById(herb.unfId) === 0) break;
                if (Inventory.countById(secondary.id) === 0) break;
                secItem.useOn(unfItem); // fire and forget - true spam
            }

            // Settle: wait for the unfinished potions to convert into finished ones.
            await Execution.delayUntil(
                () => Inventory.countById(herb.unfId) === 0 || Skills.xp('herblore') > startXp,
                8000
            );
        }

        // Why: the bank is left open, since the next cycle's RestockIngredients reuses it and each loop runs bank-open → empty pack → bank-open with no reopen.
        this.bot.setStatus('banking finished potions');
        if (!(await Bank.openNearestAccess(access, m => this.bot.log(`  ${m}`)))) {
            this.bot.log('could not open the bank — retrying');
            return;
        }
        if (Inventory.used() > 0) {
            await Bank.depositAllMatching(() => true);
        }
    }

    private lastItem(id: number): InvItem | null {
        const items = Inventory.items().filter(i => i.id === id);
        return items.length === 0 ? null : items[items.length - 1];
    }
}