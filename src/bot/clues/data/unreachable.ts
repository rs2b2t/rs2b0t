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
    // ---- NO QUEST: the crossing is open today, it is simply not baked -------
    // Lumber Yard, NE of Varrock. Its fence has one way in: a Climb-over broken
    // fence, which derive-doors cannot see (centrepiece shape, not a wall, and
    // the op is Climb-over rather than Open).
    2722: 'Lumber Yard fence: Climb-over gertrudefence @ (3305,3493) — not baked; members-only, no quest',
    // The islet is one tile of water away. druidjump_loc is a real bidirectional
    // crossing with an agility check that can drop you in the swamp.
    3542: 'Nature Grotto islet: Jump druidjump_loc @ (3440,3331) <-> (3441,3329), agility check — not baked',
    // Shantay sells the pass; going south consumes one and runs a dialogue.
    3552: 'Kharidian desert: Shantay pass consumed entering south (shantay_pass.rs2) — state-aware crossing',
    3554: 'Kharidian desert: Shantay pass consumed entering south (shantay_pass.rs2) — state-aware crossing',

    // ---- QUEST: assume complete, then bake ---------------------------------
    3560: 'Isafdar: Sticks [Pass] @ (2200,3169) — requires Underground Pass/Regicide',
    3562: 'Isafdar: Sticks [Pass] @ (2181,3209) — requires Underground Pass/Regicide',
    3564: 'elf camp: Dense forest [Enter] @ (2231,3248) / Log balance @ (2197,3237) — requires Regicide',
    3546: "Gu'Tanoth: ogre guard gates (ogre_guard.rs2, %gutanoth_gold) — requires Watch Tower",
    3548: "Gu'Tanoth: ogre guard gates (ogre_guard.rs2, %gutanoth_gold) — requires Watch Tower",
    3522: 'West Ardougne: squeeze the sewer pipe with a rope tied to its grill (sewerpipe.rs2) — requires Plague City',
    2815: 'Crandor: reached by the quest ship — requires Dragon Slayer',
    3526: 'Trollheim/Death Plateau: death_climbingrocks need climbing boots worn — requires Death Plateau',
    3528: 'Trollheim/Death Plateau: death_climbingrocks need climbing boots worn — requires Death Plateau',

    // ---- KIT: an item or skill, no quest -----------------------------------
    // riddle027's own text is the gate: "When no weapons are at hand".
    3579: 'Entrana: monk boat from Port Sarim, refused while carrying ANY weapon or armour (has_entrana_restricted_items) — needs a ship edge and a bank-the-gear step',
    2811: 'Baxtorian Falls ledge: rope crossing — clue already carries items:["Rope"], the ledge hop is not baked',
    2790: 'west Varrock sewer: slashable Web @ (3210,9898) needs a wielded slash weapon — nav does not model webs',
    3532: 'Kharazi jungle: boundary is cut tile-by-tile with a machete (jungle_tree.rs2) — a traversal mode, not one edge',
    3534: 'Kharazi jungle: boundary is cut tile-by-tile with a machete (jungle_tree.rs2) — a traversal mode, not one edge',
    3536: 'Kharazi jungle: boundary is cut tile-by-tile with a machete (jungle_tree.rs2) — a traversal mode, not one edge',

    // ---- DEFECT: no gate, the data is wrong --------------------------------
    2855: 'Sinclair Mansion upstairs is a 1-tile pocket at (2745,3576,1) — the ladder edge lands somewhere unreachable',
    3572: 'the ladder at (2701,3408) lands on a 1-tile pocket at level 1'
};

export function packUnreachable(id: number): string | null {
    return PACK_UNREACHABLE[id] ?? null;
}
