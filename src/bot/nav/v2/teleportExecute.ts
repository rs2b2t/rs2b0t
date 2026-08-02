/**
 * Execute originless teleport hops (spell cast or jewellery Rub).
 * Used by WalkExecutor when navEngine is v2.
 */

import { reader } from '../../adapter/ClientAdapter.js';
import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import { ChatDialog } from '../../api/hud/ChatDialog.js';
import { Inventory } from '../../api/hud/Inventory.js';
import type { TransportInfo } from '../PathFinder.js';
import { pickChoice } from '../data/specialCrossings.js';
import {
    inventoryNameMatchesJewellery,
    teleportById,
    type TeleportDestination
} from './teleportCatalog.js';

const SPELL_CAST_NAMES: Record<string, string> = {
    varrock: 'Varrock',
    lumbridge: 'Lumbridge',
    falador: 'Falador',
    camelot: 'Camelot',
    ardougne: 'Ardougne',
    watchtower: 'Watchtower',
    trollheim: 'Trollheim'
};

const LAND_WAIT_MS = 8000;
const DIALOGUE_WAIT_MS = 4000;

function nearLanding(transport: TransportInfo, before: { x: number; z: number; level: number } | null): boolean {
    const t = reader.worldTile();
    if (!t) {
        return false;
    }
    if (transport.toTile) {
        const levelOk = transport.toLevel === undefined || t.level === transport.toLevel;
        return (
            levelOk
            && Math.max(Math.abs(t.x - transport.toTile.x), Math.abs(t.z - transport.toTile.z)) <= 3
        );
    }
    if (!before) {
        return false;
    }
    return t.x !== before.x || t.z !== before.z || t.level !== before.level;
}

function findJewelleryItem(dest: TeleportDestination) {
    return Inventory.items().find(i => i.name !== null && inventoryNameMatchesJewellery(i.name, dest)) ?? null;
}

/**
 * @returns true if the player landed near the hop destination.
 */
export async function executeTeleportHop(
    transport: TransportInfo,
    log: (msg: string) => void
): Promise<boolean> {
    const id = transport.teleportId ?? '';
    const dest = teleportById(id);
    const before = reader.worldTile();

    // ── Spells ──────────────────────────────────────────────────────────
    const spellName = SPELL_CAST_NAMES[id];
    if (spellName) {
        log(`casting ${spellName} teleport…`);
        if (!(await Game.teleport(spellName))) {
            log(`${spellName} teleport cast failed`);
            return false;
        }
        const landed = await Execution.delayUntil(() => nearLanding(transport, before), LAND_WAIT_MS);
        if (landed) {
            await Execution.delayTicks(2);
            log(`${spellName} teleport ok`);
            return true;
        }
        log(`${spellName} teleport did not land`);
        return false;
    }

    // ── Jewellery ───────────────────────────────────────────────────────
    if (!dest || dest.family !== 'jewellery') {
        log(`teleport hop ${id || transport.locName}: unknown id — repath`);
        return false;
    }

    const item = findJewelleryItem(dest);
    if (!item) {
        log(`jewellery tele ${id}: no matching inventory item`);
        return false;
    }

    const rubOp = item.actions().find(a => /^rub$/i.test(a));
    if (!rubOp) {
        log(`jewellery tele ${id}: ${item.name} has no Rub (${item.actions().join(', ')})`);
        return false;
    }

    log(`rubbing ${item.name} for ${dest.label}…`);
    if (!(await item.interact(rubOp))) {
        log(`rub failed on ${item.name}`);
        return false;
    }

    // Wait for chat options, pick destination (skip Nowhere).
    const choose = dest.dialogueChoose ?? [];
    if (choose.length > 0) {
        const gotDialog = await Execution.delayUntil(
            () => ChatDialog.options().length > 0,
            DIALOGUE_WAIT_MS
        );
        if (!gotDialog) {
            log(`jewellery tele ${id}: no dialog after Rub`);
            return false;
        }
        const pick = pickChoice(ChatDialog.options(), choose);
        if (!pick) {
            log(
                `jewellery tele ${id}: no matching option among [${ChatDialog.options().join(' | ')}] want ${choose.join('/')}`
            );
            return false;
        }
        await ChatDialog.chooseOption(pick);
    }

    const landed = await Execution.delayUntil(() => nearLanding(transport, before), LAND_WAIT_MS);
    if (landed) {
        await Execution.delayTicks(2);
        log(`jewellery tele ${id} ok`);
        return true;
    }
    log(`jewellery tele ${id} did not land`);
    return false;
}
