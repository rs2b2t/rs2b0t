import type { Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Trade } from '../../api/trade/Trade.js';
import { stableClosedPoll } from '../../api/trade/drivePartnerTrade.js';
import type { Player } from '../../api/model/Player.js';
import { ESSENCE, ESSENCE_ID, type MuleCrafterContext } from './MuleCrafterContext.js';
import { classifyMuleState } from './MuleCrafterLogic.js';

const MULE_TRADE_GRACE_MS = 2_000;
const EMPTY_TRADE_TIMEOUT_MS = 3_000;
const TRADE_CONFIRM_WAIT_MS = 5_000;

interface TradeScreenState {
    id: number | null;
    emptySince: number | null;
    closedPoll: (() => boolean) | null;
    essenceAtOpen: number | null;
}

function observeTradeScreen(bot: MuleCrafterContext, state: TradeScreenState): void {
    if (Trade.active()) {
        if (state.id === null) {
            state.id = bot.recordTradeScreenOpen();
            state.closedPoll = stableClosedPoll();
            state.essenceAtOpen = bot.essenceCount();
            bot.log(`trade screen open #${state.id} mode=${bot.mode()} partner=${Trade.partner() ?? 'unknown'}`);
        }
    } else if (state.id !== null && state.closedPoll?.()) {
        failTradeScreen(bot, state, 'closed-before-success');
    }
}

function failTradeScreen(bot: MuleCrafterContext, state: TradeScreenState, reason: string): void {
    if (state.id === null) return;
    const failure = bot.recordTradeScreenFailure();
    bot.log(`trade screen failure #${failure} screen=${state.id} mode=${bot.mode()} reason=${reason}`);
    state.id = null;
    state.emptySince = null;
    state.closedPoll = null;
    state.essenceAtOpen = null;
}

function completeTradeScreen(bot: MuleCrafterContext, state: TradeScreenState, detail: string): void {
    if (state.id === null) return;
    const success = bot.recordTradeScreenSuccess();
    bot.log(`trade screen success #${success} screen=${state.id} mode=${bot.mode()} ${detail}`);
    state.id = null;
    state.emptySince = null;
    state.closedPoll = null;
    state.essenceAtOpen = null;
}

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
        if (requested) {
            await Execution.delayUntil(() => Trade.active(), 4000);
        } else {
            await Execution.delayTicks(1);
        }
    }
}

export class CrafterTradeScreenTask implements Task {
    private ownTradeUntil = 0;
    private readonly screenState: TradeScreenState = { id: null, emptySince: null, closedPoll: null, essenceAtOpen: null };

    constructor(private bot: MuleCrafterContext) {}

    validate(): boolean {
        if (this.bot.mode() !== 'Crafter' || !this.bot.muleModeActive()) {
            this.ownTradeUntil = 0;
            return false;
        }
        observeTradeScreen(this.bot, this.screenState);
        if (Trade.active()) {
            this.ownTradeUntil = Date.now() + MULE_TRADE_GRACE_MS;
            return true;
        }
        return Date.now() < this.ownTradeUntil;
    }

