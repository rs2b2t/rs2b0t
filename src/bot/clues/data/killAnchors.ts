import Tile from '#/bot/api/Tile.js';

/**
 * Kill-for-key hunt anchors, keyed by the riddle CLUE obj id.
 *
 * The medium kill-for-key riddles (trail_clue_medium.rs2, proc
 * `trail_checkmediumdrop`) drop the container key when the matching NPC dies
 * ANYWHERE with the clue held — the key materialises at the NPC's death coord,
 * NOT at the container. The killer is therefore NOT co-located with the locked
 * container it opens: e.g. riddle004's drawers sit at (2709,3478) but the
 * nearest Chicken is ~58 tiles away, and riddle005's Man is one floor BELOW its
 * upstairs container. So the solver must walk to where the killer roams, kill it
 * there, loot the dropped key, and only THEN return to the container to search.
 *
 * Each anchor is a representative spawn of the killer NPC, read from the content
 * maps' `==== NPC ====` sections (rs2b2t-content/maps) — the nearest spawn to
 * the riddle's container so the kill→container leg stays as short as the content
 * allows. A missing entry falls the solver back to hunting near the container
 * (the old behaviour) and abandoning gracefully if nothing matches there.
 */
export const KILL_ANCHORS: Record<number, Tile> = {
    2831: new Tile(3039, 3700, 0), // riddle001 — Black Heather, deep in the Wilderness (far from the Edgeville-area chest; a long, risky trek)
    2833: new Tile(2624, 3319, 0), // riddle002 — Guard dog, Ardougne (killer L0; container is the upstairs drawers)
    2835: new Tile(2635, 3339, 0), // riddle003 — Guard, East Ardougne street (killer L0; container upstairs)
    2837: new Tile(2651, 3441, 0), // riddle004 — Chicken pen NW of the Fishing Guild (nearest chickens to the drawers)
    2839: new Tile(2596, 3106, 0), // riddle005 — Man, Yanille ground floor (directly below the L1 container)
    3605: new Tile(2802, 3164, 0), // riddle007 — Pirate, Brimhaven docks, Karamja (killer L0; container upstairs — reached via the ship)
    3607: new Tile(2910, 3539, 0) // riddle008 — Penda, Barbarian Outpost (nearest spawn to the container)
};
