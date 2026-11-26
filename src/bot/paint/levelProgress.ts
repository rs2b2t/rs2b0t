// RuneScape experience curve, for "how far to the next level" readouts.

import { buildExperienceThresholds, MAX_LEVEL } from '#/shared/experience.js';

import { fmtDuration, fmtXpHr, paintSkillShort } from './paintLogic.js';

const EXPERIENCE_THRESHOLDS = buildExperienceThresholds();

/** Total experience required to reach `level` (1–99). */
export function xpAtLevel(level: number): number {
    const clampedLevel = Math.min(MAX_LEVEL, Math.max(1, Math.floor(level)));
    return EXPERIENCE_THRESHOLDS[clampedLevel - 2] ?? 0;
}

interface LevelProgress {
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

export interface SkillGain {
    skill: string;
    level: number;
    xp: number;
    /** Experience gained since the script began. */
    gained: number;
}

export interface LevelRow {
    label: string;
    fraction: number;
    /** The rate, the gap and the eta, for the row under the bar. */
    cells: [string, string, string];
}

/** The bar and the line under it for one skill, from what it gained over `mins`. */
export function levelRow(g: SkillGain, mins: number): LevelRow {
    const prog = levelProgress(g.level, g.xp);
    const rate = mins > 0.5 ? (g.gained / mins) * 60 : 0;
    const eta = etaHours(prog.remaining, rate);
    const perHour = mins > 0.5 ? `${fmtXpHr(g.gained, mins)}/hr` : 'xp/hr n/a';
    if (prog.level >= MAX_LEVEL) {
        return { label: `${paintSkillShort(g.skill)} ${prog.level}`, fraction: 1, cells: [perHour, 'maxed', ''] };
    }
    return {
        label: `${paintSkillShort(g.skill)} ${prog.level}`,
        fraction: prog.fraction,
        cells: [perHour, `${prog.remaining.toLocaleString()} to go`, eta === null ? 'eta n/a' : `eta ${fmtDuration(eta * 60)}`]
    };
}
