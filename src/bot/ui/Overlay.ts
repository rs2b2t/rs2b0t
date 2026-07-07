import { BotHost } from '../BotHost.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import { drawCursorTrail } from './CursorTrail.js';

/**
 * Owns the transparent overlay canvas stacked on the game canvas. Each redraw
 * it paints the synthetic-cursor trail (so you can watch the mouse sim) and
 * then the running script's onPaint(ctx) — bots draw stats without ever
 * touching Pix2D.
 */
export default class Overlay {
    private readonly ctx2d: CanvasRenderingContext2D | null;
    private readonly canvas: HTMLCanvasElement;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.ctx2d = canvas.getContext('2d');
        BotHost.addDrawListener(() => this.paint());
    }

    private paint(): void {
        const ctx = this.ctx2d;
        if (!ctx) {
            return;
        }

        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // cursor trail draws under the script's overlay, always while a script
        // is active (not just when the bot defines onPaint)
        const state = ScriptRunner.state;
        const active = state === 'running' || state === 'paused';
        if (active) {
            try {
                drawCursorTrail(ctx);
            } catch (err) {
                console.error('[lcbuddy] cursor trail error', err);
            }
        }

        const bot = ScriptRunner.bot;
        if (!bot?.onPaint || !active) {
            return;
        }

        try {
            ctx.save();
            bot.onPaint(ctx);
        } catch (err) {
            console.error('[lcbuddy] onPaint error', err);
        } finally {
            ctx.restore();
        }
    }
}
