import { BotHost } from '../runtime/BotHost.js';
import { isNavPathPaintEnabled } from '../event/webwalk/pathOverlay.js';
import { paintNavPath } from '../event/webwalk/pathOverlay.js';
import { PathPublish } from '../event/webwalk/pathPublish.js';
import { AutoRelogin } from '../runtime/AutoRelogin.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import { paintLoginQueue } from './LoginQueuePaint.js';

export function shouldPaintOverlay(opts: {
    pathEnabled: boolean;
    pathTiles: number;
    scriptPaintReady: boolean;
    hasOnPaint: boolean;
    loginQueued: boolean;
}): boolean {
    const pathLabels = opts.pathEnabled && opts.pathTiles > 0;
    const botPaint = opts.hasOnPaint && opts.scriptPaintReady;
    return pathLabels || botPaint || opts.loginQueued;
}

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
        const pathEnabled = isNavPathPaintEnabled();
        const pathLabels =
            pathEnabled && path !== null && path.tiles.length > 0;
        const bot = ScriptRunner.paintBot;
        const botPaint = Boolean(bot?.onPaint);
        const loginQueueStatus = AutoRelogin.loginQueueStatus();

        if (!shouldPaintOverlay({
            pathEnabled,
            pathTiles: path?.tiles.length ?? 0,
            scriptPaintReady: bot !== null,
            hasOnPaint: Boolean(bot?.onPaint),
            loginQueued: loginQueueStatus !== null
        })) {
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

        if (loginQueueStatus !== null) {
            try {
                ctx.save();
                paintLoginQueue(ctx, loginQueueStatus);
            } catch (err) {
                console.error('[rs2b0t] login queue paint error', err);
            } finally {
                ctx.restore();
            }
        }

        // Script paint owns the final layer. The queue card is normally title-only,
        // but this ordering prevents it obscuring a future script that paints there.
        if (botPaint && bot?.onPaint) {
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
}
