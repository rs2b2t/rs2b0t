import { Paint, type PaintFrame } from '#/bot/paint/Paint.js';
import type { Dock } from '#/bot/paint/paintLogic.js';

export const JIVE_ACCENT = '#e05be0';
export const JIVE_BYLINE = 'Jive scripts';

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
