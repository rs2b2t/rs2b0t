// Mime random event solver. Server truth (macro_event_mime.rs2):
// the mime (npc 1056 'Mime') plays anim random(8) at cycle phase 1; the
// macro_mime_emotes CHAT interface opens at phase 4; buttons com_2..com_9
// answer emotes 0..7; 4 correct in a row releases you. Seq ids from
// pack/seq.pack, interface com ids from pack/interface.pack.

import { actions, reader } from '../../adapter/ClientAdapter.js';
import { Execution } from '../Execution.js';

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

/** The mime stage's mapsquare (detection + on-stage checks key off it). */
export const MIME_SQUARE = { mx: 31, mz: 74 };

/**
 * Mime stage: watch the mime's performance and mirror it. The mime plays
 * an answerable emote (phase 1); when the macro_mime_emotes chat interface
 * opens (phase 4) we click the matching emote button. 4 correct in a row
 * releases us and teleports us home — the loop repeats across cycles, and
 * a wrong answer just resets the server-side chain. The caller runs this
 * while handling===true so its own waits don't self-interrupt.
 */
export async function performMimeStage(log: (msg: string) => void): Promise<boolean> {
    log('random event: mime stage — copying the performance');
    const onStage = (): boolean => {
        const me = reader.worldTile();
        return me !== null && me.level === 0 && me.x >> 6 === MIME_SQUARE.mx && me.z >> 6 === MIME_SQUARE.mz;
    };

    let lastSeen: number | null = null;
    const deadline = performance.now() + 180_000; // ~9 full cycles

    while (onStage() && performance.now() < deadline) {
        // remember the mime's most recent ANSWERABLE emote (phase 1);
        // bow/cheer/idle are filtered by the mapping
        const mime = reader.npcs().find(n => (n.name ?? '').toLowerCase() === 'mime');
        if (mime && MIME_EMOTE_BY_SEQ[mime.anim] !== undefined) {
            lastSeen = mime.anim;
        }

        if (reader.modals().chat === MIME_IF.root) {
            const answer = mimeAnswer(lastSeen);
            if (answer !== null) {
                actions.ifButton(MIME_IF.buttons[answer]);
                log(`mime: performed emote ${answer}`);
                lastSeen = null;
                await Execution.delayUntil(() => reader.modals().chat !== MIME_IF.root || !onStage(), 10_000);
                continue;
            }
            // joined mid-cycle with nothing seen — let this round pass
        }
        await Execution.delayTicks(1);
    }

    log(onStage() ? 'mime: still on stage after 3min — will retry' : 'random event: mime solved — returned');
    return true;
}
