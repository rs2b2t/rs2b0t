import { BotHost } from '../BotHost.js';
import { paintNavPath } from '../nav/pathOverlay.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';

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

        // Path paint is independent of script onPaint (operator toggle).
        try {
            ctx.save();
            paintNavPath(ctx);
        } catch (err) {
            console.error('[rs2b0t] path overlay error', err);
        } finally {
            ctx.restore();
        }

        const state = ScriptRunner.state;
        const active = state === 'running' || state === 'paused';

        const bot = ScriptRunner.bot;
        if (!bot?.onPaint || !active) {
            return;
        }

        try {
            ctx.save();
            bot.onPaint(ctx);
        } catch (err) {
            console.error('[rs2b0t] onPaint error', err);
        } finally {
            ctx.restore();
        }
    }
}
