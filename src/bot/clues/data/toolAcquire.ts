import Tile from '#/bot/api/Tile.js';
import type { NpcStop } from '#/bot/quests/exec/primitives.js';

/**
 * Data + pure logic for acquiring the clue tools the medium solver otherwise
 * abandons on (2026-07-20 design). No client imports — runs under plain
 * `bun test`. The client-coupled walking/talking lives in AcquireTools.ts.
 *
 * Engine truths (rs2b2t-content, verified): the coordinate dig hard-requires
 * Sextant+Watch+Chart HELD (general_use/spade.rs2); the chain is a strict
 * server order professor -> Murphy(sextant) -> Kojo(watch) -> professor(chart),
 * all gated on holding a coordinate clue (`has_sextant_clue`). The bot drives
 * off held obj ids only (`trail_status` is server-only).
 */

export const SPADE_NAME = 'Spade';
export const TRIO = ['Sextant', 'Watch', 'Chart'] as const;

/** Ground spawns of obj 952 (Spade). Nearer one is chosen at runtime. */
export const SPADE_SPAWNS: Tile[] = [
    new Tile(2574, 3331, 0), // West Ardougne house
    new Tile(2981, 3369, 0) // Falador
];

export type CoordTool = 'sextant' | 'watch' | 'chart';

export interface HeldTrio {
    sextant: boolean;
    watch: boolean;
    chart: boolean;
}

/**
 * Next tool to acquire given what's held, in the engine's strict chain order:
 * sextant, then watch, then chart. Null when all three are held. A held
 * later-item without its predecessor still returns the predecessor — the
 * server won't hand out a watch before the sextant step is done.
 */
export function nextCoordTool(held: HeldTrio): CoordTool | null {
    if (!held.sextant) {
        return 'sextant';
    }
    if (!held.watch) {
        return 'watch';
    }
    if (!held.chart) {
        return 'chart';
    }
    return null;
}

// NPC stops for gotoNpc/talkThrough. Anchors are the NPC spawn tiles (gotoNpc
// arrives within 1 and talkThrough re-finds within leash). Probe-verified in
// the plan's Task 6; adjust here if a spawn tile isn't a walkable stand.
// prefer lists drive talkThrough through whichever branch the server shows
// (first-time learn vs. lost-item), so both cases need no code branching.
export const PROFESSOR: NpcStop = {
    npc: 'Observatory professor',
    anchor: new Tile(2438, 3186, 0),
    leash: 10,
    prefer: ['Treasure Trails', 'lost', 'navigation', 'sextant', 'watch']
};
export const MURPHY: NpcStop = {
    npc: 'Murphy',
    anchor: new Tile(2668, 3162, 0),
    leash: 10,
    prefer: ['sextant', 'lost']
};
export const KOJO: NpcStop = {
    npc: 'Brother Kojo',
    anchor: new Tile(2569, 3249, 0),
    leash: 10,
    prefer: ['watch', 'lost']
};
// Kojo stands inside the Clock Tower. The direct path WEST from him to the
// professor routes through a LOCKED boarded door at (2566,3237) that never
// opens (the baked pack treats the closet_door on that wall as passable, so
// the pathfinder keeps choosing it — live 2026-07-20 the walker looped "Door
// did not cross in time"). Exiting the tower EAST via this tile first makes the
// professor path go around the locked door (offline-probe-verified: from here
// the route no longer passes (2566,3237)).
export const KOJO_EXIT = new Tile(2576, 3250, 0);
