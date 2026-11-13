import { Execution } from '../../api/execution/Execution.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Prayer } from '../../api/prayer/Prayer.js';
import { Skills } from '../../api/skills/Skills.js';
import { FOOD } from './policy.js';
import { inCatacombs } from './route.js';
import { held, type Supplies } from './supply.js';

export const PRAYER_POTIONS = [
    { id: 2434, doses: 4 }, { id: 139, doses: 3 }, { id: 141, doses: 2 }, { id: 143, doses: 1 }
] as const;

const MELEE = 'Protect from Melee';
type Dose = { id: number; next: number; count: number; nextCount: number; points: number };

export class CombatSupport {
    private running: Promise<boolean> | null = null;
    private shutdown: Promise<void> | null = null;
    private owned = false;
    private dose: Dose | null = null;

    constructor(private supply: Supplies, private enabled: () => boolean) {}

    protected(): boolean {
        return this.enabled() && Prayer.max() >= 43 && Prayer.points() > 0 && Prayer.active(MELEE);
    }

    maintain(): Promise<boolean> {
        if (this.shutdown) return this.shutdown.then(() => false);
        if (this.running) return this.running;
        this.running = this.upkeep().finally(() => { this.running = null; });
        return this.running;
    }

    standDown(): Promise<void> {
        if (this.shutdown) return this.shutdown;
        this.shutdown = (async () => {
            try { await this.running; }
            finally { await this.disable(); }
        })().finally(() => { this.shutdown = null; });
        return this.shutdown;
    }

    private async disable(): Promise<void> {
        if (this.owned && await Prayer.set(MELEE, false)) this.owned = false;
    }

    private async settleDose(): Promise<boolean> {
        const dose = this.dose;
        if (!dose) return true;
        const changed = () => held(dose.id) === dose.count - 1
            && held(dose.next) === dose.nextCount + 1 && Prayer.points() > dose.points;
        await Execution.delayUntil(() => changed() || EventSignal.pending(), 3000);
        const verified = changed();
        if (verified || !EventSignal.pending()) this.dose = null;
        return verified;
    }

    private async restore(): Promise<boolean> {
        const index = PRAYER_POTIONS.findIndex(potion => held(potion.id) > 0);
        if (index < 0) return true;
        const id = PRAYER_POTIONS[index].id;
        const next = PRAYER_POTIONS[index + 1]?.id ?? 229;
        const item = Inventory.items().find(item => item.id === id);
        if (!item) return false;
        this.dose = { id, next, count: held(id), nextCount: held(next), points: Prayer.points() };
        if (!(await item.interact('Drink'))) {
            this.dose = null;
            return false;
        }
        return this.settleDose();
    }

    private async upkeep(): Promise<boolean> {
        if (EventSignal.pending()) return false;
        let restored = !this.dose || await this.settleDose();
        if (EventSignal.pending()) return false;
        if (!(await this.supply.heal()) || EventSignal.pending()) return false;
        const danger = Game.inCombat() || inCatacombs();
        if (this.enabled() && Prayer.max() >= 43 && danger) {
            if (restored && Prayer.points() <= 8) restored = await this.restore();
            if (EventSignal.pending()) return false;
            if (restored && Prayer.available(MELEE) && !Prayer.active(MELEE)) {
                this.owned = true;
                await Prayer.set(MELEE, true);
            }
        } else {
            await this.disable();
        }
        if (EventSignal.pending() || Skills.effective('hitpoints') <= 33) return false;
        return restored && danger && this.protected() || held(FOOD) >= (Game.inCombat() ? 1 : 2);
    }
}
