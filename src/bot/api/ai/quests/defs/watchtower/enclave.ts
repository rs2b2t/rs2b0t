import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Skills } from '../../../../skills/Skills.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Locs, type Loc } from '../../../../locs/Locs.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { driveDialog } from '../../exec/primitives.js';
import { WT_ITEM, WT_LOC, WT_NPC, WT_TILE, watchtowerArea } from './areas.js';
import { settleScene } from './scene.js';

function heldId(id: number): number {
    return Inventory.items().filter(item => item.id === id).reduce((sum, item) => sum + item.count, 0);
}

function locNear(id: number, op: string, within = 10): Loc | null {
    return Locs.query().where(loc => loc.id === id).action(op).within(within).nearest();
}

/** Every entry burns one nightshade; the guard is distracted only for the run past. */
export async function enterEnclave(log: (m: string) => void): Promise<boolean> {
    if (watchtowerArea(Game.tile()) === 'enclave') {
        return true;
    }
    if (heldId(WT_ITEM.NIGHTSHADE.id) === 0) {
        log('no Nightshade — the enclave guard cannot be distracted');
        return false;
    }
    if (!(await Traversal.walkResilient(WT_TILE.ENCLAVE_GUARD, { radius: 2, attempts: 3, timeoutMs: 300_000, log }))) {
        return false;
    }
    const guard = Npcs.query().name(WT_NPC.ENCLAVE_GUARD).nearest();
    const shade = Inventory.items().find(item => item.id === WT_ITEM.NIGHTSHADE.id);
    if (!guard || !shade || !(await shade.useOn(guard))) {
        log('could not use Nightshade on the enclave guard');
        return false;
    }
    // Why: the dialogue the nightshade opened is driven and no fresh one is started, as both of this guard's own conversation options make him attack.
    if (await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 8000)) {
        await driveDialog([], log);
    }
    if (!(await Execution.delayUntil(() => watchtowerArea(Game.tile()) === 'enclave', 15_000))) {
        return false;
    }
    await settleScene();
    return true;
}

export async function leaveEnclave(log: (m: string) => void): Promise<boolean> {
    if (watchtowerArea(Game.tile()) !== 'enclave') {
        return true;
    }
    if (!(await Traversal.walkResilient(WT_TILE.ENCLAVE_EXIT, { radius: 2, attempts: 3, timeoutMs: 180_000, log }))) {
        return false;
    }
    const cave = locNear(WT_LOC.ENCLAVE_CAVE, 'Enter');
    if (!cave || !(await cave.interact('Enter'))) {
        log('no enclave exit cave in range');
        return false;
    }
    if (!(await Execution.delayUntil(() => watchtowerArea(Game.tile()) !== 'enclave', 15_000))) {
        return false;
    }
    await settleScene();
    return true;
}

export async function dissolveShamans(log: (m: string) => void): Promise<boolean> {
    if (!(await enterEnclave(log))) {
        return false;
    }
    for (const spot of WT_TILE.SHAMANS) {
        if (heldId(WT_ITEM.MAGIC_OGRE_POTION.id) === 0) {
            // Why: the potion is spent on the sixth shaman or lost, and either way staying put lets decide() choose.
            // Why: the rock is mined from in here, and a brewing trip leaves through the ordinary escape.
            log('the magic ogre potion is spent');
            return true;
        }
        if (Skills.effective('hitpoints') * 2 < Skills.level('hitpoints')) {
            await Sustain.run();
        }
        if (!(await Traversal.walkResilient(spot, { radius: 2, attempts: 2, timeoutMs: 90_000, log }))) {
            continue;
        }
        // Never talk to a shaman and never attack one: opnpc1 is a flat 20 damage
        // and attacking draws 30. Only the potion works.
        const shaman = Npcs.query().name(WT_NPC.SHAMAN).where(npc => npc.distance() <= 4).nearest();
        const potion = Inventory.items().find(item => item.id === WT_ITEM.MAGIC_OGRE_POTION.id);
        if (!shaman || !potion) {
            continue;
        }
        if (await potion.useOn(shaman)) {
            await Execution.delayTicks(3);
        }
    }
    return true;
}

export async function mineDalgroth(log: (m: string) => void): Promise<boolean> {
    if (heldId(WT_ITEM.CRYSTAL4.id) > 0) {
        return true;
    }
    if (!(await enterEnclave(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(WT_TILE.ROCK_OF_DALGROTH, { radius: 2, attempts: 3, timeoutMs: 180_000, log }))) {
        return false;
    }
    const rock = locNear(WT_LOC.ROCK_OF_DALGROTH, 'Mine');
    if (!rock || !(await rock.interact('Mine'))) {
        log('no Rock of Dalgroth in range, or no pickaxe carried');
        return false;
    }
    return Execution.delayUntil(() => heldId(WT_ITEM.CRYSTAL4.id) > 0, 20_000);
}

export async function searchShamanRobe(log: (m: string) => void): Promise<boolean> {
    if (heldId(WT_ITEM.CRYSTAL3.id) > 0) {
        return true;
    }
    if (!(await enterEnclave(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(WT_TILE.SHAMAN_ROBE, { radius: 2, attempts: 3, timeoutMs: 180_000, log }))) {
        return false;
    }
    if (heldId(WT_ITEM.SHAMAN_ROBE.id) === 0) {
        const robe = GroundItems.query().name(WT_ITEM.SHAMAN_ROBE.name).within(4).nearest();
        if (!robe || !(await robe.interact('Take'))) {
            log('no shaman robe on the enclave floor');
            return false;
        }
        if (!(await Execution.delayUntil(() => heldId(WT_ITEM.SHAMAN_ROBE.id) > 0, 6000))) {
            return false;
        }
    }
    const carried = Inventory.items().find(item => item.id === WT_ITEM.SHAMAN_ROBE.id);
    if (!carried || !(await carried.interact('Search'))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(WT_ITEM.CRYSTAL3.id) > 0, 8000);
}
