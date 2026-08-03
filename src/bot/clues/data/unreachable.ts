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
    2722: 'fenced compound at (3293..3325, 3493..3517) has no baked entrance',
    2776: 'Varrock sewer sections are split by double gates derive-doors does not emit (3191/3192,9825)',
    2790: 'west Varrock sewer is behind a slashable Web at (3210,9898); nav does not model webs',
    3522: 'West Ardougne (2433..2556, 3266..3334) has no baked entrance',
    3526: 'island at (2833..2916, 3654..3711) has no baked entrance',
    3528: 'island at (2833..2916, 3654..3711) has no baked entrance',
    3532: 'south Karamja (2757..2974, 2881..2946) has no baked entrance',
    3534: 'south Karamja (2757..2974, 2881..2946) has no baked entrance',
    3536: 'south Karamja (2757..2974, 2881..2946) has no baked entrance',
    3542: 'Mort Myre islet reached by the Bridge jump at (3440,3331), not baked',
    3546: 'islet reached by the Rock Jump-From at (2531,3029), not baked',
    3548: 'pocket reached by the Ladder at (2575,3029), not baked',
    3552: 'Kharidian desert entry consumes a bought Shantay pass (state-aware crossing)',
    3554: 'Kharidian desert entry consumes a bought Shantay pass (state-aware crossing)',
    3560: 'Isafdar — requires Regicide',
    3562: 'Isafdar — requires Regicide',
    3564: 'elf camp — requires Regicide',
    3572: 'the ladder at (2701,3408) lands on a 1-tile pocket at level 1',
    3579: 'region at (2802..2878, 3329..3393) has no baked entrance'
};

export function packUnreachable(id: number): string | null {
    return PACK_UNREACHABLE[id] ?? null;
}
