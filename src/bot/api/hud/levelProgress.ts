/**
 * RuneScape experience curve, for "how far to the next level" readouts.
 *
 * The table is generated once rather than written out: the curve is the classic
 * sum of `floor(l + 300 * 2^(l/7)) / 4`, so a literal table would just be a
 * transcription waiting to drift.
 */
const MAX_LEVEL = 99;

const XP_AT_LEVEL: number[] = (() => {
    const out = [0, 0];
    let points = 0;
    for (let level = 1; level < MAX_LEVEL; level++) {
        points += Math.floor(level + 300 * Math.pow(2, level / 7));
        out[level + 1] = Math.floor(points / 4);
    }
    return out;
})();

/** Total experience required to reach `level` (1–99). */
export function xpAtLevel(level: number): number {
    return XP_AT_LEVEL[Math.min(MAX_LEVEL, Math.max(1, Math.floor(level)))] ?? 0;
}

export interface LevelProgress {
    level: number;
    /** 0–1 through the current level; 1 at 99. */
    fraction: number;
    /** Experience still needed for the next level; 0 at 99. */
    remaining: number;
}

/** Where `xp` sits between its level and the next. */
export function levelProgress(level: number, xp: number): LevelProgress {
    if (level >= MAX_LEVEL) {
        return { level: MAX_LEVEL, fraction: 1, remaining: 0 };
    }
    const base = xpAtLevel(level);
    const next = xpAtLevel(level + 1);
    const span = next - base;
    const into = Math.min(Math.max(0, xp - base), span);
    return { level, fraction: span > 0 ? into / span : 1, remaining: Math.max(0, next - xp) };
}

/** Hours to the next level at this rate, or null when it is not moving. */
export function etaHours(remaining: number, xpPerHour: number): number | null {
    if (remaining <= 0 || xpPerHour <= 0) {
        return null;
    }
    return remaining / xpPerHour;
}
