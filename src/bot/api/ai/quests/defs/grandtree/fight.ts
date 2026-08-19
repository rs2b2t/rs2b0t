import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import Tile from '../../../../../geometry/Tile.js';
import { Locs } from '../../../../locs/Locs.js';
import { Npcs, type Npc } from '../../../../npcs/Npcs.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { driveUntil, settleScene } from '../../exec/prompts.js';
import { runFight } from '../fightarena/fights.js';
import { GT_LOC, GT_NPC, GT_TILE, inCaves } from './areas.js';
import { climbToPillars, leaveCaves } from './legs.js';

type Log = (m: string) => void;

/** Ticks the demon gets before the fight counts as stuck; it has 157 hitpoints and 152 defence. */
const DEMON_GUARD = 1200;

function demon(): Npc | null {
    return Npcs.query().where(n => n.id === GT_NPC.BLACK_DEMON).within(20).nearest();
}

function here(): Tile | null {
    const t = Game.tile();
    return t ? new Tile(t.x, t.z, t.level) : null;
}

// Why: the trapdoor is ground decor, which blocks its own tile, so the stand is the tile north of it and the server paths the last step itself.
// Why: `[oploc1,grandtree_trapdoorclosed]` opens at every stage from 130 up, which is what makes a death after the demon recoverable — the caves have no other way in until the quest is finished.

/** Drop through Glough's trapdoor into the root caves. */
export async function descendTrapdoor(log: Log): Promise<boolean> {
    if (inCaves(here())) {
        return true;
    }
    if (!(await climbToPillars(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(GT_TILE.trapdoorStand, { radius: 0, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    await settleScene();
    const trapdoor = Locs.query().where(l => l.id === GT_LOC.TRAPDOOR_SHUT).action('Open').within(4).nearest();
    if (!trapdoor) {
        log(`no trapdoor at (${GT_TILE.trapdoorStand.x},${GT_TILE.trapdoorStand.z})`);
        return false;
    }
    if (!(await trapdoor.interact('Open'))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => inCaves(here()), 12_000))) {
        log('the trapdoor did not drop us into the caves');
        return false;
    }
    await settleScene();
    return true;
}

// Why: Glough's speech ends in `if_close`, a camera move and an `npc_add`, so the demon appearing is what ends the cutscene rather than the dialogue closing.
// Why: `ai_timer` deletes the demon once the player is more than seventeen tiles away, and only stage 130 re-runs the cutscene — so a run that wandered off climbs back out and drops in again.

/** Take the trapdoor, sit through Glough's speech, and kill what he sets on you. */
export async function fightBlackDemon(log: Log): Promise<boolean> {
    const dropping = !inCaves(here());
    if (!(await descendTrapdoor(log))) {
        return false;
    }
    if (!demon()) {
        if (dropping) {
            log('waiting out Glough\'s speech for the demon to land');
        }
        await driveUntil(() => demon() !== null, [], log, dropping ? 90_000 : 15_000);
    }
    const target = demon();
    if (!target) {
        log('no Black Demon in the caves — climbing back out to re-enter the trapdoor');
        await leaveCaves(log);
        return false;
    }
    // Why: Glough sets the demon on the player twelve tiles away, and the fight loop counts a
    // swing per tick it is not yet in combat — twelve of them and it calls the target caged.
    const at = target.tile();
    await Traversal.walkResilient(new Tile(at.x, at.z, at.level), { radius: 2, attempts: 2, timeoutMs: 20_000, log });
    const result = await runFight({ what: 'Black Demon', npcId: GT_NPC.BLACK_DEMON, guard: DEMON_GUARD }, log);
    return result === 'won';
}
