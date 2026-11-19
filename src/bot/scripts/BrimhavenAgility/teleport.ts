import { Quests } from '../../api/ui/questlog/Quests.js';
import { Bank } from '../../api/bank/Bank.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Skills } from '../../api/skills/Skills.js';
import { foodForms } from '../../api/combat/food.js';
import { executeTeleportHop } from '../../event/webwalk/teleportExecute.js';

const RUNES = ['Law rune', 'Water rune'];

export function ardougneUnlocked(): boolean {
    return Skills.effective('magic') >= 51 && Quests.status('Plague City') === 'complete';
}

export function hasReturnRunes(): boolean {
    return RUNES.every(name => Inventory.count(name) >= 2);
}

export function returnRuneSlots(): number {
    return RUNES.filter(name => Inventory.count(name) > 0).length;
}

export async function stockReturnTeleport(food: string): Promise<void> {
    if (!ardougneUnlocked() || !RUNES.every(name => Inventory.count(name) + Bank.count(name) >= 2)) return;
    if (Inventory.items().filter(item => foodForms(food).includes((item.name ?? '').toLowerCase())).length > 24) {
        await Bank.depositAllMatching(name => foodForms(food).includes(name.toLowerCase()));
    }
    for (const rune of RUNES) {
        const need = 2 - Inventory.count(rune);
        if (need > 0) await Bank.withdrawX(rune, need);
    }
    if (!hasReturnRunes()) await Bank.depositAllMatching(name => RUNES.includes(name));
}

export function teleportToArdougne(log: (message: string) => void): Promise<boolean> {
    return executeTeleportHop({
        action: 'Cast', locX: 0, locZ: 0, kind: 'teleport', teleportId: 'ardougne', locName: 'Ardougne teleport',
        toTile: { x: 2661, z: 3301 }, toLevel: 0
    }, log);
}
