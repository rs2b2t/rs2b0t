import { BotHost } from '../BotHost.js';
import { isNavPathPaintEnabled } from '../nav/pathOverlay.js';
import { paintNavPath } from '../nav/pathOverlay.js';
import { PathPublish } from '../nav/pathPublish.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';

export default class Overlay {
    private readonly ctx2d: CanvasRenderingContext2D | null;
    private readonly canvas: HTMLCanvasElement;
    /** True if the previous draw left pixels; need one clear when going idle. */
    private hadContent = false;

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

        const path = PathPublish.get();
        const pathLabels =
            isNavPathPaintEnabled() && path !== null && path.tiles.length > 0;
        const state = ScriptRunner.state;
        const scriptActive = state === 'running' || state === 'paused';
        const bot = ScriptRunner.bot;
        const botPaint = Boolean(bot?.onPaint && scriptActive);

        if (!pathLabels && !botPaint) {
            if (this.hadContent) {
                ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                this.hadContent = false;
            }
            return;
        }

        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.hadContent = true;

        // Path *tile quads* paint into areaGame (BotClient.onAfterWorldRender).
        // HTML overlay keeps hop labels + click caption so text stays crisp.
        if (pathLabels) {
            try {
                ctx.save();
                paintNavPath(ctx, { labelsOnly: true });
            } catch (err) {
                console.error('[rs2b0t] path overlay error', err);
            } finally {
                ctx.restore();
            }
        }

        if (!botPaint || !bot?.onPaint) {
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
