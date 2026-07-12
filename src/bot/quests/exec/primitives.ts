// Quest-executor primitives (first consumer: RuneMysteries). Pure helpers
// here; the I/O walkers/talkers are added alongside them (gotoNpc,
// talkThrough, hopLadder) and stay thin so all decision logic is testable.

/**
 * First `prefer` entry that case-insensitively substring-matches one of
 * `options`, returned as the FULL option text (ChatDialog.chooseOption wants
 * the visible label). Null when nothing matches — the caller decides the
 * fallback and warns, because a fallback firing means the dialogue drifted
 * from the .rs2 sources the prefer list was written against. Pure.
 */
export function pickPreferred(options: string[], prefer: string[]): string | null {
    for (const p of prefer) {
        const hit = options.find(o => o.toLowerCase().includes(p.toLowerCase()));
        if (hit) {
            return hit;
        }
    }
    return null;
}

/** Underground mapsquares are the surface z + 6400 (wizard basement 3162 →
 *  9562-region). Surface z tops out ~4100, so 5000 splits cleanly. Pure. */
export function isUnderground(t: { z: number }): boolean {
    return t.z >= 5000;
}

/** A ladder hop is needed when here/anchor disagree about undergroundness —
 *  the A* graph doesn't span the boundary (no baked edge; the 2D heuristic
 *  can't cross the +6400 offset usefully). Pure. */
export function needsHop(here: { z: number }, anchor: { z: number }): boolean {
    return isUnderground(here) !== isUnderground(anchor);
}
