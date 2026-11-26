import { carveFlaxPocket, flaxAt, flaxBlocksExit } from '../../api/acquisition/flaxPocket.js';
import type { Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Locs, type Loc } from '../../api/locs/Locs.js';
import { Reachability } from '../../event/webwalk/geometry/Reachability.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { travelTo } from './walking.js';
import type FlaxAIO from './flaxaio.js';


export function atField(bot: FlaxAIO): boolean {
    const here = Game.tile();
    return here !== null && bot.fieldCentre().distanceTo(here) <= bot.fieldScope();
}

export function nearestFlax(bot: FlaxAIO): Loc | null {
    const me = Game.tile();
    const flax = Locs.query()
        .name(bot.flaxName())
        .action(bot.pickOpName())
        .where(l => l.tile().distanceTo(bot.fieldCentre()) <= bot.fieldScope())
        .results();
    if (flax.length === 0) {
        return null;
    }
    if (me) {
        flax.sort((a, b) => a.tile().distanceTo(me) - b.tile().distanceTo(me));
    }
    for (const f of flax) {
        if (Reachability.canReach(f.tile(), { adjacentOk: true, maxSteps: 400 })) {
            return f;
        }
    }
    return null;
}

function flaxLocAt(bot: FlaxAIO, x: number, z: number, level: number): Loc | null {
    return flaxAt(bot.flaxName(), bot.pickOpName(), x, z, level);
}

export function boxedByFlax(bot: FlaxAIO): boolean {
    if (!Inventory.isFull()) {
        return false;
    }
    return flaxBlocksExit(bot.flaxName(), bot.pickOpName());
}

export async function carveOut(bot: FlaxAIO): Promise<void> {
    bot.setStatus('boxed in by flax — carving a way out');
    bot.log('boxed in by flax with a full pack — dropping flax to pick a way out');
    await carveFlaxPocket({
        name: bot.flaxName(), op: bot.pickOpName(), gate: bot.fieldGate(),
        timing: 'time', log: m => bot.log(m)
    });
}

export class EscapeFlaxTrap implements Task {
    constructor(private bot: FlaxAIO) {}
    validate(): boolean {
        return this.bot.picking && boxedByFlax(this.bot);
    }
    async execute(): Promise<void> {
        await carveOut(this.bot);
    }
}

export class PickTask implements Task {
    constructor(private bot: FlaxAIO) {}
    validate(): boolean {
        return this.bot.picking && !Inventory.isFull() && atField(this.bot) && nearestFlax(this.bot) !== null;
    }
    async execute(): Promise<void> {
        for (let n = 0; n < 30 && !Inventory.isFull(); n++) {
            if (ChatDialog.canContinue()) {
                return;
            }
            const flax = nearestFlax(this.bot);
            if (!flax) {
                return;
            }
            const target = flax.tile();
            this.bot.setStatus(`picking ${this.bot.flaxName()} at ${target}`);
            const before = this.bot.flaxCount();
            if (!(await flax.interact(this.bot.pickOpName()))) {
                await Execution.delayTicks(2);
                continue;
            }
            await Execution.delayUntil(
                () => this.bot.flaxCount() > before || Inventory.isFull() || ChatDialog.canContinue() || flaxLocAt(this.bot, target.x, target.z, target.level) === null,
                6000
            );
        }
    }
}

export class GoToFieldTask implements Task {
    constructor(private bot: FlaxAIO) {}
    validate(): boolean {
        return this.bot.picking && !Inventory.isFull() && nearestFlax(this.bot) === null;
    }
    async execute(): Promise<void> {
        const here = Game.tile();
        if (here && this.bot.fieldCentre().distanceTo(here) <= this.bot.fieldArrive()) {
            await Execution.delayTicks(2);
            return;
        }
        this.bot.setStatus('travelling to the flax field');
        await travelTo(this.bot, this.bot.fieldCentre(), this.bot.fieldArrive());
    }
}
