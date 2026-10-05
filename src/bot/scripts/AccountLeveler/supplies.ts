import { reader, type WorldTile } from '../../adapter/ClientAdapter.js';
import { Bank } from '../../api/bank/Bank.js';
import { Banking } from '../../api/bank/Banking.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Execution } from '../../api/execution/Execution.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Shop } from '../../api/shop/Shop.js';
import { unitPrice } from '../../api/shop/StockModel.js';
import { Traversal } from '../../api/walking/Traversal.js';
import Tile from '../../geometry/Tile.js';
import { purchaseBudget, supplyOffer } from './offers.js';
import { requirementKey, type ActivityPlan } from './types.js';

export interface CountedItem { name: string | null; id: number; count: number; noted?: boolean }

export function stockCounts(items: readonly CountedItem[]): Record<string, number> {
    const result: Record<string, number> = {};
    for (const item of items) {
        if (item.noted) continue;
        for (const key of [`#${item.id}`, ...(item.name ? [item.name.toLowerCase()] : [])]) result[key] = (result[key] ?? 0) + item.count;
    }
    return result;
}

export interface SupplyPort {
    bank(): Promise<boolean>;
    deposit(): Promise<void>;
    stock(): Record<string, number>;
    held(name: string): number;
    worn(name: string): number;
    equipment(): string[];
    unequip(name: string): Promise<boolean>;
    withdraw(name: string, count: number): Promise<boolean>;
    closeBank(): Promise<boolean>;
    walk(tile: WorldTile): Promise<boolean>;
    shop(keeper: string): Promise<boolean>;
    shopStock(name: string): number;
    buy(name: string, count: number): Promise<number>;
    closeShop(): Promise<void>;
    equip(name: string): Promise<boolean>;
    log(message: string): void;
}

export function gameSupplyPort(log: (message: string) => void): SupplyPort {
    return {
        bank: async () => {
            if (!(await Banking.open({ log })) || !(await Bank.waitReady())) return false;
            await Bank.setNoteMode(false);
            return true;
        },
        deposit: async () => {
            await Bank.depositInventory();
            if (!(await Execution.delayUntil(() => Inventory.used() === 0, 4000))) throw new Error('Inventory did not empty at the bank');
        },
        stock: () => stockCounts(Bank.items()),
        held: name => stockCounts(Inventory.items())[name.toLowerCase()] ?? 0,
        worn: name => stockCounts(Equipment.items())[name.toLowerCase()] ?? 0,
        equipment: () => Equipment.items().flatMap(i => i.name ? [i.name] : []),
        unequip: name => Equipment.unequip(name),
        withdraw: (name, count) => name.startsWith('#') ? Bank.withdrawXById(Number(name.slice(1)), count) : Bank.withdrawX(name, count),
        closeBank: () => Bank.close(),
        walk: tile => Traversal.walkResilient(new Tile(tile.x, tile.z, tile.level), { radius: 3, timeoutMs: 120000, log }),
        shop: keeper => Shop.open(keeper),
        shopStock: name => name.startsWith('#')
            ? reader.shopInv(3900).find(i => i.id === Number(name.slice(1)))?.count ?? 0
            : Shop.stock().find(i => i.name.toLowerCase() === name.toLowerCase())?.count ?? 0,
        buy: (name, count) => name.startsWith('#') ? Shop.buyById(Number(name.slice(1)), count) : Shop.buy(name, count),
        closeShop: () => Shop.close(),
        equip: async name => {
            if (!name.startsWith('#')) return Equipment.equip(name);
            const id = Number(name.slice(1));
            if (Equipment.items().some(item => item.id === id)) return true;
            const item = Inventory.items().find(item => item.id === id && !item.noted);
            const op = item?.actions().find(op => /wield|wear|equip/i.test(op));
            if (!item || !op || !(await item.interact(op))) return false;
            return Execution.delayUntil(() => Equipment.items().some(item => item.id === id), 3000);
        },
        log
    };
}

async function bank(port: SupplyPort): Promise<void> {
    if (!(await port.bank())) throw new Error('Could not open a loaded bank');
}

export async function provision(plan: ActivityPlan, port: SupplyPort): Promise<void> {
    await bank(port);
    await port.deposit();
    if (!(await port.closeBank())) throw new Error('Could not close bank to remove equipment');
    for (const name of port.equipment()) {
        if (!(await port.unequip(name))) throw new Error(`Could not remove ${name}`);
    }
    await bank(port);
    await port.deposit();
    for (const need of plan.needs) {
        const key = requirementKey(need);
        let attempts = 0;
        while ((port.stock()[key.toLowerCase()] ?? 0) < need.count) {
            if (++attempts > 12) throw new Error(`Supply batch exceeded for ${need.item}`);
            const offer = supplyOffer(need.item);
            if (!offer) throw new Error(`Need ${need.count} ${need.item} in bank before ${plan.label}`);
            const missing = need.count - (port.stock()[key.toLowerCase()] ?? 0);
            const travelFood = plan.food && (port.stock()[plan.food.toLowerCase()] ?? 0) >= 3 ? plan.food : null;
            const count = Math.min(missing, offer.item.stackable ? 1000 : travelFood ? 24 : 27);
            const budget = purchaseBudget(offer, count);
            if ((port.stock().coins ?? 0) < budget) throw new Error(`Not enough Coins to buy ${need.item} (budget ${budget})`);
            if (travelFood && !(await port.withdraw(travelFood, 3))) throw new Error('Could not withdraw food for shopping');
            if (!(await port.withdraw('Coins', budget)) || port.held('Coins') < budget) throw new Error('Coin withdrawal did not land');
            if (!(await port.closeBank())) throw new Error('Bank did not close before shopping');
            if (!(await port.walk(offer.tile))) throw new Error(`Cannot reach ${offer.keeper}`);
            if (!(await port.shop(offer.keeper))) throw new Error(`Cannot trade ${offer.keeper}`);
            try {
                const available = port.shopStock(key);
                if (available <= 0) throw new Error(`${offer.keeper} has no stock of ${need.item}`);
                const amount = Math.min(count, available);
                let cost = 0;
                for (let i = 0; i < amount; i++) cost += unitPrice(offer.item, offer.shop, available - i);
                if (cost > port.held('Coins')) throw new Error(`Cannot afford ${amount} ${need.item} at current shop stock`);
                port.log(`buying ${amount} ${need.item} from ${offer.keeper}`);
                const before = port.held(key);
                await port.buy(key, amount);
                if (port.held(key) <= before) throw new Error(`Purchase of ${need.item} did not arrive`);
            } finally {
                await port.closeShop();
            }
            await bank(port);
            await port.deposit();
        }
    }
    for (const need of plan.needs) {
        const count = need.carry ?? 0;
        const key = requirementKey(need);
        if (count > 0 && (!(await port.withdraw(key, count)) || port.held(key) < count)) throw new Error(`Could not withdraw ${count} usable ${need.item}`);
    }
    if (!(await port.closeBank())) throw new Error('Bank did not close after provisioning');
    for (const need of plan.needs.filter(n => n.equip)) {
        const key = requirementKey(need);
        if (!(await port.equip(key)) || port.worn(key) < (need.carry ?? 1)) throw new Error(`Failed to equip ${need.item}`);
    }
}
