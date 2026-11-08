import type { Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Trade } from '../../api/trade/Trade.js';
import type Tile from '../../geometry/Tile.js';
import { APPROACH_RANGE, LEASH_RADIUS, STALL_LIMIT, TRADE_RANGE, type MuleDepotContext } from './MuleDepotContext.js';

/**
 * Walk to a destination once a readiness predicate holds.
 *
 * Every role reaches the same bank, so one walk serves all four; only the predicate differs.
 */
export class WalkToTask implements Task {
    constructor(
        private readonly bot: MuleDepotContext,
        private readonly destination: () => Tile,
        private readonly ready: () => boolean,
        private readonly radius: number,
        private readonly status: string
    ) {}

    validate(): boolean {
        return this.ready() && !Trade.active();
    }

    async execute(): Promise<void> {
        this.bot.setStatus(this.status);
        await this.bot.walkTo(this.destination(), this.radius);
    }
}

/**
 * Close the last tile or two to the partner before asking to trade. Why: a "Trade with" click from
 * further away is a click that sometimes does nothing.
 */
export class ApproachPartnerTask implements Task {
    private stalls = 0;
    private reportedStall = false;

    constructor(
        private readonly bot: MuleDepotContext,
        private readonly ready: () => boolean,
        private readonly radius: number = TRADE_RANGE,
        /** How far off to look for the partner. Must exceed `radius` or this never validates. */
        private readonly searchRange: number = APPROACH_RANGE
    ) {}

    validate(): boolean {
        const partner = this.bot.nearestPartner(this.searchRange);
        if (!this.ready() || Trade.active() || partner === null || partner.distance() <= this.radius) {
            return false;
        }
        // Why: the partner can stand where the walker cannot follow, so after a few fruitless walks
        // this stops claiming the task and lets the request go out from wherever they are.
        return this.stalls < STALL_LIMIT;
    }

    async execute(): Promise<void> {
        const partner = this.bot.nearestPartner(this.searchRange);
        if (!partner) {
            return;
        }
        const before = partner.distance();
        this.bot.setStatus(`approaching ${partner.name ?? 'partner'}`);
        this.bot.log(`approaching ${partner.name ?? 'partner'} at ${before} tile(s)`);
        await this.bot.walkTo(partner.tile(), this.radius);
        const after = this.bot.nearestPartner(this.searchRange)?.distance() ?? before;
        this.stalls = after < before ? 0 : this.stalls + 1;
        if (this.stalls > 0 && !this.reportedStall) {
            this.reportedStall = true;
            this.bot.log(`cannot close on ${partner.name ?? 'partner'} past ${after} tile(s); requesting from here`);
        }
        if (after < before) {
            this.reportedStall = false;
        }
    }
}

/**
 * Walk back to the bank after drifting off it. Why: a shove or a stray walk leaves a role out of
 * range of its depot, and it then waits there for a partner that is also waiting.
 */
export class ReturnToDepotTask implements Task {
    constructor(private readonly bot: MuleDepotContext, private readonly radius: number = LEASH_RADIUS) {}

    validate(): boolean {
        return this.bot.awayFromDepot() && !Trade.active();
    }

    async execute(): Promise<void> {
        this.bot.setStatus('returning to the depot');
        this.bot.log('away from the depot, walking back');
        await this.bot.walkTo(this.bot.bankTile(), 3);
    }
}

/** Hold position and do nothing, which is what three of the four roles mostly do. */
export class WaitTask implements Task {
    private calls = 0;

    constructor(
        private readonly bot: MuleDepotContext,
        private readonly ready: () => boolean,
        private readonly status: () => string,
        private readonly ticks = 2
    ) {}

    validate(): boolean {
        return this.ready();
    }

    async execute(): Promise<void> {
        const status = this.status();
        this.bot.setStatus(status);
        // Why: the status is paint-only, so without this a long wait is invisible in the log.
        if (this.calls++ % 15 === 0) {
            this.bot.log(`waiting: ${status}`);
        }
        await Execution.delayTicks(this.ticks);
    }
}
