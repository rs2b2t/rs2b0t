import type { Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Trade } from '../../api/trade/Trade.js';
import type Tile from '../../geometry/Tile.js';
import type { MuleCrafterContext } from './MuleCrafterContext.js';

export class WalkToTask implements Task {
    constructor(
        private bot: MuleCrafterContext,
        private destination: () => Tile,
        private ready: () => boolean,
        private readonly radius: number,
        private readonly status: string
    ) {}

    validate(): boolean {
        return this.ready();
    }

    async execute(): Promise<void> {
        this.bot.setStatus(this.status);
        await this.bot.walkTo(this.destination(), this.radius);
    }
}

export class ApproachAltarTask implements Task {
    constructor(
        private bot: MuleCrafterContext,
        private readonly ready: () => boolean,
        private readonly radius: number
    ) {}

    validate(): boolean {
        const altar = this.bot.altarTile();
        const current = this.bot.currentTile();
        return this.ready() && altar !== null && current !== null && !Trade.active() && altar.distanceTo(current) > this.radius;
    }

    async execute(): Promise<void> {
        const altar = this.bot.altarTile();
        if (!altar) return;
        this.bot.setStatus('approaching the altar');
        await this.bot.walkTo(altar, this.radius);
    }
}

export class ApproachPartnerTask implements Task {
    constructor(
        private bot: MuleCrafterContext,
        private readonly ready: () => boolean,
        private readonly radius: number
    ) {}

    validate(): boolean {
        const partner = this.bot.nearestPartner();
        return this.ready() && partner !== null && partner.distance() > this.radius && !Trade.active();
    }

    async execute(): Promise<void> {
        const partner = this.bot.nearestPartner();
        if (!partner) return;
        this.bot.setStatus(`approaching ${partner.name ?? 'partner'}`);
        await this.bot.walkTo(partner.tile(), this.radius);
    }
}

export class WaitTask implements Task {
    constructor(
        private bot: MuleCrafterContext,
        private ready: () => boolean,
        private readonly status: () => string,
        private readonly ticks = 2
    ) {}

    validate(): boolean {
        return this.ready();
    }

    async execute(): Promise<void> {
        this.bot.setStatus(this.status());
        await Execution.delayTicks(this.ticks);
    }
}
