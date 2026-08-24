import { actions, reader } from '../../adapter/ClientAdapter.js';
import { Banking } from '../../api/bank/Banking.js';
import { LoopingBot } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Bank, withdrawOp } from '../../api/bank/Bank.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Paint } from '../../paint/Paint.js';
import { Skills } from '../../api/skills/Skills.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';

export const BONE_BURIER_SETTINGS: SettingsSchema = {
    boneName: {
        type: 'string',
        default: 'Bones',
        label: 'Bone name (exact)',
        help: 'the exact bank item to withdraw and bury, e.g. Bones, Big bones, or Dragon bones'
    }
};

export default class BoneBurier extends LoopingBot {
    override loopDelay = 600;

    private boneName = 'Bones';
    private burials = 0;
    private trips = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpStart = 0;
    private bankExhausted = false;
    private emptyBankReads = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(
            () => Game.ingame() && Game.tile() !== null && reader.inventorySize() > 0 && Skills.index('prayer') !== -1,
            0
        );

        this.boneName = this.settings.str('boneName', 'Bones').trim() || 'Bones';
        this.startedAt = Date.now();
        this.xpStart = Skills.xp('prayer');
        this.log(`BoneBurier — withdrawing and burying exact item '${this.boneName}'`);
    }

    override async loop(): Promise<void> {
        if (Inventory.count(this.boneName) > 0) {
            await this.buryOne();
            return;
        }
        await this.restock();
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#f3e6a2' });
        const mins = (Date.now() - this.startedAt) / 60_000;
        const xp = Skills.xp('prayer') - this.xpStart;
        const perHour = mins > 0.5 ? Math.round((this.burials / mins) * 60) : 0;

        p.title(`BoneBurier — ${this.status}`);
        p.row(`Runtime: ${fmtDuration(mins)}`, `Buried: ${this.burials}`, `Trips: ${this.trips}`);
        p.row(`Prayer xp: +${xp}`, `Bones/hr: ${perHour}`, `Pack: ${Inventory.count(this.boneName)}`);
        p.row(`Type: ${this.boneName}`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }

    private async buryOne(): Promise<void> {
        if (Bank.isOpen()) {
            actions.closeModal();
            if (!(await Execution.delayUntil(() => !Bank.isOpen(), 3000))) {
                this.log('bank did not close — retrying');
                return;
            }
        }

        const bones = Inventory.first(this.boneName);
        if (!bones) {
            return;
        }

        this.status = `burying ${this.boneName}`;
        const before = Inventory.count(this.boneName);
        if (!(await bones.interact('Bury'))) {
            ScriptRunner.stop(`'${this.boneName}' has no Bury action (ops: [${bones.actions().join(', ')}])`);
            return;
        }

        if (await Execution.delayUntil(() => Inventory.count(this.boneName) < before, 3000)) {
            this.burials += before - Inventory.count(this.boneName);
        } else {
            this.log(`burying '${this.boneName}' made no progress — retrying`);
        }
    }

    private async restock(): Promise<void> {
        if (this.bankExhausted) {
            this.finishComplete();
            return;
        }

        this.status = 'opening nearest bank';
        const opened = await Banking.bankNearest({
            deposit: () => true,
            commonJunk: false,
            log: message => this.log(`  ${message}`)
        });
        if (!opened) {
            this.log('could not open a bank — retrying');
            return;
        }
        if (!(await Execution.delayUntil(() => Bank.loaded(), 3000))) {
            this.emptyBankReads++;
            if (this.emptyBankReads >= 3) {
                this.log(`bank stayed empty — no exact item '${this.boneName}' remains.`);
                this.finishComplete();
                return;
            }
            this.log('bank contents are not ready — retrying');
            return;
        }
        this.emptyBankReads = 0;

        await Bank.setNoteMode(false);
        const wanted = this.boneName.toLowerCase();
        const bankItem = Bank.items().find(item => item.name?.toLowerCase() === wanted);
        if (!bankItem?.name) {
            this.finishComplete();
            return;
        }

        const op = withdrawOp(bankItem.ops, 'all') ?? withdrawOp(bankItem.ops, '10') ?? withdrawOp(bankItem.ops, '1');
        if (!op) {
            this.status = 'withdraw failed';
            ScriptRunner.stop(`'${bankItem.name}' has no usable Withdraw action`);
            return;
        }

        this.status = `withdrawing ${bankItem.name}`;
        const before = Inventory.count(this.boneName);
        const bankedBefore = Bank.count(bankItem.name);
        if (!(await Bank.withdraw(bankItem.name, op))) {
            this.log(`could not ${op} '${bankItem.name}' — retrying`);
            return;
        }
        if (await Execution.delayUntil(() => Inventory.count(this.boneName) > before, 4000)) {
            const withdrawn = Inventory.count(this.boneName) - before;
            this.bankExhausted = withdrawn >= bankedBefore;
            this.trips++;
            this.log(`bank trip ${this.trips}: withdrew ${withdrawn} ${bankItem.name}`);
        } else {
            this.log(`withdrawal of '${bankItem.name}' made no progress — retrying`);
        }
    }

    private finishComplete(): void {
        this.status = 'complete';
        if (Bank.isOpen()) {
            actions.closeModal();
        }
        ScriptRunner.stop(`bank is out of exact item '${this.boneName}' — complete.`);
    }
}
