import type { Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Locs } from '../../api/locs/Locs.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { walkOpening } from '../../event/webwalk/walkOpening.js';
import type FlaxAIO from './flaxaio.js';

const RESPIN_AFTER_TICKS = 6;

async function climbLadder(bot: FlaxAIO, name: string, op: string): Promise<boolean> {
    const ladder = Locs.query().name(name).action(op).nearest();
    if (!ladder) {
        bot.log(`no '${name}' offering '${op}' nearby`);
        return false;
    }
    const before = Game.tile()?.level;
    await ladder.interact(op);
    return Execution.delayUntil(() => {
        const t = Game.tile();
        return t !== null && t.level !== before;
    }, 8000);
}

export class AscendTask implements Task {
    constructor(private bot: FlaxAIO) {}
    validate(): boolean {
        // Why: in both-mode, finish filling the pack with flax before heading up to spin — only ascend once the inventory is full.
        return this.bot.spinning && Game.tile()?.level === 0 && this.bot.fibreCount() > 0 && (!this.bot.picking || Inventory.isFull());
    }
    async execute(): Promise<void> {
        this.bot.setStatus('heading up to the wheel');
        const ladder = Locs.query().name(this.bot.ladderName()).action(this.bot.climbUpOp()).nearest();
        if (!ladder || ladder.distance() > 1) {
            await walkOpening(this.bot.ladderStand(), 1, this.bot.obstacleList(), m => this.bot.log(m));
        }
        await climbLadder(this.bot, this.bot.ladderName(), this.bot.climbUpOp());
    }
}

export class SpinTask implements Task {
    constructor(private bot: FlaxAIO) {}
    validate(): boolean {
        return this.bot.spinning && Game.tile()?.level === 1 && this.bot.fibreCount() > 0 && !ChatDialog.canContinue();
    }
    async execute(): Promise<void> {
        if (Game.animating() && !ChatDialog.isMakeMenu()) {
            await this.ride();
            return;
        }
        if (!ChatDialog.isMakeMenu()) {
            const wheel = Locs.query()
                .name(this.bot.wheelLocName())
                .action(this.bot.spinOpName())
                .withinOf(this.bot.wheelStand(), this.bot.leashRadius())
                .nearest();
            if (!wheel) {
                await Execution.delayTicks(2);
                return;
            }
            this.bot.setStatus('opening the spinning wheel');
            if (!(await wheel.interact(this.bot.spinOpName()))) {
                await Execution.delayTicks(2);
                return;
            }
            if (!(await Execution.delayUntil(() => ChatDialog.isMakeMenu() || ChatDialog.canContinue() || Game.animating(), 6000))) {
                return;
            }
        }
        if (ChatDialog.isMakeMenu()) {
            if (!(await ChatDialog.makeX(this.bot.flaxName(), this.bot.fibreCount()))) {
                this.bot.log(`Spin menu open but couldn't Make-X '${this.bot.flaxName()}' — products: [${ChatDialog.makeProducts().join(', ')}]`);
                await Execution.delayTicks(2);
                return;
            }
        }
        await this.ride();
    }

    private async ride(): Promise<void> {
        this.bot.setStatus('spinning');
        let last = this.bot.fibreCount();
        let idle = 0;
        while (this.bot.fibreCount() > 0) {
            if (ChatDialog.canContinue() || !this.bot.onFloor(1)) {
                return;
            }
            await Execution.delayTicks(1);
            const now = this.bot.fibreCount();
            if (now < last) {
                this.bot.recordSpun(last - now);
                last = now;
                idle = 0;
            } else if (++idle >= RESPIN_AFTER_TICKS) {
                return;
            }
        }
    }
}

export class DescendTask implements Task {
    constructor(private bot: FlaxAIO) {}
    validate(): boolean {
        return this.bot.spinning && Game.tile()?.level === 1 && this.bot.fibreCount() === 0;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('heading back down');
        await climbLadder(this.bot, this.bot.ladderName(), this.bot.climbDownOp());
    }
}
