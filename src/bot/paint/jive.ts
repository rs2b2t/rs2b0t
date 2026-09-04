import { Paint, type PaintFrame } from '#/bot/paint/Paint.js';
import { levelRow, type SkillGain } from '#/bot/paint/levelProgress.js';
import type { Dock } from '#/bot/paint/paintLogic.js';

export const JIVE_ACCENT = '#e05be0';
export const JIVE_BYLINE = 'Jive scripts';
/** Every skill a fight can move, for the combat scripts' Levels section. */
export const COMBAT_SKILLS = ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic', 'prayer'] as const;
const DIM = '#8a919a';

export interface JiveFrameOptions {
    script: string;
    status: string;
    pages: string[];
    /** Rail entries for the first page. Later pages draw no rail. */
    sections: string[];
    dock?: Dock;
}

export interface JiveFrame {
    frame: PaintFrame;
    page: string;
    section: string;
}

/** The Jive chrome: a branded strip, a rail on the first page, and a byline. */
export function jiveFrame(ctx: CanvasRenderingContext2D, opts: JiveFrameOptions): JiveFrame {
    const frame = Paint.begin(ctx, { dock: opts.dock ?? 'chatbox', accent: JIVE_ACCENT });
    const page = frame.strip(`jive:${opts.script}`, opts.pages, opts.status, opts.script);
    const section = page === opts.pages[0] ? frame.rail(`jive:${opts.script}`, opts.sections) : '';
    frame.footer(JIVE_BYLINE);
    return { frame, page, section };
}

interface SkillReader {
    xp(skill: string): number;
    level(skill: string): number;
}

/** Experience since `begin()` for a fixed list of skills, read through whatever answers `xp` and `level`. */
export class XpTracker {
    private start = new Map<string, number>();

    constructor(private readonly skills: readonly string[], private readonly read: SkillReader) {}

    begin(): void {
        this.start.clear();
        for (const skill of this.skills) {
            this.start.set(skill, this.read.xp(skill));
        }
    }

    /** Every tracked skill, gained or not. */
    progress(): SkillGain[] {
        return this.skills.map(skill => {
            const xp = this.read.xp(skill);
            return { skill, level: this.read.level(skill), xp, gained: xp - (this.start.get(skill) ?? xp) };
        });
    }

    /** The skills that moved since begin, biggest gain first. */
    gains(): SkillGain[] {
        return this.progress().filter(g => g.gained > 0).sort((a, b) => b.gained - a.gained);
    }
}

// Why: a bar and its eta row take two lines, so the section shows as many skills as fit above the rows kept for the controls rather than painting over them.
/** A level bar and an eta row per skill, in order, as many as fit above `reserve` rows. */
export function paintLevels(p: PaintFrame, gains: readonly SkillGain[], mins: number, reserve: number, empty = 'no experience yet'): void {
    if (gains.length === 0) {
        p.text(empty, DIM);
        return;
    }
    const room = Math.max(0, Math.floor((p.rowsLeft() - reserve) / 2));
    for (const g of gains.slice(0, room)) {
        const row = levelRow(g, mins);
        p.bar(row.label, row.fraction);
        p.row(...row.cells);
    }
}
