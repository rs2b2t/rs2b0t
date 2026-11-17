import { Equipment } from '../../api/equipment/Equipment.js';
import { Execution } from '../../api/execution/Execution.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Skills } from '../../api/skills/Skills.js';
import { ALCH_VALUES, lootBaseline } from './loot-policy.js';
import type { Stock } from './policy.js';
import { counts, held, type Supplies } from './supply.js';

const COINS = 995;
const NATURE = 561;
const FIRE = 554;
type Cast = { id: number; count: number; coins: number; nature: number; fire: number; value: number };

export class LootProcessor {
    private cast: Cast | null = null;

    constructor(private supply: Supplies) {}

    private async settle(): Promise<boolean> {
        const cast = this.cast;
        if (!cast) return true;
        const changed = () => held(cast.id) === cast.count - 1 && held(COINS) === cast.coins + cast.value
            && held(NATURE) === cast.nature - 1 && held(FIRE) === cast.fire - 5;
        await Execution.delayUntil(() => changed() || EventSignal.pending(), 4000);
        const verified = changed();
        if (verified || !EventSignal.pending()) this.cast = null;
        if (verified) await Execution.delayTicks(5);
        return verified;
    }

    async process(before: Stock, alch: boolean): Promise<boolean> {
        if (EventSignal.pending()) return false;
        if (this.cast && !(await this.settle())) alch = false;
        if (EventSignal.pending()) return false;
        const baseline = lootBaseline(before, counts(), new Set(Equipment.items().map(item => item.id)));
        for (let attempt = 0; alch && attempt < 28; attempt++) {
            if (EventSignal.pending()) return false;
            if (Skills.effective('magic') < 55 || held(NATURE) < 1 || held(FIRE) < 5) break;
            const item = Inventory.items().find(item => !item.noted && held(item.id) > (baseline.get(item.id) ?? 0)
                && (ALCH_VALUES.get(item.id) ?? 0) >= 1000);
            if (!item || !(await Game.openSideTab(6))) break;
            if (EventSignal.pending()) return false;
            this.cast = { id: item.id, count: held(item.id), coins: held(COINS), nature: held(NATURE), fire: held(FIRE), value: ALCH_VALUES.get(item.id)! };
            if (!(await Game.castOnItem('High Level Alchemy', item))) {
                this.cast = null;
                break;
            }
            if (!(await this.settle())) break;
        }
        if (EventSignal.pending()) return false;
        return this.supply.sellLoot(baseline);
    }
}
