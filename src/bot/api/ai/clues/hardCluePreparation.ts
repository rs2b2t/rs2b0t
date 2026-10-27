import { openClueBank } from './bankAccess.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { ENTRANA_RESTRICTED_GEAR_RE } from '#/bot/event/webwalk/exec/specialCrossing.js';
import { GUARDIAN_WEAPON_IDS, hardClueKit, rangedWeaponId, SUPERANTI, SHARK_ID, MIN_SHARKS, type HardKitSnapshot, type GuardianRangedLoadout } from './hardClueKit.js';
import { hardTrailFoodTarget } from './packPlan.js';

export function hardKitSnapshot(includeBank = false, ranged?: GuardianRangedLoadout): HardKitSnapshot {
    return {
        attack: Skills.level('attack'), lostCity: Quests.status('Lost City') === 'complete',
        ranged,
        items: [...Inventory.items(), ...Equipment.items(), ...(includeBank && Bank.ready() ? Bank.items() : [])].filter(i => !i.noted)
    };
}

export function hardKitFingerprint(includeBank = false, ranged?: GuardianRangedLoadout): string {
    const kit = hardKitSnapshot(includeBank, ranged);
    const ids = [...GUARDIAN_WEAPON_IDS, ...SUPERANTI.map(d => d.id), SHARK_ID];
    const weaponCount = ranged ? kit.items.filter(i => i.id === rangedWeaponId(ranged.weapon)).reduce((n, i) => n + i.count, 0) : 0;
    const ammoCount = ranged ? kit.items.filter(i => i.name?.toLowerCase() === ranged.ammo.toLowerCase()).reduce((n, i) => n + i.count, 0) : 0;
    const range = ranged ? `${ranged.weapon}:${weaponCount}:${ranged.ammo}:${ammoCount}` : '';
    return `${kit.attack}:${kit.lostCity}:${ids.map(id => kit.items.filter(i => i.id === id).reduce((n, i) => n + i.count, 0)).join(',')}:${range}`;
}

export function guardianWeaponWorn(ranged?: GuardianRangedLoadout): boolean {
    if (ranged) {
        return Equipment.items().some(i => i.slot === 3 && i.id === rangedWeaponId(ranged.weapon) && i.count > 0)
            && Equipment.items().some(i => i.slot === 13 && i.name?.toLowerCase() === ranged.ammo.toLowerCase() && i.count > 0);
    }
    return Equipment.items().some(i => i.slot === 3 && GUARDIAN_WEAPON_IDS.includes(i.id) && i.count > 0);
}

export async function equipGuardianWeapon(ranged?: GuardianRangedLoadout): Promise<boolean> {
    if (ranged) {
        if (Bank.isOpen() && !(await Bank.close())) return false;
        const id = rangedWeaponId(ranged.weapon);
        const worn = (): boolean => Equipment.items().some(i => i.slot === 3 && i.id === id && i.count > 0);
        if (!worn()) {
            const weapon = Inventory.items().find(i => i.id === id && !i.noted);
            if (!weapon || !(await weapon.interact('Wield')) || !(await Execution.delayUntil(worn, 2500))) return false;
        }
        const ammo = Inventory.first(ranged.ammo);
        if (ammo && !ammo.noted) {
            const count = (): number => Equipment.items().filter(i => i.slot === 13 && i.name?.toLowerCase() === ranged.ammo.toLowerCase()).reduce((n, i) => n + i.count, 0);
            const target = count() + ammo.count;
            if (!(await ammo.interact('Wield')) || !(await Execution.delayUntil(() => count() >= target, 2500))) return false;
        }
        return guardianWeaponWorn(ranged);
    }
    if (guardianWeaponWorn()) return true;
    const weapon = GUARDIAN_WEAPON_IDS.map(id => Inventory.items().find(i => i.id === id && i.count > 0)).find(i => i !== undefined);
    return !!weapon?.name && await Equipment.equip(weapon.name) && guardianWeaponWorn();
}

