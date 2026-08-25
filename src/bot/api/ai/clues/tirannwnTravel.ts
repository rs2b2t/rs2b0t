// Why: three callers walk a clue somewhere, and only one of them was the trail itself. The talk
// Why: step reaches its NPC through Reach, and the bank stop picks its own booth, so each needs the
// Why: seam graph or it asks the baked pack for a path across Isafdar and is told unreachable.
// @see docs/reference/clues-gates.md#proving-a-gate

import { Game } from '#/bot/api/game/Game.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { pocketAt, travelTirannwn } from '#/bot/api/ai/quests/defs/regicide/pockets.js';
import { RG_STAGE } from '#/bot/api/ai/quests/defs/regicide/journal.js';
import Tile from '#/bot/geometry/Tile.js';
import type { NavPoint } from '#/bot/event/webwalk/PathFinder.js';

// Why: the seam graph gates the dense forests on stage 8 and the palisade southbound on 13, so a journal short of complete must not be handed a stage that opens them.
export function tirannwnStage(): number {
    return Quests.status('Regicide') === 'complete' ? RG_STAGE.COMPLETE : RG_STAGE.NOT_STARTED;
}

/** True when either end of the walk sits in a pocket the baked pack has no edges through. */
export function crossesTirannwn(dest: NavPoint | null): boolean {
    return (dest !== null && pocketAt(dest) !== undefined) || pocketAt(Game.tile()) !== undefined;
}

/** Walk to `dest` over REGICIDE_SEAMS, which is the only way in or out of Isafdar. */
export function walkAcrossTirannwn(dest: NavPoint, radius: number, log: (m: string) => void): Promise<boolean> {
    return travelTirannwn(new Tile(dest.x, dest.z, dest.level), radius, tirannwnStage(), log);
}
