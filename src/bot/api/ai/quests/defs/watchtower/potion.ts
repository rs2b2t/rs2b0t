import { Execution } from '../../../../execution/Execution.js';
import { Inventory, type InvItem } from '../../../../inventory/Inventory.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { driveDialog } from '../../exec/primitives.js';
import { WT_ITEM, WT_NPC } from './areas.js';
import { WATCHTOWER_STAGE } from './journal.js';
import { climbToWizard } from './tower.js';

function item(id: number): InvItem | null {
    return Inventory.items().find(entry => entry.id === id) ?? null;
}

function heldId(id: number): number {
    return Inventory.items().filter(entry => entry.id === id).reduce((sum, entry) => sum + entry.count, 0);
}

async function combine(useId: number, ontoId: number, producesId: number, log: (m: string) => void): Promise<boolean> {
    const source = item(useId);
    const target = item(ontoId);
    if (!source || !target) {
        log(`cannot combine ${useId} with ${ontoId} — one of them is missing`);
        return false;
    }
    if (!(await source.useOn(target))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(producesId) > 0, 8000);
}

export async function grindBatBones(log: (m: string) => void): Promise<boolean> {
    if (heldId(WT_ITEM.GROUND_BAT_BONES.id) > 0) {
        return true;
    }
    return combine(WT_ITEM.PESTLE.id, WT_ITEM.BAT_BONES.id, WT_ITEM.GROUND_BAT_BONES.id, log);
}

/**
 * Guam, then jangerberries, then ground bat bones. Any other pairing calls
 * potion_explosion: both items are destroyed and it costs 5 damage.
 */
export async function brewOgrePotion(log: (m: string) => void): Promise<boolean> {
    if (heldId(WT_ITEM.OGRE_POTION.id) > 0) {
        return true;
    }
    if (heldId(WT_ITEM.GUAM_VIAL.id) === 0 && heldId(WT_ITEM.GUAM_JANGER_VIAL.id) === 0) {
        if (!(await combine(WT_ITEM.GUAM_LEAF.id, WT_ITEM.VIAL_WATER.id, WT_ITEM.GUAM_VIAL.id, log))) {
            return false;
        }
    }
    if (heldId(WT_ITEM.GUAM_JANGER_VIAL.id) === 0) {
        if (!(await combine(WT_ITEM.JANGERBERRIES.id, WT_ITEM.GUAM_VIAL.id, WT_ITEM.GUAM_JANGER_VIAL.id, log))) {
            return false;
        }
    }
    return combine(WT_ITEM.GROUND_BAT_BONES.id, WT_ITEM.GUAM_JANGER_VIAL.id, WT_ITEM.OGRE_POTION.id, log);
}

export async function infusePotion(log: (m: string) => void): Promise<boolean> {
    if (!(await climbToWizard(WATCHTOWER_STAGE.LEARNED_POTION, log))) {
        return false;
    }
    const potion = item(WT_ITEM.OGRE_POTION.id);
    const wizard = Npcs.query().name(WT_NPC.WIZARD).nearest();
    if (!potion || !wizard || !(await potion.useOn(wizard))) {
        return false;
    }
    await driveDialog([], log);
    return Execution.delayUntil(() => heldId(WT_ITEM.MAGIC_OGRE_POTION.id) > 0, 15_000);
}
