import type { Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Trade } from '../../api/trade/Trade.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Locs } from '../../api/locs/Locs.js';
import type { MuleCrafterContext } from './MuleCrafterContext.js';

const ALTAR = { name: 'Altar', op: 'Craft-rune' };

export class EnterAltarTask implements Task {
    private fails = 0;

    constructor(
        private bot: MuleCrafterContext,
        private readonly ready: () => boolean,
        private readonly label: string
    ) {}

    validate(): boolean {
        return this.ready() && !this.bot.inTemple() && !Trade.active();
    }

    async execute(): Promise<void> {
        this.bot.setStatus(this.label);
        if (await this.bot.enterAltar()) {
            this.fails = 0;
            return;
        }
        if (++this.fails >= 3) {
            throw new Error('MuleCrafter: the talisman did not teleport into the altar');
        }
        await Execution.delayTicks(2);
    }
}

export class CraftRunesTask implements Task {
    constructor(private bot: MuleCrafterContext) {}

    validate(): boolean {
        return this.bot.mode() === 'Crafter' && this.bot.inTemple() && this.bot.essenceCount() > 0 && !Trade.active();
    }

    async execute(): Promise<void> {
        const altar = Locs.query().name(ALTAR.name).action(ALTAR.op).nearest();
        if (!altar) {
            this.bot.log('CraftRunes: no altar found');
            await Execution.delayTicks(2);
            return;
        }
        this.bot.setStatus('crafting runes');
        const before = this.bot.essenceCount();
        this.bot.log(`crafting ${before} essence at the altar`);
        if (!(await altar.interact(ALTAR.op))) {
            this.bot.log('CraftRunes: altar interact failed');
            await Execution.delayTicks(2);
            return;
        }
        await Execution.delayUntil(() => this.bot.essenceCount() === 0, 8000);
        const made = before - this.bot.essenceCount();
        if (made > 0) {
            const craft = this.bot.countCraft(made);
            this.bot.log(`craft success #${craft} made=${made} ${this.bot.cfg().rune}`);
        } else if (made === 0) {
            this.bot.log('craft completed without consuming essence');
        } else {
            this.bot.log(`craft essence count increased by ${-made}`);
        }
    }
}

export class ExitAltarTask implements Task {
    constructor(
        private bot: MuleCrafterContext,
        private readonly ready: () => boolean
    ) {}

    validate(): boolean {
        return this.ready() && this.bot.inTemple() && !Trade.active();
    }

    async execute(): Promise<void> {
        this.bot.setStatus('taking the portal out');
        if (await this.bot.exitAltar()) {
            this.bot.log('back at the meeting point');
        } else {
            this.bot.log('portal out did not complete; retrying');
        }
    }
}

export function crafterCanEnter(bot: MuleCrafterContext): boolean {
    return bot.mode() === 'Crafter'
        && (bot.essenceCount() > 0 || (bot.muleModeActive() && bot.meetingPoint() === 'Altar (inside)'))
        && Inventory.contains(bot.cfg().talisman);
}

export function muleCanEnter(bot: MuleCrafterContext): boolean {
    return bot.mode() === 'Mule'
        && bot.essenceCount() > 0
        && Inventory.contains(bot.cfg().talisman);
}
