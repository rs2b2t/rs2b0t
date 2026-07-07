// Mime random event solver tables. Server truth (macro_event_mime.rs2):
// the mime (npc 1056 'Mime') plays anim random(8) at cycle phase 1; the
// macro_mime_emotes CHAT interface opens at phase 4; buttons com_2..com_9
// answer emotes 0..7; 4 correct in a row releases you. Seq ids from
// pack/seq.pack, interface com ids from pack/interface.pack.

export const MIME_IF = {
    root: 6543,
    /** com_2..com_9 — index = server emote number 0..7. */
    buttons: [6546, 6547, 6548, 6549, 6550, 6551, 6552, 6553] as const
};

/** seq id → server emote index: cry, think, laugh, dance, climbing rope,
 *  mime lean, glass wall, glass box. Bow (858) and cheer (862) are NOT
 *  answers — the mime plays them as stage business. */
export const MIME_EMOTE_BY_SEQ: Record<number, number> = {
    860: 0, // emote_cry
    857: 1, // emote_think
    861: 2, // emote_laugh
    866: 3, // emote_dance
    1130: 4, // emote_climbing_rope
    1129: 5, // emote_mime_lean
    1128: 6, // emote_glass_wall
    1131: 7 // emote_glass_box
};

export function mimeAnswer(lastSeenSeq: number | null): number | null {
    if (lastSeenSeq === null) {
        return null;
    }
    return MIME_EMOTE_BY_SEQ[lastSeenSeq] ?? null;
}
