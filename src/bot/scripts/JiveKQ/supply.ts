import { Bank } from '../../api/bank/Bank.js';
import { Banking } from '../../api/bank/Banking.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { boostFaded } from '../../api/combat/boostPotions.js';
import { Execution } from '../../api/execution/Execution.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Prayer } from '../../api/prayer/Prayer.js';
import { Skills } from '../../api/skills/Skills.js';
import { buyPass } from './route.js';
import { BANK, type Supplies } from './policy.js';
import { ARROWS, DUELING_RINGS, FOOD, GEAR, PASS, tripPack } from './loadout.js';
export { BOW, FOOD, MACE, RECOIL } from './loadout.js';
const BOOSTS = [['defence', 'Super defence'], ['attack', 'Super attack'], ['strength', 'Super strength']];

export function worn(id: number): boolean {
    return Equipment.items().some(i => i.id === id);
}

export async function equip(id: number): Promise<boolean> {
    if (worn(id)) return true;
    if (Bank.isOpen() && !(await Bank.close())) return false;
    const item = Inventory.items().find(i => i.id === id);
    const op = item?.actions().find(o => /wield|wear/i.test(o));
    return !!item && !!op && !!(await item.interact(op)) && await Execution.delayUntil(() => worn(id), 2500);
}

export function doses(prefix: string): number {
    return Inventory.items().reduce((n, i) => n + ((i.name ?? '').startsWith(prefix) ? Number(i.name?.match(/\((\d)\)/)?.[1] ?? 0) * i.count : 0), 0);
}

export async function drink(prefix: string): Promise<boolean> {
    const item = Inventory.items().filter(i => (i.name ?? '').startsWith(prefix)).sort((a, b) => a.id - b.id).find(i => i.actions().includes('Drink'));
    if (!item) return false;
    const before = doses(prefix);
    if (!(await item.interact('Drink'))) return false;
    if (!(await Execution.delayUntilTicks(() => doses(prefix) < before, 3))) return false;
    await Execution.delayTicks(2);
    return true;
}

export async function eat(): Promise<boolean> {
    const before = Inventory.countById(FOOD);
    const item = Inventory.items().find(i => i.id === FOOD);
    if (!item || !(await item.interact('Eat'))) return false;
    return Execution.delayUntilTicks(() => Inventory.countById(FOOD) < before, 2);
}

export async function boost(melee: boolean): Promise<boolean> {
    for (const [skill, potion] of BOOSTS.filter(([skill]) => melee || skill === 'defence')) {
        if (boostFaded(Skills.level(skill), Skills.effective(skill)) && doses(potion) > 0) return drink(potion);
    }
    return false;
}

export function boostsReady(): boolean {
    return BOOSTS.every(([skill]) => Skills.effective(skill) > Skills.level(skill) * 1.1);
}

export function supplies(): Supplies {
    return {
        hp: Skills.effective('hitpoints'), food: Inventory.countById(FOOD), prayer: Prayer.points(), prayerDoses: doses('Prayer potion'),
        escape: Inventory.items().some(i => DUELING_RINGS.includes(i.id)),
        arrows: Equipment.items().find(i => i.id === ARROWS)?.count ?? 0
    };
}

async function open(log: (s: string) => void): Promise<boolean> {
    return await Banking.open({ stand: BANK, preferNearby: false, log }) && await Bank.waitReady(5000, log);
}

class BankInterrupted extends Error {}

async function bankReady(): Promise<void> {
    if (!(await Bank.waitReady(5000))) throw new BankInterrupted();
}

async function withdraw(id: number, count: number): Promise<void> {
    await bankReady();
    const need = count - Inventory.countById(id);
    if (need <= 0) return;
    if (Bank.countById(id) < need) throw new Error(`KQ bank needs ${need} more of item ${id}`);
    if (!(await Bank.withdrawXById(id, need))) {
        await bankReady();
        throw new Error(`KQ could not withdraw item ${id}`);
    }
}

export async function provision(slot: number, log: (s: string) => void): Promise<boolean> {
    try {
        return await prepare(slot, log);
    } catch (error) {
        if (!(error instanceof BankInterrupted)) throw error;
        log('bank: interrupted, retrying KQ supplies');
        return false;
    }
}

async function prepare(slot: number, log: (s: string) => void): Promise<boolean> {
    const pack = tripPack(slot);
    const food = slot === 0 ? 16 : 18;
    await Prayer.clear();
    if (!(await open(log))) return false;
    await Bank.depositAllMatching(() => true);
    await Bank.close();
    for (const item of Equipment.items()) {
        if (!GEAR.includes(item.id)) {
            if (!(await Equipment.unequip(item.name ?? ''))) throw new Error(`Cannot remove ${item.name}`);
        }
    }
    if (!(await open(log))) return false;
    await Bank.depositAllMatching(() => true);
    await Bank.setNoteMode(false);
    for (const id of GEAR) {
        if (!worn(id)) await withdraw(id, id === ARROWS ? 250 : 1);
    }
    await Bank.close();
    for (const id of GEAR) {
        if (!(await equip(id))) throw new Error(`Cannot equip KQ item ${id}; check level and quest requirements`);
    }
    while (Skills.effective('hitpoints') < Skills.level('hitpoints') - 5 || Prayer.points() < Prayer.max() - 5) {
        if (!(await open(log))) return false;
        if (Skills.effective('hitpoints') < Skills.level('hitpoints') - 5) await withdraw(FOOD, 1);
        if (Prayer.points() < Prayer.max() - 5) await withdraw(2434, 1);
        await Bank.close();
        if (Inventory.countById(FOOD) > 0 && !(await eat())) return false;
        if (Prayer.points() < Prayer.max() - 5 && !(await drink('Prayer potion'))) return false;
    }
    if (!(await open(log))) return false;
    await Bank.depositAllMatching(() => true);
    const arrowCount = Equipment.items().find(i => i.id === ARROWS)?.count ?? 0;
    if (arrowCount < 250) await withdraw(ARROWS, 250 - arrowCount);
    for (const [id, count] of pack) {
        await bankReady();
        if (id === PASS) {
            if (Bank.countById(PASS) > 0) await withdraw(PASS, 1);
            else await withdraw(995, 100);
        } else if (id === DUELING_RINGS[0]) {
            const ring = [...DUELING_RINGS].reverse().find(id => Bank.countById(id) > 0);
            if (!ring) throw new Error('KQ bank needs a charged Ring of dueling');
            await withdraw(ring, 1);
        } else await withdraw(id, id === FOOD ? food - 1 : count);
    }
    await Bank.close();
    if (Inventory.countById(ARROWS) > 0) {
        const arrows = Inventory.items().find(i => i.id === ARROWS);
        await arrows?.interact('Wield');
        await Execution.delayUntil(() => Inventory.countById(ARROWS) === 0, 3000);
    }
    if (!(await buyPass(log)) || !(await open(log))) return false;
    await Bank.depositAllMatching(name => name === 'Coins');
    await withdraw(FOOD, food);
    await Bank.close();
    return Inventory.countById(995) === 0 && GEAR.every(worn) && pack.every(([id, count]) => id === DUELING_RINGS[0] ? supplies().escape : Inventory.countById(id) >= count);
}
