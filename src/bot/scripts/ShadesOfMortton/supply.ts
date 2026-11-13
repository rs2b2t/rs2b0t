import { SM_NPC, SM_TILE } from '../../api/ai/quests/defs/mortton/areas.js';
import { driveOnce } from '../../api/ai/quests/defs/mortton/town.js';
import { AXES } from '../../api/acquisition/Tools.js';
import { Bank } from '../../api/bank/Bank.js';
import { Banking } from '../../api/bank/Banking.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Execution } from '../../api/execution/Execution.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Locs } from '../../api/locs/Locs.js';
import { Npcs } from '../../api/npcs/Npcs.js';
import { Shop } from '../../api/shop/Shop.js';
import { Skills } from '../../api/skills/Skills.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Modals } from '../../api/ui/widgets/Modals.js';
import { Traversal } from '../../api/walking/Traversal.js';
import Tile from '../../geometry/Tile.js';
import { combinePair, FOOD, FOOD_LOAD, OIL, type Stock } from './policy.js';

export const held = (id: number): number => Inventory.countById(id);
export const counts = (): Map<number, number> => new Map(Inventory.items().map(item => [item.id, held(item.id)]));
const MAGIC_LOGS = 1513;
const RAW_LOBSTER = 377;
const CAGE = 301;
const ARHEIN = new Tile(2804, 3429, 0);

export class Supplies {
    stock: Stock = new Map();

    constructor(readonly log: (message: string) => void) {}

    async walk(tile: Tile, radius = 2): Promise<boolean> {
        if (EventSignal.pending()) return false;
        await Modals.closeIfOpen();
        return Traversal.walkResilient(tile, { radius, attempts: 3, timeoutMs: 240000, log: this.log });
    }

    async bank(): Promise<boolean> {
        if (!(await Banking.open({ log: this.log })) || !(await Bank.waitReady())) return false;
        await Bank.depositInventory();
        if (!(await Execution.delayUntil(() => Inventory.used() === 0, 5000))) return false;
        await Bank.setNoteMode(false);
        this.stock = new Map(Bank.items().map(item => [item.id, item.count]));
        return true;
    }

    async take(id: number, count: number, optional = false): Promise<boolean> {
        const qty = Math.min(count, Bank.countById(id));
        if (!qty) return optional;
        if (qty < count && !optional) return false;
        const before = held(id);
        return await Bank.withdrawXById(id, qty)
            && await Execution.delayUntil(() => held(id) >= before + qty, 5000);
    }

    async pack(order: readonly (readonly [number, number])[]): Promise<boolean> {
        for (const [id, qty] of order) {
            if (qty > 0 && !(await this.take(id, qty))) {
                this.log(`Could not withdraw ${qty} of item ${id}`);
                return false;
            }
        }
        return Bank.close();
    }

    async heal(): Promise<boolean> {
        const missing = Skills.level('hitpoints') - Skills.effective('hitpoints');
        if (missing < 12 || held(FOOD) === 0) return true;
        const item = Inventory.items().find(item => item.id === FOOD);
        if (!item) return false;
        const before = held(FOOD);
        if (!(await item.interact('Eat'))) return false;
        return Execution.delayUntil(() => held(FOOD) < before, 3000);
    }

    async combatReady(): Promise<boolean> {
        if (EventSignal.pending()) return false;
        await this.heal();
        return Skills.effective('hitpoints') > 33 && held(FOOD) >= (Game.inCombat() ? 1 : 2);
    }

    async food(): Promise<boolean> {
        if (!(await this.bank())) return false;
        const raw = Math.min(24, Bank.countById(RAW_LOBSTER));
        if (raw > 0) {
            if (!(await this.pack([[RAW_LOBSTER, raw]]))) return false;
        } else {
            if (!Bank.countById(CAGE)) throw new Error('Bank a lobster pot before running ShadesOfMortton');
            if (!(await this.pack([[CAGE, 1]]))) return false;
            const shore = new Tile(2845, 3431, 0);
            if (!(await this.walk(shore))) return false;
            let idle = 0;
            for (let ticks = 0; ticks < 3000 && held(RAW_LOBSTER) < 24; ticks++) {
                if (EventSignal.pending()) return false;
                if (ChatDialog.canContinue()) await ChatDialog.continue();
                if (!Game.animating() && ++idle >= 5) {
                    const spot = Npcs.query().action('Cage').within(35).nearest();
                    if (spot) await spot.interact('Cage');
                    else if (!(await this.walk(shore))) return false;
                    idle = 0;
                }
                await Execution.delayTicks(1);
            }
        }
        if (!held(RAW_LOBSTER) || !(await this.walk(new Tile(2817, 3443, 0), 0))) return false;
        const before = held(FOOD);
        for (let attempt = 0; attempt < 70 && held(RAW_LOBSTER) > 0; attempt++) {
            if (EventSignal.pending()) return false;
            if (ChatDialog.canContinue()) await ChatDialog.continue();
            const rawCount = held(RAW_LOBSTER);
            const fish = Inventory.items().find(item => item.id === RAW_LOBSTER);
            const range = Locs.query().name('Range').within(4).nearest();
            if (!fish || !range || !(await fish.useOn(range))) return false;
            await Execution.delayUntil(() => held(RAW_LOBSTER) < rawCount || ChatDialog.isMakeMenu(), 6000);
            if (ChatDialog.isMakeMenu()) await ChatDialog.make();
            await Execution.delayUntil(() => held(RAW_LOBSTER) < rawCount || EventSignal.pending(), 6000);
        }
        const gained = held(FOOD) - before;
        this.log(`Cooked ${gained} lobsters`);
        return gained > 0;
    }

