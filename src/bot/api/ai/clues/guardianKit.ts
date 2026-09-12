import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { GameMessages } from '#/bot/api/chatbox/gameMessages.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { hardClueKit, superantiDoses, SUPERANTI } from './hardClueKit.js';
import { equipDds, hardKitSnapshot } from './hardCluePreparation.js';

const POISONED = /you have been poisoned/i;
const IMMUNITY_TICKS = 570;
const REFRESH_TICKS = 540;

export class GuardianProtection {
    private drankAt: number | null = null;
    private poisonMark = GameMessages.mark();

    async prepare(): Promise<boolean> {
        if (hardClueKit(hardKitSnapshot()) !== 'ready' || !(await equipDds())) return false;
        return this.drink();
    }

    private async drink(): Promise<boolean> {
        const potion = Inventory.items().find(i => SUPERANTI.some(d => d.id === i.id));
        if (!potion) return false;
        const before = superantiDoses(Inventory.items());
        const tick = Game.tick();
        if (!(await potion.interact('Drink'))) return false;
        const confirmed = await Execution.delayUntilTicks(() => superantiDoses(Inventory.items()) < before, 2);
        if (!confirmed) return false;
        this.drankAt = tick;
        this.poisonMark = GameMessages.mark();
        await Execution.delayTicks(1);
        return true;
    }

    async maintain(): Promise<'ready' | 'drank' | 'supplies-needed'> {
        const age = this.drankAt === null ? Infinity : Game.tick() - this.drankAt;
        const poisoned = GameMessages.sawSince(this.poisonMark, POISONED);
        if (age >= 0 && age < REFRESH_TICKS && !poisoned) return 'ready';
        if (await this.drink()) return 'drank';
        return !poisoned && age >= 0 && age < IMMUNITY_TICKS ? 'ready' : 'supplies-needed';
    }
}
