import { LoopingBot } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Paint } from '../../paint/Paint.js';
import { Skills } from '../../api/skills/Skills.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import {
    DART_PLANS,
    DART_TIER_OPTIONS,
    dartActionsFor,
    dartPlanFor,
    dartXpCeilingPerHour,
    type DartPlan
} from './DartFletcherLogic.js';

const NO_PROGRESS_LIMIT = 3;

export const DART_FLETCHER_SETTINGS: SettingsSchema = {
    tier: {
        type: 'string',
        default: 'Bronze',
        options: DART_TIER_OPTIONS,
        label: 'Dart tier',
        help: 'Feathers are spam-used on this tier of stackable dart tips; runs anywhere and stops when either stack is empty'
    }
};

export default class DartFletcher extends LoopingBot {
    // Every loop explicitly pays one server tick after sending its packet burst.
    override loopDelay = 0;

    private plan: DartPlan = DART_PLANS[0];
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;
    private productAtStart = 0;
    private actionsSent = 0;
    private noProgress = 0;
    private finished = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        const selected = this.settings.str('tier', 'Bronze');
        const plan = dartPlanFor(selected);
        if (!plan) {
            throw new Error(`DartFletcher: unknown dart tier '${selected}'`);
        }
        this.plan = plan;

        const level = Skills.level('fletching');
        if (level < plan.level) {
            throw new Error(`DartFletcher: Fletching ${plan.level} required for ${plan.tier} darts (have ${level})`);
        }

        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('fletching');
        this.productAtStart = Inventory.count(plan.product);
        this.status = `spamming ${plan.tier.toLowerCase()} darts`;

        const ceiling = Math.round(dartXpCeilingPerHour(plan));
        this.log(
            `DartFletcher: Feather + ${plan.tips} → ${plan.product}; ` +
            `up to 5 actions/tick (10 darts each, theoretical ${ceiling.toLocaleString()} XP/hr at 600ms ticks)`
        );
    }

    override async loop(): Promise<void> {
        if (ChatDialog.canContinue()) {
            this.status = 'clearing a dialog';
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            return;
        }
        if (ChatDialog.isOpen()) {
            this.status = 'waiting for a dialog';
            await Execution.delayTicks(1);
            return;
        }

        const tipsBefore = Inventory.count(this.plan.tips);
        const feathersBefore = Inventory.count('Feather');
        if (tipsBefore <= 0 || feathersBefore <= 0) {
            this.finish(tipsBefore <= 0 ? `out of ${this.plan.tips}` : 'out of Feather');
            return;
        }
        if (Inventory.count(this.plan.product) === 0 && Inventory.free() === 0) {
            this.finish(`needs one free inventory slot for ${this.plan.product}`);
            return;
        }

        const feather = Inventory.first('Feather');
        const tips = Inventory.first(this.plan.tips);
        if (!feather || !tips) {
            this.finish('the input stacks disappeared');
            return;
        }

        const want = dartActionsFor(tipsBefore, feathersBefore);
        let sent = 0;
        for (let i = 0; i < want; i++) {
            if (await feather.useOn(tips)) {
                sent++;
            }
        }
        this.actionsSent += sent;
        await Execution.delayTicks(1);

        const progressed = await Execution.delayUntil(
            () => Inventory.count(this.plan.tips) < tipsBefore || Inventory.count('Feather') < feathersBefore || ChatDialog.isOpen(),
            1200
        );
        if (progressed && (Inventory.count(this.plan.tips) < tipsBefore || Inventory.count('Feather') < feathersBefore)) {
            this.noProgress = 0;
            this.status = `spamming ${this.plan.tier.toLowerCase()} darts`;
            return;
        }

        this.noProgress++;
        this.status = `no progress (${this.noProgress}/${NO_PROGRESS_LIMIT})`;
        if (sent === 0 || this.noProgress >= NO_PROGRESS_LIMIT) {
            this.finish('item-on-item actions made no progress');
        }
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#e7c56a' });
        const mins = (Date.now() - this.startedAt) / 60_000;
        const xp = Skills.xp('fletching') - this.xpAtStart;
        const made = Math.max(0, Inventory.count(this.plan.product) - this.productAtStart);
        const xpHour = mins > 0.1 ? Math.round((xp / mins) * 60) : 0;
        const dartsHour = mins > 0.1 ? Math.round((made / mins) * 60) : 0;

        p.title(`DartFletcher — ${this.status}`);
        p.row(`Runtime: ${fmtDuration(mins)}`, `Fletching: ${Skills.level('fletching')}`, `XP: +${xp}`);
        p.row(`Made: ${made}`, `Darts/hr: ${dartsHour}`, `XP/hr: ${xpHour}`);
        p.row(`${this.plan.tips}: ${Inventory.count(this.plan.tips)}`, `Feathers: ${Inventory.count('Feather')}`);
        p.row(`Actions sent: ${this.actionsSent}`, `Tier: ${this.plan.tier}`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }

    private finish(reason: string): void {
        if (this.finished) {
            return;
        }
        this.finished = true;
        this.status = reason;
        ScriptRunner.stop(`DartFletcher: ${reason}; made ${Math.max(0, Inventory.count(this.plan.product) - this.productAtStart)} darts`);
    }
}
