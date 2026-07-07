import { ActionRouter } from '../input/ActionRouter.js';
import { VirtualInput } from '../input/VirtualInput.js';

/**
 * Renders the synthetic virtual cursor and a fading motion trail on the
 * overlay, so you can watch how the bot simulates mouse movement (WindMouse
 * trajectories, overshoot, click jitter). Reads VirtualInput's telemetry ring
 * — purely a visualization, it emits nothing.
 *
 * Only draws when there's recent synthetic activity; DIRECT-mode bots have no
 * cursor and show a small label instead.
 */

const TRAIL_MS = 1400; // how far back the tail reaches
const CLICK_MS = 600; // click ring lifetime

export function drawCursorTrail(ctx: CanvasRenderingContext2D): void {
    const now = performance.now();
    const events = VirtualInput.stream();

    // recent points for the tail (newest last)
    const recent = events.filter(ev => now - ev.t <= TRAIL_MS);

    if (ActionRouter.activeMode !== 'synthetic') {
        return; // no virtual cursor in direct mode
    }

    ctx.save();

    // fading poly-tail: older = fainter + thinner
    if (recent.length >= 2) {
        for (let i = 1; i < recent.length; i++) {
            const a = recent[i - 1];
            const b = recent[i];
            const age = (now - b.t) / TRAIL_MS; // 0 newest .. 1 oldest
            const alpha = Math.max(0, 0.85 * (1 - age));
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `rgba(120, 230, 255, ${alpha.toFixed(3)})`;
            ctx.lineWidth = 0.6 + 2.4 * (1 - age);
            ctx.lineCap = 'round';
            ctx.stroke();
        }
    }

    // click markers: expanding rings at recent button-down points
    for (const ev of events) {
        if (ev.e !== 'd') {
            continue;
        }
        const dt = now - ev.t;
        if (dt > CLICK_MS) {
            continue;
        }
        const p = dt / CLICK_MS; // 0..1
        const radius = 3 + 11 * p;
        const alpha = 0.9 * (1 - p);
        ctx.beginPath();
        ctx.arc(ev.x, ev.y, radius, 0, Math.PI * 2);
        // right-click (b=2) amber, left-click (b=1) green
        ctx.strokeStyle = ev.b === 2 ? `rgba(255, 190, 90, ${alpha.toFixed(3)})` : `rgba(120, 255, 150, ${alpha.toFixed(3)})`;
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // the cursor itself: a small ring + crosshair at the live virtual position
    const cx = VirtualInput.x;
    const cy = VirtualInput.y;
    ctx.beginPath();
    ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy);
    ctx.lineTo(cx - 2, cy);
    ctx.moveTo(cx + 2, cy);
    ctx.lineTo(cx + 8, cy);
    ctx.moveTo(cx, cy - 8);
    ctx.lineTo(cx, cy - 2);
    ctx.moveTo(cx, cy + 2);
    ctx.lineTo(cx, cy + 8);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();
}
