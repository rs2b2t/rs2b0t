import { Bank } from '#/bot/api/bank/Bank.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { ENTRANA_RESTRICTED_GEAR_RE } from '#/bot/event/webwalk/exec/specialCrossing.js';
import { DDS_IDS, hardClueKit, SUPERANTI, SHARK_ID, type HardKitSnapshot } from './hardClueKit.js';
import { hardTrailFoodTarget } from './packPlan.js';

export function hardKitSnapshot(includeBank = false): HardKitSnapshot {
    return {
        attack: Skills.level('attack'), lostCity: Quests.status('Lost City') === 'complete',
        items: [...Inventory.items(), ...Equipment.items(), ...(includeBank && Bank.ready() ? Bank.items() : [])]
    };
}

export function hardKitFingerprint(includeBank = false): string {
    const kit = hardKitSnapshot(includeBank);
    const ids = [...DDS_IDS, ...SUPERANTI.map(d => d.id), SHARK_ID];
    return `${kit.attack}:${kit.lostCity}:${ids.map(id => kit.items.filter(i => i.id === id).reduce((n, i) => n + i.count, 0)).join(',')}`;
}

export function ddsWorn(): boolean {
    return Equipment.items().some(i => i.slot === 3 && DDS_IDS.includes(i.id));
}

export async function equipDds(): Promise<boolean> {
    if (ddsWorn()) return true;
    const dagger = DDS_IDS.map(id => Inventory.items().find(i => i.id === id)).find(i => i !== undefined);
    return dagger?.name !== null && dagger !== undefined && await Equipment.equip(dagger.name) && ddsWorn();
}

export async function stockHardWeapon(entrana: boolean, remember: (name: string) => void): Promise<boolean> {
    if (!Bank.ready() || hardClueKit(hardKitSnapshot(true)) !== 'ready') return false;
    const dagger = DDS_IDS.map(id => [...Inventory.items(), ...Equipment.items(), ...Bank.items()].find(i => i.id === id && i.count > 0))
        .find(i => i !== undefined);
    if (!dagger?.name) return false;
    const original = Equipment.items().find(i => i.slot === 3 && !DDS_IDS.includes(i.id));
    if (original?.name) remember(original.name);
    if (!Equipment.contains(dagger.name) && !Inventory.first(dagger.name)) {
        await Bank.withdraw(dagger.name, 'Withdraw-1');
        if (!(await Execution.delayUntil(() => Inventory.first(dagger.name ?? '') !== null, 2500))) return false;
    }
    if (!(await Equipment.equip(dagger.name)) || !ddsWorn()) return false;
    if (entrana && !(await Equipment.unequip(dagger.name))) return false;
    if (!(await Bank.openNearest('Bank booth', 'Use-quickly')) || !(await Bank.waitReady())) return false;
    if (entrana) await Bank.depositAllMatching(name => ENTRANA_RESTRICTED_GEAR_RE.test(name));
    return true;
}

export async function stockHardSupplies(reserveSlots: number, originalGear: readonly string[]): Promise<boolean> {
    if (!Bank.ready()) return false;
    if (!Inventory.items().some(i => SUPERANTI.some(d => d.id === i.id))) {
        const dose = SUPERANTI.find(d => Bank.countById(d.id) > 0);
        if (!dose) return false;
        await Bank.withdraw(dose.name, 'Withdraw-1');
        if (!(await Execution.delayUntil(() => Inventory.items().some(i => i.id === dose.id), 2500))) return false;
    }
    const target = (): number | null => hardTrailFoodTarget({ heldFood: Inventory.count('Shark'), freeSlots: Inventory.free(), reserveSlots });
    const availableTarget = Math.min(20, Inventory.count('Shark') + Bank.countById(SHARK_ID));
    if ((target() ?? 0) < availableTarget) {
        await Bank.depositAllMatching(name => originalGear.includes(name));
    }
    const want = target();
    if (want === null) return false;
    for (let tries = 0; tries < 20 && Inventory.count('Shark') < want; tries++) {
        const before = Inventory.count('Shark');
        const need = want - before;
        await Bank.withdraw('Shark', need >= 10 ? 'Withdraw-10' : need >= 5 ? 'Withdraw-5' : 'Withdraw-1');
        if (!(await Execution.delayUntil(() => Inventory.count('Shark') > before, 2500))) break;
    }
    return Inventory.count('Shark') >= 15;
}
