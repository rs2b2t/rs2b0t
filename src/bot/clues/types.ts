/** Types for the easy-clue answer DB. Kept in src (not tools/) so the
 *  generated data file (data/cluedb.ts) and the runtime solver can import them
 *  without depending on the dev-only generator. Mirrors src/bot/shops/types.ts. */
import type { NavPoint } from '#/bot/nav/PathFinder.js';

export type ClueType = 'search' | 'dig' | 'talk';

/** One easy clue, keyed in CLUE_DB by its obj id (all 66 are named "Clue
 *  scroll" but carry distinct ids — the only client-readable discriminator).
 *   - search: walk to `coord` and search the loc there.
 *   - dig:    walk to `coord` and dig; the reward is `casketObj`/`casketId`.
 *   - talk:   talk to the NPC named `npc`. */
export interface ClueRow {
    obj: string; // content obj name, e.g. 'trail_clue_easy_simple021'
    id: number; // obj id (the held-item discriminator)
    type: ClueType;
    coord?: NavPoint; // search/dig target (world tile)
    casketObj?: string; // dig only: casket obj name
    casketId?: number; // dig only: casket obj id
    npc?: string; // talk only: NPC display name, e.g. 'Ned'
    /** dig only: true for coordinate/sextant clues — require sextant+watch+chart
     *  held (in addition to a Spade) before the dig will yield the casket. */
    needsSextant?: boolean;
    /** search only: a kill-for-key riddle. The locked container at `coord` needs
     *  a key that drops when the named NPC is killed while the clue is held. */
    keyFrom?: { npc: string; keyObj: string; keyId: number };
}

/** One actionable step the solver hands the executor. Either a clue row
 *  (search/dig/talk) or — when a reward casket is already held — the
 *  open-casket step that must run first to advance the trail. Discriminated
 *  on `type` ('open-casket' vs ClueType). */
export type ClueStep = ClueRow | { type: 'open-casket'; casketObj: string; casketId: number };
