import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Bank } from '../../api/bank/Bank.js';
import { openBankAccess } from '../../api/bank/Banking.js';
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

    batchSize(): number {
        const id = this.settings.num('outputId', 0);
        const target = this.settings.num('outputCount', 0);
        return id > 0 && target > 0 ? Math.max(0, Math.min(BATCH, target - Bank.countById(id) - Inventory.countById(id))) : BATCH;
    }
    private batches = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;
    private pendingBankGeneration: number | null = null;

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
            this.requestFinish('unknown herb');
            return;
        }

        const secondaryChoice = this.settings.str('secondary', CUSTOM);
        const secondaryRaw = secondaryChoice === CUSTOM ? this.settings.str('secondaryCustom', '') : secondaryChoice;
        this.secondary = secondaryByName(secondaryRaw);
        if (!this.secondary) {
            this.log(`Unknown secondary "${secondaryRaw}" — stopping`);
            this.requestFinish('unknown secondary');
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

    async mixBatch(ingredientId: number, solventId: number, description: string): Promise<boolean> {
        let failures = 0;
        let mixed = 0;
        for (;;) {
            const items = Inventory.items();
            const ingredients = items.filter(item => item.id === ingredientId);
            const ingredient = ingredients.at(-1);
            const solvent = items.findLast(item => item.id === solventId);
            if (!ingredient || !solvent) {
                if (mixed) this.log(`Mixed ${mixed} pairs of ${description}`);
                return true;
            }

            await ingredient.useOn(solvent);
            if (await Execution.delayUntil(() => Inventory.countById(ingredientId) < ingredients.length, 3000)) {
                Execution.noteProgress();
                mixed++;
                failures = 0;
                continue;
            }
            this.log(`No progress mixing ${description} (${++failures}/3)`);
            if (failures === 3) {
                this.requestFinish(`could not mix ${description}`);
                return false;
            }
        }
    }

    async waitForDeposit(): Promise<boolean> {
        if (this.pendingBankGeneration === null) {
            return true;
        }
        if (!(await Bank.waitSnapshotAfter(this.pendingBankGeneration))) {
            await Bank.close();
            return false;
        }
        this.pendingBankGeneration = null;
        return true;
    }

    async depositInventory(): Promise<boolean> {
        if (!(await this.waitForDeposit())) {
            return false;
        }
        if (Inventory.used() > 0) {
            this.pendingBankGeneration = Bank.snapshotGeneration();
            await Bank.depositAllMatching(() => true);
        }
        return this.waitForDeposit();
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

class RestockIngredients implements Task {
    private failedWithdraws = 0;

    constructor(private bot: PotionMaker) {}

    validate(): boolean {
        const herb = this.bot.herbDef();
        if (!herb) {
            return false;
        }
        if (Inventory.countById(herb.id) > 0) return Inventory.countById(VIAL_OF_WATER_ID) === 0;
        return Inventory.countById(herb.unfId) === 0;
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
            if (!(await openBankAccess(bank, access, m => this.bot.log(`  ${m}`)))) {
                this.bot.log('could not open the bank — retrying');
                return;
            }
        }

        if (!(await this.bot.depositInventory())) {
            this.bot.log('bank stock did not reload after the deposit, retrying');
            return;
        }

        // Why: Bank.open* already waits for ready(), so one count is the server's answer, an empty bank and a still-loading one included.
        if (!Bank.ready()) {
            return;
        }
        const batch = this.bot.batchSize();
        if (batch === 0) { this.bot.requestFinish('Potion target reached'); return; }
        if (this.bot.secondaryDef() && Bank.countById(herb.unfId) > 0) {
            if (!(await Bank.withdrawXById(herb.unfId, batch))) {
                if (++this.failedWithdraws >= 3) this.bot.requestFinish('could not withdraw unfinished potions');
                return;
            }
            this.failedWithdraws = 0;
            await Bank.close();
            return;
        }
        const vialCount = Bank.countById(VIAL_OF_WATER_ID);
        const herbCount = Bank.countById(herb.id);
        if (vialCount === 0 || herbCount === 0) {
            const missing = vialCount === 0 ? 'vials of water' : herb.name;
            this.bot.log(`no ${missing} in the bank — stopping`);
            this.bot.requestFinish(`no ${missing} in the bank`);
            return;
        }
        const pairs = Math.min(batch, vialCount, herbCount);
        if (!(await Bank.withdrawXById(VIAL_OF_WATER_ID, pairs))) {
            this.bot.log(`ingredient withdrawal failed (${++this.failedWithdraws}/3)`);
            if (this.failedWithdraws >= 3) {
                this.bot.log('withdrawing vials of water failed three times — stopping');
                this.bot.requestFinish('could not withdraw vials of water');
            }
            return;
        }
        if (!(await Bank.withdrawXById(herb.id, pairs))) {
            this.bot.log(`ingredient withdrawal failed (${++this.failedWithdraws}/3)`);
            if (this.failedWithdraws >= 3) {
                this.bot.log(`withdrawing ${herb.name} failed three times — stopping`);
                this.bot.requestFinish(`could not withdraw ${herb.name}`);
            }
            return;
        }
        this.failedWithdraws = 0;

        if (!(await Bank.close())) {
            this.bot.log('bank would not close — retrying the trip');
            return;
        }

        this.bot.countBatch();
        this.bot.log(`withdrew ${Inventory.countById(VIAL_OF_WATER_ID)} vials of water + ${Inventory.countById(herb.id)} ${herb.name}`);
    }
}

class MakeUnfinished implements Task {
    constructor(private bot: PotionMaker) {}

    validate(): boolean {
        const herb = this.bot.herbDef();
        if (!herb) {
            return false;
        }
        return Inventory.countById(herb.id) > 0 && Inventory.countById(VIAL_OF_WATER_ID) > 0;
    }

    async execute(): Promise<void> {
        const herb = this.bot.herbDef();
        if (!herb) {
            return;
        }
        if (Bank.isOpen() && !(await Bank.close())) {
            this.bot.log('bank would not close, retrying');
            return;
        }
        this.bot.setStatus(`making ${herb.name} unfinished potions`);

        await this.bot.mixBatch(herb.id, VIAL_OF_WATER_ID, `${herb.name} with vials of water`);
    }
}

class FinishPotions implements Task {
    private failedSecondaryWithdraws = 0;

    constructor(private bot: PotionMaker) {}

    validate(): boolean {
        if (!this.bot.herbDef() || !this.bot.secondaryDef()) {
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
        if (!(await openBankAccess(bank, access, m => this.bot.log(`  ${m}`)))) {
            this.bot.log('could not open the bank — retrying');
            return;
        }

        if (!(await this.bot.waitForDeposit())) {
            return;
        }
        if (!Bank.ready()) {
            await Bank.close();
            return;
        }
        const needed = Math.max(0, Math.min(BATCH, Inventory.countById(herb.unfId)) - Inventory.countById(secondary.id));
        if (needed > 0 && Bank.countById(secondary.id) === 0) {
            this.bot.log(`no ${secondary.name} in the bank — stopping at the booth holding the batch`);
            await Bank.close();
            this.bot.requestFinish(`no ${secondary.name} in the bank`);
            return;
        }
        if (needed > 0 && !(await Bank.withdrawXById(secondary.id, needed))) {
            await Bank.close();
            this.bot.log(`could not withdraw ${secondary.name} (${++this.failedSecondaryWithdraws}/3)`);
            if (this.failedSecondaryWithdraws >= 3) {
                this.bot.log(`withdrawing ${secondary.name} failed three times — stopping`);
                this.bot.requestFinish(`could not withdraw ${secondary.name}`);
            }
            return;
        }
        this.failedSecondaryWithdraws = 0;
        if (!(await Bank.close())) {
            this.bot.log('bank would not close — retrying the trip');
            return;
        }

        this.bot.setStatus(`finishing ${herb.name} potions`);
        if (!(await this.bot.mixBatch(secondary.id, herb.unfId, `${secondary.name} with unfinished potions`))) return;

        this.bot.setStatus('banking finished potions');
        if (!(await openBankAccess(bank, access, m => this.bot.log(`  ${m}`)))) {
            this.bot.log('could not open the bank — retrying');
            return;
        }
        await this.bot.depositInventory();
    }
}