export async function stockHardWeapon(entrana: boolean, remember: (name: string) => void, preferredWeapon?: string, minimumSharks = MIN_SHARKS, ranged?: GuardianRangedLoadout): Promise<boolean> {
    if (!Bank.ready() || hardClueKit(hardKitSnapshot(true, ranged), minimumSharks) !== 'ready') return false;
    const current = Equipment.items().find(i => i.slot === 3 && i.count > 0);
    if (ranged) {
        if (entrana) return true;
        if (current?.name && current.name.toLowerCase() !== ranged.weapon.toLowerCase()) remember(current.name);
        const id = rangedWeaponId(ranged.weapon);
        if (id === undefined) return false;
        if (![...Inventory.items(), ...Equipment.items()].some(i => i.id === id && !i.noted && i.count > 0)) {
            if (!(await Bank.withdrawById(id, 'Withdraw-1'))
                || !(await Execution.delayUntil(() => Inventory.countById(id) > 0, 2500))) return false;
        }
        const owned = [...Inventory.items(), ...Equipment.items()].filter(i => i.name?.toLowerCase() === ranged.ammo.toLowerCase()).reduce((n, i) => n + i.count, 0);
        const target = Math.min(Math.max(1, ranged.quantity), owned + Bank.count(ranged.ammo));
        if (owned < target && !(await Bank.withdrawX(ranged.ammo, target - owned))) return false;
        return await equipGuardianWeapon(ranged) && await openClueBank() && await Bank.waitReady();
    }
    const available = [...Inventory.items(), ...Bank.items()].filter(i => GUARDIAN_WEAPON_IDS.includes(i.id) && i.count > 0);
    const weapon = current && GUARDIAN_WEAPON_IDS.includes(current.id) ? current
        : available.find(i => i.name?.toLowerCase() === preferredWeapon?.toLowerCase())
            ?? GUARDIAN_WEAPON_IDS.map(id => available.find(i => i.id === id)).find(i => i !== undefined);
    if (!weapon?.name) return false;
    if (current?.name && !GUARDIAN_WEAPON_IDS.includes(current.id)) remember(current.name);
    if (!Equipment.contains(weapon.name) && !Inventory.first(weapon.name)) {
        await Bank.withdraw(weapon.name, 'Withdraw-1');
        if (!(await Execution.delayUntil(() => Inventory.first(weapon.name ?? '') !== null, 2500))) return false;
    }
    if (!guardianWeaponWorn() && !(await Equipment.equip(weapon.name))) return false;
    if (!guardianWeaponWorn()) return false;
    if (entrana && !(await Equipment.unequip(weapon.name))) return false;
    if (!(await openClueBank()) || !(await Bank.waitReady())) return false;
    if (entrana) await Bank.depositAllMatching(name => ENTRANA_RESTRICTED_GEAR_RE.test(name));
    return true;
}

export async function stockHardSupplies(reserveSlots: number, bankableItems: readonly string[], minimumSharks = MIN_SHARKS): Promise<boolean> {
    if (!Bank.ready()) return false;
    if (!Inventory.items().some(i => SUPERANTI.some(d => d.id === i.id))) {
        const dose = SUPERANTI.find(d => Bank.countById(d.id) > 0);
        if (!dose) return false;
        await Bank.withdraw(dose.name, 'Withdraw-1');
        if (!(await Execution.delayUntil(() => Inventory.items().some(i => i.id === dose.id), 2500))) return false;
    }
    const target = (): number | null => hardTrailFoodTarget({ heldFood: Inventory.count('Shark'), freeSlots: Inventory.free(), reserveSlots }, minimumSharks);
    const availableTarget = Math.min(minimumSharks, Inventory.count('Shark') + Bank.countById(SHARK_ID));
    if ((target() ?? 0) < availableTarget) {
        await Bank.depositAllMatching(name => bankableItems.includes(name));
    }
    const want = target();
    if (want === null) return false;
    for (let tries = 0; tries < 20 && Inventory.count('Shark') < want; tries++) {
        const before = Inventory.count('Shark');
        const need = want - before;
        await Bank.withdraw('Shark', need >= 10 ? 'Withdraw-10' : need >= 5 ? 'Withdraw-5' : 'Withdraw-1');
        if (!(await Execution.delayUntil(() => Inventory.count('Shark') > before, 2500))) break;
    }
    return Inventory.count('Shark') >= minimumSharks;
}
