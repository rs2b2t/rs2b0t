import type { Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Trade } from '../../api/trade/Trade.js';
import type { Player } from '../../api/model/Player.js';
import { ESSENCE, ESSENCE_ID, type MuleCrafterContext } from './MuleCrafterContext.js';
import { classifyMuleState } from './MuleCrafterLogic.js';

const MULE_TRADE_GRACE_MS = 2_000;

export interface TradeRequestPolicy {
    ready(): boolean;
    candidate(): Player | null;
    status(): string;
}

export class TradeRequestTask implements Task {
    constructor(
        private bot: MuleCrafterContext,
        private policy: TradeRequestPolicy
    ) {}

    validate(): boolean {
        return this.policy.ready() && !Trade.active() && this.bot.tradeRequestDue() && this.policy.candidate() !== null;
    }

    async execute(): Promise<void> {
        const candidate = this.policy.candidate();
        if (!candidate?.name) return;
        this.bot.markTradeRequest();
        this.bot.setStatus(this.policy.status().replace('{name}', candidate.name));
        const requested = await Trade.request(candidate.name);
        this.bot.log(`trade request to ${candidate.name} returned ${requested}`);
        if (requested) {
            await Execution.delayUntil(() => Trade.active(), 4000);
        } else {
            await Execution.delayTicks(1);
        }
    }
}

export class CrafterTradeScreenTask implements Task {
    private ownTradeUntil = 0;

    constructor(private bot: MuleCrafterContext) {}

    validate(): boolean {
        if (this.bot.mode() !== 'Crafter' || !this.bot.muleModeActive()) {
            this.ownTradeUntil = 0;
            return false;
        }
        if (Trade.active()) {
            this.ownTradeUntil = Date.now() + MULE_TRADE_GRACE_MS;
            return true;
        }
        return Date.now() < this.ownTradeUntil;
    }

    async execute(): Promise<void> {
        if (Trade.onConfirmScreen()) {
            this.bot.setStatus('confirming trade');
            const before = this.bot.essenceCount();
            await Trade.accept();
            if (await Execution.delayUntil(() => !Trade.active(), 3000)) {
                const received = this.bot.essenceCount() - before;
                if (received > 0) {
                    this.bot.recordCrafterTrade(received);
                    this.bot.log(`received ${received} essence`);
                } else {
                    this.bot.log('trade closed without receiving essence');
                }
            } else {
                this.bot.log('trade remained open after confirm');
            }
            return;
        }
        if (!Trade.onOfferScreen()) {
            await Execution.delayTicks(1);
            return;
        }
        const who = Trade.partner();
        if (who === null) {
            this.bot.setStatus('reading trade partner');
            await Execution.delayTicks(1);
            return;
        }
        if (!this.bot.isPartner(who)) {
            this.bot.setStatus(`declining trade from ${who}`);
            await Trade.decline();
            return;
        }
        const state = classifyMuleState(Trade.theirOffer());
        this.bot.log(`trade offer from ${who}: ${state}`);
        if (state !== 'has-essence') {
            this.bot.setStatus(`waiting for ${who}'s essence`);
            await Execution.delayTicks(1);
            return;
        }
        const talisman = this.bot.cfg().talisman.toLowerCase();
        const names = [...new Set(Inventory.items()
            .filter(item => item.name && item.name.toLowerCase() !== talisman)
            .map(item => item.name as string))];
        for (const name of names) {
            await Trade.offerAll(name);
            await Execution.delayTicks(1);
        }
        await Trade.accept();
    }
}

export class MuleTradeScreenTask implements Task {
    private beforeEssence = 0;
    private ownTradeUntil = 0;

    constructor(private bot: MuleCrafterContext) {}

    validate(): boolean {
        if (this.bot.mode() !== 'Mule') {
            this.ownTradeUntil = 0;
            return false;
        }
        if (Trade.active()) {
            this.ownTradeUntil = Date.now() + MULE_TRADE_GRACE_MS;
            return true;
        }
        return Date.now() < this.ownTradeUntil;
    }

    async execute(): Promise<void> {
        if (Trade.onConfirmScreen()) {
            this.bot.setStatus('confirming trade');
            await Trade.accept();
            if (await Execution.delayUntil(() => !Trade.active(), 3000) && this.beforeEssence > 0) {
                const delivered = this.beforeEssence - this.bot.essenceCount();
                if (delivered > 0) {
                    this.bot.recordMuleDelivery(delivered);
                    this.bot.log(`delivered ${delivered} essence to the crafter`);
                }
                this.beforeEssence = 0;
            }
            return;
        }
        if (!Trade.onOfferScreen()) {
            await Execution.delayTicks(1);
            return;
        }
        const who = Trade.partner();
        if (who === null) {
            await Execution.delayTicks(1);
            return;
        }
        if (!this.bot.isPartner(who)) {
            this.bot.setStatus(`declining trade from ${who}`);
            await Trade.decline();
            return;
        }
        if (Trade.myOffer().length === 0) {
            this.beforeEssence = this.bot.essenceCount();
            if (this.beforeEssence === 0) {
                this.bot.setStatus('waiting for essence');
                await Execution.delayTicks(1);
                return;
            }
            this.bot.setStatus('offering essence');
            await Trade.offerAll(ESSENCE, item => item.id === ESSENCE_ID);
        } else {
            this.bot.setStatus('accepting the offer');
            await Trade.accept();
        }
    }
}
