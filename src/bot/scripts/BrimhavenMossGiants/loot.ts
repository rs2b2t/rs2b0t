import { Execution } from '../../api/execution/Execution.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { cfg } from './config.js';
import { eatOnce, findLoot, hasFood, needEatForLoot, shouldEatNow } from './shared.js';
import { Phase, getPhase } from './phase.js';
import type { Task } from '../../api/bot/Bot.js';
import type BrimhavenMossGiants from './BrimhavenMossGiants.js';

/** Grab a single ground drop when there's room. Returns true if something was taken. */
export async function lootOnce(bot: BrimhavenMossGiants): Promise<boolean> {
    const drop = findLoot();
    if (!drop) {
        return false;
    }
    bot.setStatus(`looting ${drop.name}`);
    const before = Inventory.used();
    await drop.interact('Take');
    if (await Execution.delayUntil(() => Inventory.used() > before, 4000)) {
        bot.countLoot(drop.name);
        bot.log(`looted ${drop.name}`);
        return true;
    }
    return false;
}

/** Eat to survive (FIGHT) or to free a slot for loot (LOOT). */
export class Eat implements Task {
    constructor(private bot: BrimhavenMossGiants) {}
    validate(): boolean {
        return (getPhase() === Phase.Fight || getPhase() === Phase.Loot) && shouldEatNow();
    }
    async execute(): Promise<void> {
        await eatOnce(this.bot, needEatForLoot() && !hasFood());
    }
}

/** Clear ground drops, the LOOT phase. */
export class LootCorpse implements Task {
    constructor(private bot: BrimhavenMossGiants) {}
    validate(): boolean {
        return getPhase() === Phase.Loot && !Inventory.isFull() && findLoot() !== null;
    }
    async execute(): Promise<void> {
        await lootOnce(this.bot);
    }
}

/** Bury Big bones in the BURY phase (after looting). */
export class BuryBones implements Task {
    constructor(private bot: BrimhavenMossGiants) {}
    validate(): boolean {
        return getPhase() === Phase.Bury && cfg.buryBones && Inventory.contains('Big bones');
    }
    async execute(): Promise<void> {
        const bones = Inventory.first('Big bones');
        if (!bones) {
            return;
        }
        this.bot.setStatus('burying big bones');
        const before = Inventory.used();
        if (!(await bones.interact('Bury'))) {
            this.bot.log(`no Bury op on big bones? ops=[${bones.actions().join(', ')}]`);
            await Execution.delayTicks(2);
            return;
        }
        if (await Execution.delayUntil(() => Inventory.used() < before, 3000)) {
            this.bot.countBurial();
        }
    }
}
