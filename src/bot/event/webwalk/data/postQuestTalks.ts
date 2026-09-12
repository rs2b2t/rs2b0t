// docs/reference/nav-doors.md#special-crossings
// Crossings unlocked by dialogue after the quest journal already reads complete.
// Why: the walker cannot see the finer server stage, so it talks only after the crossing refuses.

export interface PostQuestTalk {
    /** Loc placement of the crossing this unlocks (`transport.locX` / `locZ`). */
    locX: number;
    locZ: number;
    level: number;
/** Quest that must already read complete. */
    requireComplete: string;
    npc: string;
    /** Where to stand to talk. */
    stand: { x: number; z: number; level: number };
    /** Dialogue options to prefer; most of these are continue-only. */
    choose?: string[];
// Why: Drezel may return Wolfbane before granting barrier access, so one talk is not always enough.

    /** How many times to hold the conversation. */
    talks?: number;
    label: string;
}

const POST_QUEST_TALKS: readonly PostQuestTalk[] = [
    {
        // Drezel sets stage 61 within 20 tiles of the barrier; reuse the Mort Myre unlock stand.
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
