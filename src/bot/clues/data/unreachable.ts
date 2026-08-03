/**
 * Clue destinations the baked nav pack cannot route to, with the verified reason
 * for each. Every entry below was traced to its actual crossing in the content
 * scripts, not inferred from a map scan.
 *
 * These are gaps in the **nav data**, not the clue database: the solver abandons
 * cleanly, and baking the crossing makes the clue start working with no solver
 * edit. Deliberately not consulted by the solver — it still tries, so a pack fix
 * takes effect on its own. The audit allowlists these, and the live harnesses use
 * them to tell "blocked by a known gap" apart from a real regression.
 *
 * Grouped by what it would take to open them:
 *
 *   NO QUEST — the crossing exists today and only needs baking.
 *   QUEST    — assumes the named quest is complete, then needs baking.
 *   KIT      — needs an item or skill carried, not a quest.
 *   DEFECT   — not a gate at all; the pack or a generator is wrong.
 *
 * @see docs/CLUES.md#clues-the-pack-cannot-reach
 */
export const PACK_UNREACHABLE: Record<number, string> = {
    // ---- NO QUEST -----------------------------------------------------------
    // The southbound crossing is now baked, but it consumes a Shantay pass, and a
    // requires-gated edge is skipped when no world state is supplied. So the bot
    // walks it holding a pass; the offline audit correctly still calls it closed.
    3552: 'Kharidian desert: baked, but entry consumes a Shantay pass — the bot must carry one',
    3554: 'Kharidian desert: baked, but entry consumes a Shantay pass — the bot must carry one',

    // ---- QUEST: assume complete, then bake ---------------------------------
    3560: 'Isafdar: Sticks [Pass] @ (2200,3169) — requires Underground Pass/Regicide',
    3562: 'Isafdar: Sticks [Pass] @ (2181,3209) — requires Underground Pass/Regicide',
    3564: 'elf camp: Dense forest [Enter] @ (2231,3248) / Log balance @ (2197,3237) — requires Regicide',
    // 3546/3548: "Gu'Tanoth Toban camp: cave/ladder baked — hill access may need Watch Tower",
    // (ogre gates / Watch Tower path) to reach the stands from the mainland.
    3546: "Gu'Tanoth ledge: chasm Jump-From baked — need 25 Agility + 20gp; hill access may need Watch Tower",
    3548: "Gu'Tanoth Toban camp: cave/ladder baked — hill access may need Watch Tower",
    3522: 'West Ardougne: baked sewer pipe path — requires Plague City complete and Gas mask worn',
    2815: 'Crandor: baked secret wall + rock/rope — requires Dragon Slayer complete',
    3526: 'Trollheim/Death Plateau: death_climbingrocks need climbing boots worn — requires Death Plateau',
    3528: 'Trollheim/Death Plateau: death_climbingrocks need climbing boots worn — requires Death Plateau',

    // ---- KIT: an item or skill, no quest -----------------------------------
    // 2811 Baxtorian rope baked (#369); 2790 sewer web baked (#370); 3579 Entrana ferry+planks (#368).
    3532: 'Kharazi jungle: boundary is cut tile-by-tile with a machete (jungle_tree.rs2) — a traversal mode, not one edge',
    3534: 'Kharazi jungle: boundary is cut tile-by-tile with a machete (jungle_tree.rs2) — a traversal mode, not one edge',
    3536: 'Kharazi jungle: boundary is cut tile-by-tile with a machete (jungle_tree.rs2) — a traversal mode, not one edge',

    // ---- DEFECT: no gate, the data is wrong --------------------------------
    2855: 'Sinclair Mansion upstairs: its ladder foot at (2737,3583,0) sits on a sealed one-tile-wide strip — walkable, exits only along itself, connected to nothing. A build-collision artifact, not a snap choice.'
};

export function packUnreachable(id: number): string | null {
    return PACK_UNREACHABLE[id] ?? null;
}