    async logs(sell = false): Promise<boolean> {
        if (!(await this.bank())) return false;
        const axe = AXES.find(axe => Equipment.contains(axe.name) || Bank.count(axe.name) > 0);
        if (!axe) throw new Error('Bank a working axe before running ShadesOfMortton');
        if (!Equipment.contains(axe.name) && !(await Bank.withdrawX(axe.name, 1))) return false;
        await Bank.close();
        const trees = new Tile(2702, 3398, 0);
        if (!(await this.walk(trees, 4))) return false;
        let idle = 0;
        for (let ticks = 0; ticks < 5000 && held(MAGIC_LOGS) < 24; ticks++) {
            if (EventSignal.pending()) return false;
            if (ChatDialog.canContinue()) await ChatDialog.continue();
            if (!Game.animating() && ++idle >= 5) {
                const tree = Locs.query().name('Magic tree', 'Magic trees').action('Chop down').within(20).nearest();
                if (tree) await tree.interact('Chop down');
                idle = 0;
            }
            await Execution.delayTicks(1);
        }
        const gathered = held(MAGIC_LOGS);
        this.log(`Gathered ${gathered} magic logs${sell ? ' for supplies' : ''}`);
        if (!sell) return gathered > 0;
        if (!gathered || !(await this.walk(ARHEIN)) || !(await Shop.open('Arhein'))) return false;
        const before = held(995);
        const sold = await Shop.sell('Magic logs', gathered);
        await Shop.close();
        this.log(`Sold ${sold} gathered logs for ${held(995) - before} coins`);
        return sold > 0 && held(995) > before;
    }

    async combine(ids: readonly number[] = OIL): Promise<boolean> {
        for (let tries = 0; tries < 40; tries++) {
            if (EventSignal.pending()) return false;
            const pair = combinePair(Inventory.items(), ids);
            if (!pair) return true;
            const first = Inventory.items().find(item => item.slot === pair[0]);
            const second = Inventory.items().find(item => item.slot === pair[1]);
            if (!first || !second) return false;
            const before = Inventory.items().map(item => `${item.slot}:${item.id}`).join(',');
            if (!(await first.useOn(second))) return false;
            if (!(await Execution.delayUntil(() => Inventory.items().map(item => `${item.slot}:${item.id}`).join(',') !== before, 5000))) return false;
        }
        return false;
    }

    async make(count: number): Promise<boolean> {
        if (!(await this.bank())) return false;
        if (!(await this.take(MAGIC_LOGS, count))) return false;
        let need = count * 4;
        for (let i = 0; i < OIL.length && need > 0; i++) {
            const qty = Math.min(Bank.countById(OIL[i]), Math.ceil(need / (4 - i)), Inventory.free());
            if (qty > 0 && !(await this.take(OIL[i], qty))) return false;
            need -= qty * (4 - i);
        }
        await Bank.close();
        if (!(await this.combine())) return false;
        const before = held(3448);
        for (let i = 0; i < count && held(OIL[0]) > 0 && held(MAGIC_LOGS) > 0; i++) {
            if (EventSignal.pending()) return false;
            const oil = Inventory.items().find(item => item.id === OIL[0]);
            const logs = Inventory.items().find(item => item.id === MAGIC_LOGS);
            const previous = held(3448);
            if (!oil || !logs || !(await oil.useOn(logs))) return false;
            if (!(await Execution.delayUntil(() => held(3448) > previous, 5000))) return false;
        }
        return held(3448) > before;
    }

    async sellLoot(before: Stock): Promise<boolean> {
        const loot = Inventory.items().filter(item => held(item.id) > (before.get(item.id) ?? 0)
            && /^(Steel|Black|Mithril|Adamant|Rune) (dagger|sword|longsword|scimitar|mace|warhammer|battleaxe|spear|med helm|full helm|chainbody|platebody|platelegs|plateskirt|kiteshield|sq shield|2h sword)/i.test(item.name ?? ''));
        if (!loot.length) return true;
        if (!(await this.walk(SM_TILE.RAZMIRE))) return false;
        const afflicted = Npcs.query().name(SM_NPC.RAZMIRE_AFFLICTED).within(12).nearest();
        if (afflicted) {
            const op = afflicted.actions().find(op => /talk/i.test(op));
            if (op && await afflicted.interact(op)) {
                await Execution.delayUntil(() => ChatDialog.canContinue() || ChatDialog.isOpen(), 5000);
                await driveOnce(['Ok'], this.log);
            }
        }
        const shopkeeper = Npcs.query().name(SM_NPC.RAZMIRE).action('Trade-General-Store').within(12).nearest();
        if (!shopkeeper || !(await shopkeeper.interact('Trade-General-Store'))
            || !(await Execution.delayUntil(() => Shop.isOpen(), 5000))) return false;
        for (const item of loot) {
            await Shop.sell(item.name!, held(item.id) - (before.get(item.id) ?? 0), entry => entry.id === item.id);
        }
        await Shop.close();
        return true;
    }

    async loadFood(qty = FOOD_LOAD): Promise<boolean> {
        return this.take(FOOD, qty);
    }

    async loadTools(): Promise<boolean> {
        for (const id of [590, 2347]) {
            if (!(await this.take(id, 1))) throw new Error(`Bank a ${id === 590 ? 'tinderbox' : 'hammer'} before running ShadesOfMortton`);
        }
        return true;
    }


}
