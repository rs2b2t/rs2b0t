// Why: these are gaps in the nav data, not the clue database — the solver abandons cleanly and baking the crossing makes the clue work with no solver edit.
// Why: not consulted by the solver, so a pack fix takes effect on its own.
// Why: the audit allowlists these and the live harnesses use them to tell a known gap apart from a regression.
// Why: the section markers below read NO QUEST (crossing exists, needs baking), QUEST (assumes the named quest complete, then needs baking), KIT (needs an item or skill, not a quest), DEFECT (the pack or a generator is wrong).
// @see docs/reference/clues-gates.md#clues-the-pack-cannot-reach

/** Clue destinations the baked nav pack cannot route to, each with its stated gap. */
export const PACK_UNREACHABLE: Record<number, string> = {
    // ---- NO QUEST -----------------------------------------------------------
    // Why: the southbound crossing is baked but consumes a Shantay pass, and a requires-gated edge is skipped when no world state is supplied, so the bot walks it holding a pass while the offline audit still calls it closed.
    3554: 'Kharidian desert: baked, but entry consumes a Shantay pass — the bot must carry one',

    // ---- QUEST: assume complete, then bake ---------------------------------
    3560: 'Isafdar: Sticks [Pass] @ (2200,3169) — requires Underground Pass/Regicide',
    3562: 'Isafdar: Sticks [Pass] @ (2181,3209) — requires Underground Pass/Regicide',
    3564: 'elf camp: Dense forest [Enter] @ (2231,3248) / Log balance @ (2197,3237) — requires Regicide',
    // 3546 only: 3548's Toban camp cave/ladder now routes on the curated graph.
    3546: "Gu'Tanoth ledge: chasm Jump-From baked — need 25 Agility + 20gp; hill access may need Watch Tower",
    3522: 'West Ardougne: baked sewer pipe path — requires Plague City complete and Gas mask worn',
    // Why: death_climbingrocks_top (3722) / _bottom (3723) sit at (2880..2881, 3594..3595) on the Death Plateau, ~80 tiles south of these digs and not on the route (#365, Content @ 088ca5e).
    // Why: the crossings bordering these digs are in quest_troll.rs2 — troll_mountain_shortcut_climbingrocks1/2 (3803/3804) @ (2885,3683+3684) and (2887..2888,3661), Agility 15 only, no quest and no boots.
    // Why: troll_climbingrocks (3748) @ (2910,3686+3687) needs Agility 15 AND %troll_quest >= ^troll_started (Troll Stronghold started, not Death Plateau); Climbing boots are demanded only when coordz(coord) = 3611, the far southern approach.
    // Why: 3526 / 3528 are absent because the Troll Stronghold route (#264) baked stile, the three secret-way rock climbs, the troll pass and the stronghold, joining Trollheim to the mainland graph at the cost of Agility 15 and worn Climbing boots for the (2856,3612) ascent.
    // Why: the two mountain shortcut rocks named above stayed unbaked because both their endpoints already sit inside that component.

    // ---- KIT: an item or skill, no quest -----------------------------------
    // 2811 Baxtorian rope baked (#369); 2790 sewer web baked (#370); 3579 Entrana ferry+planks (#368).
    3532: 'Kharazi jungle: boundary is cut tile-by-tile with a machete (jungle_tree.rs2) — a traversal mode, not one edge',
    3534: 'Kharazi jungle: boundary is cut tile-by-tile with a machete (jungle_tree.rs2) — a traversal mode, not one edge',
    3536: 'Kharazi jungle: boundary is cut tile-by-tile with a machete (jungle_tree.rs2) — a traversal mode, not one edge'

    // Why: 2855 Sinclair Mansion anchored its ladder foot on a sealed strip; the approach tile is overridden in derive-ladders.py rather than in snap(), because a general rule moved ladders that were already correct.
};
