import { CANT_REACH, GameMessages, WRONG_SIDE } from '../../../../chatbox/gameMessages.js';

/** What an obstacle's script said it did. */
export type Verdict = 'refused' | 'failed' | 'crossing';

// Why: every obstacle in the pass announces its outcome in the chatbox in the same tick the op resolves, and the step was waiting on a tile instead — so a refusal cost the full crossing timeout, then the settle, then the reachability poll, for an answer it had already been given. Twelve of those in a row is a leg. The op's own words are the fastest honest oracle there is.

/** The op will not work from here, however many times it is sent. */
const REFUSED: readonly RegExp[] = [
    CANT_REACH,
    WRONG_SIDE,
    // Why: `%upass_rockswing_used`, `%upass_swampswing_used`, `%upass_area1_pipe_used` and `%upass_area2_pipe_used` are map_clock cooldowns of 3 to 15 ticks. Retrying inside one cannot pass, and the rock and the swamp swing answer with a `~mesbox` that holds a main modal open while the retry waits.
    /is being used/i,
    /blocked by a grill/i,
    /cannot open the grill from this side/i,
    /need a thieving level/i
];

/** The roll failed and the character is where they were — another try is worth sending. */
const FAILED: readonly RegExp[] = [
    /but you slip back down/i,
    /you fail to pick the lock/i,
    /and fall off it/i,
    /you fall in to the rat pit/i,
    /but you slip and tumble into the darkness/i,
    /you try to swing but fall in to the darkness/i,
    /and fail, activating the trap/i
];

/** The script is carrying the character across — this is the one outcome worth waiting out. */
const CROSSING: readonly RegExp[] = [
    /and step down the other side/i,
    /you manage to pick the lock/i,
    /you walk through/i,
    /you crawl through the pipe/i,
    /you skillfully swing across/i,
    /and make it\./i,
    /you manage to cross safely/i,
    /and quickly walk over/i,
    /and succeed, you quickly walk past/i
];

const CLASSES: readonly (readonly [Verdict, readonly RegExp[]])[] = [
    ['refused', REFUSED],
    ['failed', FAILED],
    ['crossing', CROSSING]
];

/**
 * What the obstacle said since `mark`, or null while it has said nothing.
 * Why: the LAST verdict, not the first. One attempt loop keeps one mark across four rolls, so a seam that slipped and then landed has both a failure and a crossing in the ring — and the one that describes where the character is now is the one at the end.
 */
export function verdictSince(mark: number): Verdict | null {
    const said = GameMessages.since(mark);
    for (let i = said.length - 1; i >= 0; i--) {
        for (const [verdict, patterns] of CLASSES) {
            if (patterns.some(p => { p.lastIndex = 0; return p.test(said[i]!.text); })) {
                return verdict;
            }
        }
    }
    return null;
}