    async execute(): Promise<void> {
        observeTradeScreen(this.bot, this.screenState);
        if (Trade.onConfirmScreen()) {
            this.bot.setStatus('confirming trade');
            const before = this.screenState.essenceAtOpen ?? this.bot.essenceCount();
            await Trade.accept();
            if (await Execution.delayUntil(stableClosedPoll(), TRADE_CONFIRM_WAIT_MS)) {
                const received = this.bot.essenceCount() - before;
                if (received > 0) {
                    const trade = this.bot.recordCrafterTrade(received);
                    this.bot.log(`crafter trade success #${trade} received=${received} essence`);
                    completeTradeScreen(this.bot, this.screenState, `received=${received}`);
                } else {
                    this.bot.log('trade closed without receiving essence');
                    failTradeScreen(this.bot, this.screenState, 'no-essence-received');
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
            this.screenState.emptySince ??= Date.now();
            if (Date.now() - this.screenState.emptySince >= EMPTY_TRADE_TIMEOUT_MS) {
                await Trade.decline();
                failTradeScreen(this.bot, this.screenState, 'partner-header-timeout');
            } else {
                await Execution.delayTicks(1);
            }
            return;
        }
        if (!this.bot.isPartner(who)) {
            this.bot.setStatus(`declining trade from ${who}`);
            await Trade.decline();
            failTradeScreen(this.bot, this.screenState, 'unconfigured-partner');
            return;
        }
        const state = classifyMuleState(Trade.theirOffer());
        this.bot.log(`trade offer from ${who}: ${state}`);
        if (state !== 'has-essence') {
            this.screenState.emptySince ??= Date.now();
            if (Date.now() - this.screenState.emptySince >= EMPTY_TRADE_TIMEOUT_MS) {
                await Trade.decline();
                failTradeScreen(this.bot, this.screenState, 'empty-offer-timeout');
            } else {
                this.bot.setStatus(`waiting for ${who}'s essence`);
                await Execution.delayTicks(1);
            }
            return;
        }
        this.screenState.emptySince = null;
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
    private ownTradeUntil = 0;
    private readonly screenState: TradeScreenState = { id: null, emptySince: null, closedPoll: null, essenceAtOpen: null };

    constructor(private bot: MuleCrafterContext) {}

    validate(): boolean {
        if (this.bot.mode() !== 'Mule') {
            this.ownTradeUntil = 0;
            return false;
        }
        observeTradeScreen(this.bot, this.screenState);
        if (Trade.active()) {
            this.ownTradeUntil = Date.now() + MULE_TRADE_GRACE_MS;
            return true;
        }
        return Date.now() < this.ownTradeUntil;
    }

    async execute(): Promise<void> {
        observeTradeScreen(this.bot, this.screenState);
        if (Trade.onConfirmScreen()) {
            this.bot.setStatus('confirming trade');
            const before = this.screenState.essenceAtOpen ?? 0;
            await Trade.accept();
            if (await Execution.delayUntil(stableClosedPoll(), TRADE_CONFIRM_WAIT_MS)) {
                const delivered = before > 0 ? before - this.bot.essenceCount() : 0;
                if (delivered > 0) {
                    const delivery = this.bot.recordMuleDelivery(delivered);
                    this.bot.log(`mule trade success #${delivery} delivered=${delivered} essence`);
                    completeTradeScreen(this.bot, this.screenState, `delivered=${delivered}`);
                } else {
                    this.bot.log('trade closed without delivering essence');
                    failTradeScreen(this.bot, this.screenState, 'no-essence-delivered');
                }
            }
            return;
        }
        if (!Trade.onOfferScreen()) {
            await Execution.delayTicks(1);
            return;
        }
        const who = Trade.partner();
        if (who === null) {
            this.screenState.emptySince ??= Date.now();
            if (Date.now() - this.screenState.emptySince >= EMPTY_TRADE_TIMEOUT_MS) {
                await Trade.decline();
                failTradeScreen(this.bot, this.screenState, 'partner-header-timeout');
            } else {
                await Execution.delayTicks(1);
            }
            return;
        }
        if (!this.bot.isPartner(who)) {
            this.bot.setStatus(`declining trade from ${who}`);
            await Trade.decline();
            failTradeScreen(this.bot, this.screenState, 'unconfigured-partner');
            return;
        }
        if (Trade.myOffer().length === 0) {
            const essence = this.bot.essenceCount();
            if (essence === 0) {
                this.screenState.emptySince ??= Date.now();
                if (Date.now() - this.screenState.emptySince >= EMPTY_TRADE_TIMEOUT_MS) {
                    await Trade.decline();
                    failTradeScreen(this.bot, this.screenState, 'no-essence-to-offer-timeout');
                } else {
                    this.bot.setStatus('waiting for essence');
                    await Execution.delayTicks(1);
                }
                return;
            }
            this.screenState.emptySince = null;
            this.bot.setStatus('offering essence');
            await Trade.offerAll(ESSENCE, item => item.id === ESSENCE_ID);
        } else {
            this.screenState.emptySince = null;
            this.bot.setStatus('accepting the offer');
            await Trade.accept();
        }
    }
}
