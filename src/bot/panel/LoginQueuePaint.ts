import type { LoginQueueStatus } from '../runtime/LoginCoordination.js';

export const LOGIN_QUEUE_PAINT_RECT = { x: 471, y: 12, w: 282, h: 54 } as const;

/** Compact global status card; it does not claim the script paint's input regions. */
export function paintLoginQueue(ctx: CanvasRenderingContext2D, status: LoginQueueStatus): void {
    const { x, y, w, h } = LOGIN_QUEUE_PAINT_RECT;

    ctx.fillStyle = 'rgba(12, 12, 14, 0.92)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(240, 198, 116, 0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    ctx.fillStyle = '#f0c674';
    ctx.fillRect(x, y, 4, h);
    ctx.font = 'bold 11px monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText('AUTO-LOGIN QUEUE', x + 16, y + 16);

    ctx.fillStyle = '#cdd3da';
    ctx.font = 'bold 15px monospace';
    ctx.fillText(`Position ${status.position} of ${status.total}`, x + 16, y + 38);
}
