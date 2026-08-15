import { beforeEach, expect, test } from 'bun:test';
import { Paint } from '#/bot/paint/Paint.js';
import { paintState } from '#/bot/paint/paintLogic.js';

// stub 2d context — the paint only measures text and fills rects
function stubCtx(): CanvasRenderingContext2D {
    return {
        font: '',
        textBaseline: '',
        fillStyle: '',
        strokeStyle: '',
        fillRect: () => {},
        strokeRect: () => {},
        fillText: () => {},
        measureText: (t: string) => ({ width: t.length * 7.2 })
    } as never as CanvasRenderingContext2D;
}

let regions: { id: string; x: number; y: number; w: number; h: number }[] = [];

beforeEach(() => {
    paintState.reset();
    const publish = paintState.publishRegions.bind(paintState);
    paintState.publishRegions = (r): void => { regions = r.map(x => ({ id: x.id, x: x.x, y: x.y, w: x.w, h: x.h })); publish(r); };
});

// mirrors NatureCrafter.onPaint's runner branch — the live gobank probe clicks this rect
function runnerPaint(): void {
    const p = Paint.begin(stubCtx(), { dock: 'chatbox', accent: '#a0e6c8' });
    p.title('NatureCrafter — runner — delivering');
    p.row('Runtime: 1m', 'Mode: Runner', 'To: master');
    p.row('Deliveries: 0', 'Ess sent: 0', 'Coins: 10000');
    p.row('Pack ess: 25', 'noted: 1', 'unnoted: 25');
    p.gap();
    p.buttons([{ id: 'gobank', label: 'Go bank' }]);
    p.end();
}

test('the runner paint publishes a clickable Go bank button', () => {
    runnerPaint();
    const btn = regions.find(r => r.id === 'btn:gobank');
    expect(btn).toBeDefined();
    expect(btn!.h).toBeGreaterThan(0);
    expect(btn!.w).toBeGreaterThan(0);
});

test('the canvas point the live probe clicks lands inside that button', () => {
    runnerPaint();
    const btn = regions.find(r => r.id === 'btn:gobank')!;
    const PROBE = { x: 40, y: 429 }; // Go-bank button centre
    expect(PROBE.x).toBeGreaterThanOrEqual(btn.x);
    expect(PROBE.x).toBeLessThan(btn.x + btn.w);
    expect(PROBE.y).toBeGreaterThanOrEqual(btn.y);
    expect(PROBE.y).toBeLessThan(btn.y + btn.h);
});

test('a click at that point is routed to the gobank widget', () => {
    runnerPaint();
    expect(paintState.pointerDown(40, 429)).toBe(true);
    expect(paintState.consumeClick('btn:gobank')).toBe(true);
});
