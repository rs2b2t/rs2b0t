import type { Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import type { Player } from '../../api/model/Player.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Trade } from '../../api/trade/Trade.js';
import { stableClosedPoll } from '../../api/trade/drivePartnerTrade.js';
import {
    EMPTY_GIVER_WAIT_MS,
    RECEIVER_OFFER_WAIT_MS,
    TRADE_CONFIRM_WAIT_MS,
    TRADE_GRACE_MS,
    type MuleDepotContext
} from './MuleDepotContext.js';
import { describeLines, isGiverRole } from './MuleDepotLogic.js';

/** How long a staked pile gets to show every line before the giver gives up on it. */
const OFFER_SETTLE_MS = 5_000;

// Why: movement and combat both close the trade modal, so one task owns it and sits atop every
// role's list, and closure needs continuous inactivity rather than one !Trade.active() read.

/**
 * The only thing that differs between the four roles. Why: the state machine around it is identical
 * for all of them, so it lives in one class and only the direction is injected.
 */
export interface TradeFlavour {
    side: 'receiver' | 'giver';
    /** For the log, e.g. `mule` or `supermule`. */
    label: string;
    /** The metric captured when the window opens. */
    baseline(bot: MuleDepotContext): number;
    /** Signed change proving the transfer landed; > 0 means success. */
    delta(bot: MuleDepotContext, baseline: number): number;
    /** Our side is ready: a receiver has goods on the table, a giver has its plan up. */
    ready(bot: MuleDepotContext): boolean;
    /** Stake our side, then accept. A receiver has nothing to stake and just accepts. */
    act(bot: MuleDepotContext): Promise<void>;
    /** A verified transfer landed. This is how a supplier learns to move on to the next batch. */
    onTransfer?(bot: MuleDepotContext, amount: number): void;
}

/** Supermule and Client: take what is offered, prove the pack grew. */
export function receiverFlavour(bot: MuleDepotContext): TradeFlavour {
    return {
        side: 'receiver',
        label: bot.role().toLowerCase(),
        baseline: host => host.packUnits(),
        delta: (host, baseline) => host.packUnits() - baseline,
        ready: () => Trade.theirOffer().length > 0,
        act: async () => {
            await Trade.accept();
        }
    };
}

/** Mule and Supplier: stake the pack, prove it shrank by what was owed. */
export function giverFlavour(bot: MuleDepotContext): TradeFlavour {
    return {
        side: 'giver',
        label: bot.role().toLowerCase(),
        baseline: host => host.packUnits(),
        delta: (host, baseline) => baseline - host.packUnits(),
        // Why: a giver is ready when it still holds goods to stake or already has them up. Waiting
        // only for an existing offer deadlocks, since staking is what puts one there.
        ready: host => Trade.myOffer().length > 0 || host.packUnits() > 0,
        act: async host => {
            if (Trade.myOffer().length === 0) {
                if (!await stakeEverything(host)) {
                    await Trade.decline();
                }
                return;
            }
            await Trade.accept();
        },
        onTransfer: (host, amount) => {
            if (host.role() === 'Supplier') {
                host.markBatchServed(amount);
            }
        }
    };
}

/**
 * Stake the whole pack, one distinct name at a time. Why: a dumper's pack is the list by
 * construction, and a supplier stakes a batch `loadoutInPack` has already trimmed to what it holds.
 */
interface StakedLine {
    id: number;
    name: string;
    quantity: number;
}

/**
 * One line per pack slot id, not per name. Why: every unidentified herb is called Herb, so a
 * name-keyed list merges two stacks, and Offer-All stakes one slot of a name rather than all of them.
 */
function packLinesById(): StakedLine[] {
    const byId = new Map<number, StakedLine>();
    for (const item of Inventory.items()) {
        if (item.name === null) {
            continue;
        }
        const held = byId.get(item.id);
        if (held) {
            held.quantity += item.count;
            continue;
        }
        byId.set(item.id, { id: item.id, name: item.name, quantity: item.count });
    }
    return [...byId.values()];
}

async function stakeEverything(bot: MuleDepotContext): Promise<boolean> {
    const isDumper = bot.role() === 'Mule';
    const lines: StakedLine[] = isDumper ? packLinesById() : bot.loadoutInPack();

    if (lines.length === 0) {
        bot.log(`${bot.role().toLowerCase()} has nothing to offer`);
        return false;
    }

    const staked = (line: StakedLine): number => Trade.myOffer().reduce((sum, offer) => {
        const byId = line.id >= 0 && offer.id === line.id;
        const byName = line.id < 0 && (offer.name ?? '').toLowerCase() === line.name.toLowerCase();
        return sum + (byId || byName ? Math.max(1, offer.count) : 0);
    }, 0);

    bot.setStatus(`offering ${lines.length} line(s)`);
    for (const line of lines) {
        // Why: Offer-All is one click, where an exact count needs a count dialog the trade screen
        // does not answer. A supplier needs the exact count, so it keeps that path and picks by id.
        const ok = isDumper
            ? await Trade.offerAll(line.name, slot => slot.id === line.id)
            : line.id >= 0
                ? await Trade.offer(line.name, line.quantity, slot => slot.id === line.id)
                : await Trade.offer(line.name, line.quantity);
        if (!ok) {
            bot.log(`could not offer ${line.quantity} ${line.name.length > 0 ? line.name : `#${line.id}`}`);
            return false;
        }
    }

    // Why: a full pack is twenty-eight lines and a tick between each outlasts the partner's
    // patience, so every line is clicked first and the pile is confirmed afterwards.
    if (!await Execution.delayUntil(() => lines.every(line => staked(line) >= line.quantity), OFFER_SETTLE_MS)) {
        bot.log('the offer never showed every line');
        return false;
    }
    bot.log(`offered ${describeLines(lines)}`);
    return true;
}

interface TradeScreenState {
    /** Set when the window opens, so one screen is one accounted event. */
    id: number | null;
    /** When the offer screen first had nothing to work with. */
    emptySince: number | null;
    /** Closure needs continuous inactivity, not one clean read. */
    closedPoll: (() => boolean) | null;
    /** The metric at handshake start. */
    baseline: number | null;
}

function openTradeScreen(bot: MuleDepotContext, flavour: TradeFlavour, state: TradeScreenState): void {
    state.id = bot.recordTradeScreenOpen();
    state.closedPoll = stableClosedPoll();
    // Why: a giver's stack leaves the pack the moment it is staked, so a baseline taken at confirm
    // time reads every completed trade as a transfer of zero.
    state.baseline = flavour.baseline(bot);
    state.emptySince = null;
    bot.log(`trade screen open #${state.id} side=${flavour.side} partner=${Trade.partner() ?? 'unknown'}`);
}

function settle(bot: MuleDepotContext, state: TradeScreenState, detail: string): void {
    if (state.id !== null) {
        bot.log(`trade screen closed #${state.id} side=${flavourLabel(bot)} ${detail}`);
    }
    state.id = null;
    state.emptySince = null;
    state.closedPoll = null;
    state.baseline = null;
}

function flavourLabel(bot: MuleDepotContext): string {
    return isGiverRole(bot.role()) ? 'giver' : 'receiver';
}

export class TradeScreenTask implements Task {
    private ownTradeUntil = 0;
    private readonly state: TradeScreenState = { id: null, emptySince: null, closedPoll: null, baseline: null };

    constructor(
        private readonly bot: MuleDepotContext,
        private readonly flavour: TradeFlavour
    ) {}

    validate(): boolean {
        this.observe();
        if (Trade.active()) {
            this.ownTradeUntil = Date.now() + TRADE_GRACE_MS;
            return true;
        }
        // Why: a movement or gather click dispatched in the same tick a window shut would read as
        // a failed trade, so the loop keeps ownership for a moment after the modal is gone.
        return Date.now() < this.ownTradeUntil;
    }

    async execute(): Promise<void> {
        this.observe();
        if (Trade.onConfirmScreen()) {
            await this.confirm();
            return;
        }
        if (!Trade.onOfferScreen()) {
            await Execution.delayTicks(1);
            return;
        }
        await this.offerScreen();
    }

    private observe(): void {
        if (Trade.active()) {
            if (this.state.id === null) {
                openTradeScreen(this.bot, this.flavour, this.state);
            }
            return;
        }
        if (this.state.id !== null && this.state.closedPoll?.()) {
            const failure = this.bot.recordTradeScreenFailure();
            this.bot.log(`trade screen failure #${failure} screen=${this.state.id} reason=closed-before-success`);
            settle(this.bot, this.state, 'failure');
        }
    }

    private async confirm(): Promise<void> {
        this.bot.setStatus('confirming the trade');
        const baseline = this.state.baseline ?? this.flavour.baseline(this.bot);
        await Trade.accept();
        if (!(await Execution.delayUntil(() => !Trade.active(), TRADE_CONFIRM_WAIT_MS))) {
            this.bot.log('the trade stayed open after confirming');
            return;
        }
        const moved = this.flavour.delta(this.bot, baseline);
        if (moved > 0) {
            const transfer = this.bot.recordTransfer(moved);
            this.bot.log(`transfer success #${transfer} side=${this.flavour.side} moved=${moved}`);
            settle(this.bot, this.state, `success moved=${moved}`);
            this.flavour.onTransfer?.(this.bot, moved);
            return;
        }
        const failure = this.bot.recordTradeScreenFailure();
        this.bot.log(`transfer failed #${failure} screen=${this.state.id} moved=${moved}`);
        settle(this.bot, this.state, `failure moved=${moved}`);
    }

    private async offerScreen(): Promise<void> {
        const who = Trade.partner();
        if (who === null) {
            await this.holdOrDecline('reading the trade partner');
            return;
        }
        if (!this.bot.acceptsTradeWith(who)) {
            this.bot.setStatus(`declining a trade from ${who}`);
            this.bot.log(`declining a trade from '${who}' — not an account to trade with right now`);
            await Trade.decline();
            settle(this.bot, this.state, 'declined-unwanted');
            return;
        }
        if (!this.flavour.ready(this.bot)) {
            await this.holdOrDecline(this.flavour.side === 'giver'
                ? `waiting to stake for ${who}`
                : `waiting for ${who}'s offer`);
            return;
        }
        this.state.emptySince = null;
        await this.flavour.act(this.bot);
    }

    /** Hold a window that has nothing to work with, then decline it rather than sitting forever. */
    private async holdOrDecline(status: string): Promise<void> {
        this.state.emptySince ??= Date.now();
        const patience = this.flavour.side === 'receiver' ? RECEIVER_OFFER_WAIT_MS : EMPTY_GIVER_WAIT_MS;
        if (Date.now() - this.state.emptySince < patience) {
            this.bot.setStatus(status);
            await Execution.delayTicks(1);
            return;
        }
        await Trade.decline();
        const failure = this.bot.recordTradeScreenFailure();
        this.bot.log(`trade screen failure #${failure} screen=${this.state.id} reason=empty-offer-timeout`);
        settle(this.bot, this.state, 'failure empty-offer-timeout');
    }
}

export interface TradeRequestPolicy {
    ready(): boolean;
    candidate(): Player | null;
    status(): string;
}

/** Ask the partner for a window, no more often than the request interval. */
export class TradeRequestTask implements Task {
    constructor(
        private readonly bot: MuleDepotContext,
        private readonly policy: TradeRequestPolicy
    ) {}

    validate(): boolean {
        return this.policy.ready() && !Trade.active() && this.bot.tradeRequestDue() && this.policy.candidate() !== null;
    }

    async execute(): Promise<void> {
        const candidate = this.policy.candidate();
        if (!candidate?.name) {
            return;
        }
        this.bot.markTradeRequest();
        this.bot.setStatus(this.policy.status().replace('{name}', candidate.name));
        this.bot.log(`requesting a trade with '${candidate.name}' from ${candidate.distance()} tile(s)`);
        if (!(await Trade.request(candidate.name))) {
            this.bot.log(`could not click '${candidate.name}'`);
            await Execution.delayTicks(2);
            return;
        }
        // Why: a "Trade with" click clears a pending action and can shut a window that opened the
        // same tick, so one request gets one long wait rather than an immediate re-click.
        if (!(await Execution.delayUntil(() => Trade.active(), 4_000))) {
            this.bot.log(`'${candidate.name}' did not open a window`);
        }
    }
}
