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
import { SHOPPING_RESERVE, shoppingStops } from './shopping.js';
import { requirementKey, type ActivityPlan, type Requirement } from './types.js';

export class SupplyUnavailableError extends Error {
    readonly items: string[];

    constructor(message: string, items: readonly string[]) {
        super(message);
        this.name = 'SupplyUnavailableError';
        this.items = [...new Set(items.map(item => item.toLowerCase()))];
    }
}

export class SupplyStockError extends SupplyUnavailableError {
    constructor(message: string, items: readonly string[]) {
        super(message, items);
        this.name = 'SupplyStockError';
    }
}

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

export interface ProvisionProgress {
    id: string;
    message: string;
    destination?: WorldTile;
    state: 'running' | 'done';
}

async function bank(port: SupplyPort): Promise<void> {
    if (!(await port.bank())) throw new Error('Could not open a loaded bank');
}

function rebaseConsumables(plan: ActivityPlan, stock: Record<string, number>): void {
    const consumables = plan.needs.filter(need => (need.minimum ?? 0) > 0);
    const units = (need: Requirement) => Math.floor(Math.min(need.count, stock[requirementKey(need).toLowerCase()] ?? 0) / need.minimum!);
    const missing = consumables.filter(need => units(need) === 0);
    if (missing.length) throw new SupplyStockError(`No usable stock of ${missing.map(need => need.item).join(', ')}`, missing.map(need => need.item));
    const mage = plan.script === 'AutoFighter' && plan.settings.combatStyle === 'mage';
    const batch = mage ? Math.min(...consumables.map(units)) : Infinity;
    const carried = mage ? Math.min(batch, ...consumables.map(need => Math.floor((need.carry ?? need.count) / need.minimum!))) : Infinity;
    for (const need of consumables) {
        need.count = Math.min(units(need), batch) * need.minimum!;
        if (need.carry !== undefined) need.carry = Math.min(need.count, Math.floor(need.carry / need.minimum!) * need.minimum!, carried * need.minimum!);
        if (plan.script === 'AutoFighter' && need.item === 'Bronze arrow') plan.settings.ammoWithdraw = need.carry ?? need.count;
        if (plan.script === 'LeatherCrafter' && need.item === 'Thread') plan.settings.threadPerTrip = need.carry ?? need.count;
        if (plan.script === 'Fisher' && need.item === 'Feather') plan.settings.baitQty = need.carry ?? need.count;
    }
    if (mage && consumables.length) plan.settings.runesWithdraw = carried;
}

export interface ProvisionOptions {
    bestEffort?: boolean;
}

