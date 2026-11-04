import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Game } from '#/bot/api/game/Game.js';
import { GameMessages } from '#/bot/api/chatbox/gameMessages.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Prayer, PROTECT_FROM_MAGIC } from '#/bot/api/prayer/Prayer.js';
import { GUARDIAN_MIN_SHARKS, hardClueKit, superantiDoses, SUPERANTI, type GuardianRangedLoadout } from './hardClueKit.js';
import { guardianWeaponWorn, equipGuardianWeapon, hardKitSnapshot } from './hardCluePreparation.js';

const POISONED = /you have been poisoned/i;
const IMMUNITY_TICKS = 570;
const REFRESH_TICKS = 540;
export const CLUE_PRAYER_POTIONS = [{ id: 2434, doses: 4 }, { id: 139, doses: 3 }, { id: 141, doses: 2 }, { id: 143, doses: 1 }] as const;

export async function maintainGuardianPrayer(activate = true): Promise<boolean> {
    const floor = Math.max(8, Math.ceil(Prayer.max() * 0.2));
    if (Prayer.points() <= floor) {
        const doseCount = (): number => Inventory.items().reduce((sum, item) => sum + item.count * (CLUE_PRAYER_POTIONS.find(p => p.id === item.id)?.doses ?? 0), 0);
        const before = doseCount();
        const points = Prayer.points();
        const potion = Inventory.items().find(i => !i.noted && CLUE_PRAYER_POTIONS.some(p => p.id === i.id));
        if (!potion || !(await potion.interact('Drink'))
            || !(await Execution.delayUntilTicks(() => doseCount() < before && Prayer.points() > points, 2))) return false;
    }
    return Prayer.points() > floor && (!activate || await Prayer.set(PROTECT_FROM_MAGIC, true) && Prayer.active(PROTECT_FROM_MAGIC));
}

export class GuardianProtection {
    private drankAt: number | null = null;
    private poisonMark = GameMessages.mark();

    constructor(private readonly guardian = 'Saradomin Wizard', readonly ranged?: GuardianRangedLoadout, private readonly byHost = false) {}

    weaponReady(): boolean {
        return guardianWeaponWorn(this.ranged);
    }

    async prepare(): Promise<boolean> {
        const needsAntipoison = !this.byHost && this.guardian === 'Saradomin Wizard';
        if (hardClueKit(hardKitSnapshot(false, this.ranged), GUARDIAN_MIN_SHARKS, needsAntipoison) !== 'ready' || !(await equipGuardianWeapon(this.ranged))) return false;
        return (!needsAntipoison || await this.drink(3)) && await this.prayerReady()
            && this.weaponReady() && Inventory.count('Shark') >= GUARDIAN_MIN_SHARKS;
    }

    async prayerReady(): Promise<boolean> {
        if (!this.byHost) return maintainGuardianPrayer();
        if (!Sustain.hook) return false;
        await Sustain.run();
        return Prayer.points() > Math.max(8, Math.ceil(Prayer.max() * 0.2)) && Prayer.active(PROTECT_FROM_MAGIC);
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
            if (attempts > 1 && (hardClueKit(hardKitSnapshot(false, this.ranged), GUARDIAN_MIN_SHARKS) !== 'ready' || !this.weaponReady())) return false;
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
        if (!(await this.prayerReady())) return 'supplies-needed';
        if (this.byHost) return 'ready';
        if (this.guardian !== 'Saradomin Wizard') return 'ready';
        const age = this.drankAt === null ? Infinity : Game.tick() - this.drankAt;
        const poisoned = GameMessages.sawSince(this.poisonMark, POISONED);
        if (age >= 0 && age < REFRESH_TICKS && !poisoned) return 'ready';
        if (await this.drink()) return 'drank';
        return !poisoned && age >= 0 && age < IMMUNITY_TICKS ? 'ready' : 'supplies-needed';
    }
}
