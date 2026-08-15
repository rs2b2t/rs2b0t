/**
 * Pure forward recovery on stall: prefer the furthest clickable tile ahead on
 * the same path chain instead of immediately repathing.
 */

import { chebyshev, type PathTileLike } from './geometry/followMath.js';

// Why: the highest index that is clickable and not behind the player on the path wins.
// Why: -1 means nothing usable was found, so the caller should repath or door-scan.

/** Furthest index in [fromIdx+1, limitIdx] on the same level, within corridor of `me` or clickable. */
export function findForwardRecoveryIndex(
    tiles: PathTileLike[],
    me: PathTileLike,
    fromIdx: number,
    isClickable: (t: PathTileLike) => boolean,
    opts?: { corridor?: number; window?: number; limitIdx?: number }
): number {
    if (tiles.length === 0) {
        return -1;
    }
    const corridor = opts?.corridor ?? 3;
    const window = opts?.window ?? 40;
    const limitIdx = Math.min(opts?.limitIdx ?? tiles.length - 1, tiles.length - 1);
    const hi = Math.min(fromIdx + window, limitIdx);

    let bestClickable = -1;
    let bestOnCorridor = -1;
    for (let i = fromIdx + 1; i <= hi; i++) {
        const t = tiles[i]!;
        if (t.level !== me.level) {
            continue;
        }
        // Prefer tiles still ahead: not the tile we're standing on.
        if (t.x === me.x && t.z === me.z) {
            continue;
        }
        if (chebyshev(me, t) <= corridor) {
            bestOnCorridor = i;
        }
        if (isClickable(t)) {
            bestClickable = i;
        }
    }
    // Furthest clickable wins; else furthest corridor tile to re-anchor.
    if (bestClickable !== -1) {
        return bestClickable;
    }
    return bestOnCorridor;
}

// Why: `recover` clicks further along the published path, `combat` holds course for a fight rather than a nav problem, and `escalate` opens a route door, dismisses a quest lock, or declares blocked/repath.
// Why: the search window for {@link findForwardRecoveryIndex} is capped at the tile before the next hop, so `recoverIdx === -1` happens when and only when the walk has already reached that hop's approach — the door/stair case that most needs the escalation ladder.
// Why: repathing there replans the same route and burns the repath budget until the walk reports failure, which `walkResilient` then escalates to unreachable.
type StallPhase = 'recover' | 'combat' | 'escalate';

export function stallPhase(opts: { stallRetries: number; recoverIdx: number; inCombat: boolean }): StallPhase {
    if (opts.stallRetries === 0 && opts.recoverIdx !== -1) {
        return 'recover';
    }
    return opts.inCombat ? 'combat' : 'escalate';
}