export async function provision(plan: ActivityPlan, port: SupplyPort, onProgress?: (progress: ProvisionProgress) => void, options: ProvisionOptions = {}): Promise<void> {
    const report = (id: string, message: string, destination?: WorldTile, state: ProvisionProgress['state'] = 'running') => {
        if (onProgress) onProgress({ id, message, destination, state });
        else port.log(message);
    };
    report('bank:start', 'Opening bank to prepare supplies');
    await bank(port);
    report('bank:start', 'Depositing inventory before checking supplies');
    await port.deposit();
    if (!(await port.closeBank())) throw new Error('Could not close bank to remove equipment');
    for (const name of port.equipment()) {
        report('bank:start', `Removing ${name} before banking equipment`);
        if (!(await port.unequip(name))) throw new Error(`Could not remove ${name}`);
    }
    report('bank:start', 'Banking equipment and checking the shopping list');
    await bank(port);
    await port.deposit();
    report('bank:start', 'Bank inventory checked', undefined, 'done');
    for (const need of plan.needs) {
        const key = requirementKey(need);
        if ((port.stock()[key.toLowerCase()] ?? 0) < need.count && !supplyOffer(need.item)) {
            if (!options.bestEffort) throw new Error(`Need ${need.count} ${need.item} in bank before ${plan.label}`);
            report('bank:start', `Skipping ${need.item}: no shop available`, undefined, 'done');
        }
    }
    for (const stop of shoppingStops(plan.needs, port.stock())) {
        const id = `shop:${stop.keeper}`;
        const missing = (need: Requirement) => Math.max(0, need.count - (port.stock()[requirementKey(need).toLowerCase()] ?? 0));
        const allowance = new Map<string, number>();
        const remaining = (need: Requirement) => Math.min(missing(need), allowance.get(requirementKey(need)) ?? Infinity);
        let attempts = 0;
        while (stop.needs.some(need => remaining(need) > 0)) {
            if (++attempts > 12) {
                if (options.bestEffort) break;
                throw new Error(`Supply batch exceeded at ${stop.keeper}`);
            }
            const travelFood = plan.food && (port.stock()[plan.food.toLowerCase()] ?? 0) >= 3 ? plan.food : null;
            let slots = travelFood ? 24 : 27;
            const batch = stop.needs.flatMap(need => {
                const offer = supplyOffer(need.item)!;
                const count = Math.min(remaining(need), slots > 0 ? offer.item.stackable ? 1000 : slots : 0);
                if (!count) return [];
                slots -= offer.item.stackable ? 1 : count;
                return [{ need, offer, count, banked: need.count - missing(need) }];
            });
            const budget = batch.reduce((sum, entry) => sum + purchaseBudget(entry.offer, entry.count), 0);
            const coins = budget + SHOPPING_RESERVE;
            if ((port.stock().coins ?? 0) < coins) {
                const usable = stop.needs.every(need => missing(need) === 0 || need.minimum && need.count - missing(need) >= need.minimum);
                if (!options.bestEffort && !usable) throw new Error(`Not enough Coins for ${stop.keeper} (budget ${budget}, travel reserve ${SHOPPING_RESERVE})`);
                report(id, `Skipping ${stop.keeper}: insufficient Coins for budget ${budget} plus travel reserve`);
                break;
            }
            report(id, `Withdrawing ${coins} Coins for ${stop.keeper}: ${batch.map(entry => `${entry.count} ${entry.need.item}`).join(', ')}`);
            if (travelFood && !(await port.withdraw(travelFood, 3))) throw new Error('Could not withdraw food for shopping');
            if (!(await port.withdraw('Coins', coins)) || port.held('Coins') < coins) throw new Error('Coin withdrawal did not land');
            if (!(await port.closeBank())) throw new Error('Bank did not close before shopping');
            report(id, `Travelling to ${stop.keeper} for ${batch.map(entry => `${entry.count} ${entry.need.item}`).join(', ')}`, stop.tile);
            try {
                if (!(await port.walk(stop.tile))) throw new SupplyUnavailableError(`Cannot reach ${stop.keeper}`, stop.needs.map(need => need.item));
                const reserve = Math.max(0, SHOPPING_RESERVE - Math.max(0, coins - port.held('Coins')));
                let availableBudget = Math.min(budget, port.held('Coins') - reserve);
                report(id, `Opening ${stop.keeper}'s shop`, stop.tile);
                if (!(await port.shop(stop.keeper))) throw new SupplyUnavailableError(`Cannot trade ${stop.keeper}`, stop.needs.map(need => need.item));
                try {
                    for (const { need, offer, count, banked } of batch) {
                        const key = requirementKey(need);
                        const available = port.shopStock(key);
                        if ((options.bestEffort || need.minimum) && !allowance.has(key)) allowance.set(key, available);
                        if (available <= 0) {
                            if (!options.bestEffort && !need.minimum) throw new SupplyStockError(`${stop.keeper} has no stock of ${need.item}`, [need.item]);
                            allowance.set(key, 0);
                            report(id, `Skipping ${need.item}: ${stop.keeper} has no stock`, stop.tile);
                            continue;
                        }
                        const amount = Math.min(count, available);
                        let cost = 0;
                        for (let i = 0; i < amount; i++) cost += unitPrice(offer.item, offer.shop, available - i);
                        if (cost > availableBudget || cost > port.held('Coins') - reserve) {
                            if (!options.bestEffort) throw new Error(`Cannot afford ${amount} ${need.item} at current shop stock`);
                            allowance.set(key, 0);
                            report(id, `Skipping ${need.item}: current shop price exceeds the purchase budget`, stop.tile);
                            continue;
                        }
                        report(id, `Buying ${amount} ${need.item} from ${stop.keeper} (${banked}/${need.count} banked)`, stop.tile);
                        const before = port.held(key);
                        const beforeCoins = port.held('Coins');
                        await port.buy(key, amount);
                        const bought = Math.max(0, port.held(key) - before);
                        if (!options.bestEffort && !need.minimum && bought === 0) throw new SupplyStockError(`Purchase of ${need.item} did not arrive`, [need.item]);
                        if (options.bestEffort || need.minimum) {
                            allowance.set(key, bought < amount ? 0 : Math.max(0, allowance.get(key)! - bought));
                            if (bought < amount) report(id, `Skipping the remaining ${need.item}: only ${bought}/${amount} purchased`, stop.tile);
                        }
                        availableBudget -= Math.max(0, beforeCoins - port.held('Coins'));
                    }
                } finally {
                    await port.closeShop();
                }
            } catch (error) {
                if (!options.bestEffort && error instanceof SupplyStockError) {
                    await bank(port);
                    await port.deposit();
                    throw error;
                }
                if (!options.bestEffort || !(error instanceof SupplyUnavailableError)) throw error;
                report(id, `${error.message}; skipping this optional supplier`);
                for (const need of stop.needs) allowance.set(requirementKey(need), 0);
            }
            report(id, `Banking purchases from ${stop.keeper}`);
            await bank(port);
            await port.deposit();
        }
        const shortages = stop.needs.filter(need => missing(need) > 0);
        if (shortages.length) report(id, `Deferred: ${shortages.map(need => `${missing(need)} ${need.item}`).join(', ')}`);
        report(id, `${stop.keeper} supplies banked: ${stop.needs.map(need => `${need.count - missing(need)}/${need.count} ${need.item}`).join(', ')}`, undefined, 'done');
    }
    if (options.bestEffort) {
        if (!(await port.closeBank())) throw new Error('Bank did not close after shopping');
        return;
    }
    rebaseConsumables(plan, port.stock());
    report('loadout', `Packing supplies for ${plan.label}`);
    for (const need of plan.needs) {
        const count = need.carry ?? 0;
        const key = requirementKey(need);
        if (count > 0) report('loadout', `Withdrawing ${count} ${need.item} for ${plan.label}`);
        if (count > 0 && (!(await port.withdraw(key, count)) || port.held(key) < count)) throw new Error(`Could not withdraw ${count} usable ${need.item}`);
    }
    if (!(await port.closeBank())) throw new Error('Bank did not close after provisioning');
    report('loadout', `Supplies packed for ${plan.label}`, undefined, 'done');
    report('equip', `Preparing equipment for ${plan.label}`);
    for (const need of plan.needs.filter(n => n.equip)) {
        const key = requirementKey(need);
        report('equip', `Equipping ${need.item}`);
        if (!(await port.equip(key)) || port.worn(key) < (need.carry ?? 1)) throw new Error(`Failed to equip ${need.item}`);
    }
    report('equip', 'Equipment ready', undefined, 'done');
}
