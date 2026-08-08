/**
 * Crossings that need a conversation **after** the quest is already complete.
 *
 * The Salve holy barrier is the case: `holy_barrier.rs2` tests
 * `%priestperil = ^priestperil_access_holy_barrier` (61), and completing Priest
 * in Peril only reaches `^priestperil_complete` (60). The extra stage comes from
 * one post-quest talk with Drezel in the mausoleum. Both stages show the quest
 * as complete in the journal, and the journal is the only quest state on the
 * wire — so there is nothing to test before trying.
 *
 * The walker therefore attempts the crossing first and consults this table only
 * when it refuses, at most once per placement per run. A player already past the
 * conversation never pays for it.
 *
 * @see docs/NAV.md#special-crossings
 */

export interface PostQuestTalk {
    /** Loc placement of the crossing this unlocks (`transport.locX` / `locZ`). */
    locX: number;
    locZ: number;
    level: number;
    /** Pointless unless this quest already reads complete. */
    requireComplete: string;
    npc: string;
    /** Where to stand to talk. */
    stand: { x: number; z: number; level: number };
    /** Dialogue options to prefer; most of these are continue-only. */
    choose?: string[];
    /**
     * How many times to hold the conversation. Drezel spends his first one
     * handing back the Wolfbane dagger (`@reclaim_wolfbane_dagger`) and only
     * grants barrier access on the next, so one talk is not always enough.
     */
    talks?: number;
    label: string;
}

export const POST_QUEST_TALKS: readonly PostQuestTalk[] = [
    {
        // area_mausoleum/drezel.rs2 → @drezel_access_holy_barrier sets stage 61.
        // Drezel only answers within 20 tiles of the barrier, which the mausoleum
        // stand satisfies; it is the same stand the Mort Myre gate unlock uses.
        locX: 3440,
        locZ: 9886,
        level: 0,
        requireComplete: 'Priest in Peril',
        npc: 'Drezel',
        stand: { x: 3439, z: 9895, level: 0 },
        talks: 2,
        label: 'Salve barrier access (Drezel, post Priest in Peril)'
    }
];

export function postQuestTalkFor(locX: number, locZ: number, level: number): PostQuestTalk | null {
    return (
        POST_QUEST_TALKS.find(t => t.locX === locX && t.locZ === locZ && t.level === level) ?? null
    );
}
