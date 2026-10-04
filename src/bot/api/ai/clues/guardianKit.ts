import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Game } from '#/bot/api/game/Game.js';
import { GameMessages } from '#/bot/api/chatbox/gameMessages.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { GUARDIAN_MIN_SHARKS, hardClueKit, superantiDoses, SUPERANTI } from './hardClueKit.js';
import { guardianWeaponWorn, equipGuardianWeapon, hardKitSnapshot } from './hardCluePreparation.js';

const POISONED = /you have been poisoned/i;
const IMMUNITY_TICKS = 570;
const REFRESH_TICKS = 540;

export class GuardianProtection {
    private drankAt: number | null = null;
    private poisonMark = GameMessages.mark();

    constructor(private readonly guardian = 'Saradomin Wizard') {}

    async prepare(): Promise<boolean> {
        const needsAntipoison = this.guardian === 'Saradomin Wizard';
        if (hardClueKit(hardKitSnapshot(), GUARDIAN_MIN_SHARKS, needsAntipoison) !== 'ready' || !(await equipGuardianWeapon())) return false;
        return (!needsAntipoison || await this.drink(3)) && guardianWeaponWorn() && Inventory.count('Shark') >= GUARDIAN_MIN_SHARKS;
    }

    private async drink(attempts = 1): Promise<boolean> {
        const before = superantiDoses(Inventory.items());
        if (before === 0) return false;
        const tick = Game.tick();
        let confirmed = false;
        for (let attempt = 0; attempt < attempts; attempt++) {
            if (attempt > 0) {
                await Execution.delayTicks(2);
                if (EventSignal.pending()) return false;
                await Sustain.run();
            }
            if (EventSignal.pending()) return false;
            confirmed = superantiDoses(Inventory.items()) < before;
            if (confirmed) break;
            if (attempts > 1 && (hardClueKit(hardKitSnapshot(), GUARDIAN_MIN_SHARKS) !== 'ready' || !guardianWeaponWorn())) return false;
            const potion = Inventory.items().find(i => SUPERANTI.some(d => d.id === i.id));
            if (!potion) return false;
            confirmed = await potion.interact('Drink') && await Execution.delayUntilTicks(() => superantiDoses(Inventory.items()) < before, 2);
            if (confirmed) break;
        }
        if (!confirmed) return false;
        this.drankAt = tick;
        this.poisonMark = GameMessages.mark();
        // Why: the potion's message_delay runs p_delay(1), which holds the player until tick+2, and OpHeldHandler drops a held op while delayed, so a Dig sent the tick after the dose lands never fires.
        await Execution.delayTicks(3);
        return true;
    }

    async maintain(): Promise<'ready' | 'drank' | 'supplies-needed'> {
        if (this.guardian !== 'Saradomin Wizard') return 'ready';
        const age = this.drankAt === null ? Infinity : Game.tick() - this.drankAt;
        const poisoned = GameMessages.sawSince(this.poisonMark, POISONED);
        if (age >= 0 && age < REFRESH_TICKS && !poisoned) return 'ready';
        if (await this.drink()) return 'drank';
        return !poisoned && age >= 0 && age < IMMUNITY_TICKS ? 'ready' : 'supplies-needed';
    }
}
