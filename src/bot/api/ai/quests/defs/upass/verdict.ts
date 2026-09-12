import { CANT_REACH, GameMessages, WRONG_SIDE } from '../../../../chatbox/gameMessages.js';

/** What an obstacle's script said it did. */
export type Verdict = 'refused' | 'failed' | 'crossing';

// Why: every obstacle in the pass announces its outcome in the chatbox in the tick the op resolves, so waiting on a tile instead costs a refusal the full crossing timeout, the settle and the reachability poll. The op's own words are the fastest oracle.

/** The op won't work from here, however many times it's sent. */
const REFUSED: readonly RegExp[] = [
    CANT_REACH,
    WRONG_SIDE,
    // Why: Crossing cooldowns last 3 to 15 ticks, and failed swings may leave a blocking `~mesbox`, so wait before retrying.
    /is being used/i,
    /blocked by a grill/i,
    /cannot open the grill from this side/i,
    /need a thieving level/i
];

/** The roll failed and you're where you were; another try is worth sending. */
const FAILED: readonly RegExp[] = [
    /but you slip back down/i,
    /you fail to pick the lock/i,
    /and fall off it/i,
    /you fall in to the rat pit/i,
    /but you slip and tumble into the darkness/i,
    /you try to swing but fall in to the darkness/i,
    /and fail, activating the trap/i
];

/** The script is carrying you across, the one outcome worth waiting out. */
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
 * Why: the last verdict. One attempt loop keeps one mark across 4 rolls, so a seam that slipped then landed has both a failure and a crossing in the ring, and the last one says where you are now.
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
