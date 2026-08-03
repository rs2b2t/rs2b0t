/**
 * Clue destinations the baked nav pack cannot route to, with the diagnosis for
 * each. These are gaps in the **nav data**, not the clue database: the solver
 * abandons cleanly, and fixing one is a transports/doors change that makes the
 * clue start working with no solver edit.
 *
 * Deliberately not consulted by the solver — it still tries, so a pack fix takes
 * effect on its own. The audit allowlists these, and the live harnesses use them
 * to tell "blocked by a known gap" apart from a real regression.
 *
 * @see docs/CLUES.md#clues-the-pack-cannot-reach
 */
export const PACK_UNREACHABLE: Record<number, string> = {
    2811: 'Baxtorian Falls ledge',
    2815: 'Crandor',
    // Pre-existing: Sinclair Mansion upstairs is a pocket the ladder edge misses.
    2855: 'Sinclair Mansion upstairs pocket (2745,3576,1)',
    2722: 'marooned with (3293..3325, 3493..3517); no crossing loc found on its boundary — cause unverified',
    2790: 'west Varrock sewer is behind a slashable Web at (3210,9898); nav does not model webs',
    3522: 'West Ardougne is entered by squeezing the Plague City sewer pipe, which needs a rope tied to its grill (sewerpipe.rs2) — a scripted, state-gated crossing',
    3526: 'marooned with (2833..2916, 3654..3711); no crossing loc found on its boundary — cause unverified',
    3528: 'marooned with (2833..2916, 3654..3711); no crossing loc found on its boundary — cause unverified',
    3532: 'Kharazi jungle (2757..2974, 2881..2946); its boundary is Chop-down jungle, which nav does not model',
    3534: 'Kharazi jungle (2757..2974, 2881..2946); its boundary is Chop-down jungle, which nav does not model',
    3536: 'Kharazi jungle (2757..2974, 2881..2946); its boundary is Chop-down jungle, which nav does not model',
    3542: 'Mort Myre islet reached by the Bridge jump at (3440,3331), not baked',
    3546: 'islet reached by the Rock Jump-From at (2531,3029), not baked',
    3548: 'pocket reached by the Ladder at (2575,3029), not baked',
    3552: 'Kharidian desert entry consumes a bought Shantay pass (state-aware crossing)',
    3554: 'Kharidian desert entry consumes a bought Shantay pass (state-aware crossing)',
    3560: 'Isafdar — requires Regicide',
    3562: 'Isafdar — requires Regicide',
    3564: 'elf camp — requires Regicide',
    3572: 'the ladder at (2701,3408) lands on a 1-tile pocket at level 1',
    3579: 'marooned with (2802..2878, 3329..3393); no crossing loc found on its boundary — cause unverified'
};

export function packUnreachable(id: number): string | null {
    return PACK_UNREACHABLE[id] ?? null;
}
