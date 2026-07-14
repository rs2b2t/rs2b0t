import { Execution } from '../../../api/Execution.js';
import { Locs } from '../../../api/queries/Locs.js';
import { reader } from '../../../adapter/ClientAdapter.js';
import { ActionRouter } from '../../../input/ActionRouter.js';

/**
 * Shared tutorial-stage helpers (promoted out of `Chef.ts` so
 * `QuestGuide.ts` didn't have to copy them -- see
 * "Interaction-at-range" note for the full mechanics writeup).
 */

/**
 * The Quest Guide's door (`newbie_door4`, live-probed tile — docs/
 * the tutorial varp ladder, 200 → 220). Shared between Chef.ts (whose last
 * stage opens it to END the chef section, crossing to z >= 3126) and
 * QuestGuide.ts (whose first stage opens it again to get back INSIDE the
 * hall — the open teleports through in either direction).
 */
export const QUEST_GUIDE_DOOR = { x: 3086, z: 3126 };

/**
 * Climbing the mine ladder adds +6400 to world z (mapsquare z 48 -> 148 —
 * QuestGuide.ts's `ClimbToMine`); far above any surface z in this arc
 * (~3070-3134), so `Game.tile()!.z >= MINE_Z` is a reliable "am I
 * underground" gate. Promoted here from Mining.ts so it and
 * QuestGuide.ts share one constant instead of two copies drifting.
 */
export const MINE_Z = 9000;

/**
 * A "Door" loc pinned to a known tile box, never "nearest Door" — several
 * tutorial doors share the display name and the wrong one is often nearer
 * (Chef.ts file-header note 1).
 */
export function doorAt(tile: { x: number; z: number }, pad = 2) {
    return Locs.query()
        .name('Door')
        .action('Open')
        .inside({ minX: tile.x - pad, maxX: tile.x + pad, minZ: tile.z - pad, maxZ: tile.z + pad });
}

/**
 * One snap-walk hop toward a world tile (MOVE_GAMECLICK with
 * tryNearest=true — moves as far as the client BFS can get, unlike an
 * op-click's all-or-nothing path). Callers loop: each retry hops from the
 * new position, converging around obstacles the straight-line server
 * pathing can't handle. Routes through the input driver per ADR-0003;
 * Traversal is deliberately avoided on Tutorial Island until nav-pack
 * coverage is proven.
 *
 * Use this for any LOC interaction more than ~5 tiles out (op-clicks are
 * all-or-nothing under this engine's NAIVE routefinder); NPC talk-to
 * interactions don't need it (`interact()` on an npc uses a more tolerant
 * client-side approach walk — confirmed live across every tutorial talk
 * stage so far, none of which walk-snap first).
 */
export async function walkToward(tile: { x: number; z: number }): Promise<void> {
    const local = reader.toLocal(tile.x, tile.z);
    if (local) {
        ActionRouter.driver.walk(local.lx, local.lz);
    }
    await Execution.delayTicks(4);
}
