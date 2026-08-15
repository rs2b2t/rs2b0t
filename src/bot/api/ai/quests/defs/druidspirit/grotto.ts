import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { driveDialog, talkThrough } from '../../exec/primitives.js';
import { driveUntil, heldId, settleScene } from '../../exec/prompts.js';
import { FILLIMAN, inGrotto, NATURE_SPIRIT, NS_ID, NS_LOC, NS_TILE } from './areas.js';

const inside = (): boolean => inGrotto(Game.tile());

/** Whichever form of Filliman is in the grotto. */
function grottoSpirit(): { name: string } | null {
    if (Npcs.query().name(NATURE_SPIRIT.npc).within(12).nearest()) {
        return { name: NATURE_SPIRIT.npc };
    }
    if (Npcs.query().name(FILLIMAN.npc).within(12).nearest()) {
        return { name: FILLIMAN.npc };
    }
    return null;
}

// Why: the grotto is a pocket the walker has no route into — `Enter` teleports the character, and past the ritual stage that is all the op does.

export async function enterGrotto(log: (m: string) => void): Promise<boolean> {
    if (inside()) {
        return true;
    }
    if (!(await Traversal.walkResilient(NS_TILE.GROTTO_DOOR, { radius: 2, attempts: 4, timeoutMs: 300_000, log }))) {
        return false;
    }
    await settleScene();
    const door = Locs.query().name(NS_LOC.GROTTO_DOOR).action('Enter').within(8).nearest();
    if (!door) {
        log('no grotto door in the scene');
        return false;
    }
    if (!(await door.interact('Enter'))) {
        return false;
    }
    return Execution.delayUntil(inside, 15_000);
}

export async function leaveGrotto(log: (m: string) => void): Promise<boolean> {
    if (!inside()) {
        return true;
    }
    await settleScene();
    const door = Locs.query().name(NS_LOC.GROTTO_DOOR).action('Exit').within(16).nearest();
    if (!door) {
        log('no grotto exit in the scene');
        return false;
    }
    if (!(await door.interact('Exit'))) {
        return false;
    }
    return Execution.delayUntil(() => !inside(), 15_000);
}

// Why: the spirit inside is npc_add'ed by searching the grotto pool and despawns on a timer, so an empty grotto is answered by searching rather than by waiting.

/** Talk to the spirit inside the grotto, summoning it if it has gone. */
export async function talkInGrotto(prefer: string[], log: (m: string) => void): Promise<boolean> {
    if (!(await enterGrotto(log))) {
        return false;
    }
    await settleScene();
    const present = grottoSpirit();
    if (present) {
        return talkThrough(present.name, prefer, log);
    }
    const pool = Locs.query().name(NS_LOC.GROTTO_POOL).action('Search').within(16).nearest();
    if (!pool) {
        log('no grotto pool to search for the spirit');
        return false;
    }
    if (!(await pool.interact('Search'))) {
        return false;
    }
    await Execution.delayUntil(() => grottoSpirit() !== null || ChatDialog.isOpen() || ChatDialog.canContinue(), 8000);
    return driveDialog(prefer, log);
}

// Why: a lost blessed sickle is replaced by dipping a plain one in the grotto water, which is an `oplocu` with no op of its own.

/** Dip a plain silver sickle in the grotto pool. */
export async function blessSickle(log: (m: string) => void): Promise<boolean> {
    if (heldId(NS_ID.SICKLE_BLESSED) > 0) {
        return true;
    }
    if (!(await enterGrotto(log))) {
        return false;
    }
    await settleScene();
    const pool = Locs.query().name(NS_LOC.ALTAR).within(16).nearest()
        ?? Locs.query().name(NS_LOC.GROTTO_POOL).action('Search').within(16).nearest();
    const sickle = Inventory.items().find(i => i.id === NS_ID.SICKLE);
    if (!pool || !sickle) {
        log('no grotto pool in reach, or no plain sickle to dip');
        return false;
    }
    if (!(await sickle.useOn(pool))) {
        return false;
    }
    return driveUntil(() => heldId(NS_ID.SICKLE_BLESSED) > 0, [], log);
}

/** The quest ends inside the pocket; the retreat to a bank has to start outside it. */
export async function exitAfterQuest(log: (m: string) => void): Promise<boolean> {
    return leaveGrotto(log);
}
