import { Equipment } from '../../api/equipment/Equipment.js';
import { Execution } from '../../api/execution/Execution.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Skills } from '../../api/skills/Skills.js';
import { ITEM_DB } from '../../data/itemdb.js';
import type { Stock } from './policy.js';
import { held, type Supplies } from './supply.js';

const COINS = 995;
const NATURE = 561;
const FIRE = 554;
const EQUIPMENT = /^(Steel|Black|Mithril|Adamant|Rune) (dagger|sword|longsword|scimitar|mace|warhammer|battleaxe|spear|med helm|full helm|chainbody|platebody|platelegs|plateskirt|kiteshield|sq shield|2h sword)$/i;
const LOOT = new Map(ITEM_DB.filter(item => item.slot && EQUIPMENT.test(item.name)).map(item => [item.id, item]));
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
        const baseline = new Map(before);
        const worn = new Set(Equipment.items().map(item => item.id));
        for (const item of Inventory.items()) {
            if (!LOOT.has(item.id) || worn.has(item.id)) baseline.set(item.id, held(item.id));
        }
        for (let attempt = 0; alch && attempt < 28; attempt++) {
            if (EventSignal.pending()) return false;
            if (Skills.effective('magic') < 55 || held(NATURE) < 1 || held(FIRE) < 5) break;
            const item = Inventory.items().find(item => !item.noted && held(item.id) > (baseline.get(item.id) ?? 0)
                && Math.floor((LOOT.get(item.id)?.cost ?? 0) * 0.6) >= 1000);
            if (!item || !(await Game.openSideTab(6))) break;
            if (EventSignal.pending()) return false;
            this.cast = { id: item.id, count: held(item.id), coins: held(COINS), nature: held(NATURE), fire: held(FIRE), value: Math.floor(LOOT.get(item.id)!.cost * 0.6) };
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
