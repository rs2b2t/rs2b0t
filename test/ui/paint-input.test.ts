import { beforeEach, expect, test } from 'bun:test';
import { installPaintInput } from '#/bot/ui/PaintInput.js';
import { paintState } from '#/bot/api/hud/paintLogic.js';

// The capture layer must beat the client's level-0 handlers (GameShell binds
// `canvas.onmousedown = …`) for events inside paint regions, and stay
// invisible outside them. happy-dom fires capture listeners before level-0
// handlers, matching the browser.
let canvas: HTMLElement;
let clientSaw: string[];

beforeEach(() => {
    document.body.replaceChildren();
    paintState.reset();
    canvas = document.createElement('div');
    // logical 765x503 mapped 1:1 (happy-dom rects default 0x0 — stub it)
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 765, height: 503 }) as DOMRect;
    document.body.appendChild(canvas);
    clientSaw = [];
    (canvas as never as { onmousedown: (e: MouseEvent) => void }).onmousedown = e => clientSaw.push(`down@${e.clientX},${e.clientY}`);
    installPaintInput(canvas);
});

function mouseDown(x: number, y: number): void {
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
}

test('mousedown inside a paint region is swallowed and queued for the widget', () => {
    paintState.publishRegions([
        { id: 'paint:panel', x: 8, y: 345, w: 506, h: 150, kind: 'panel' },
        { id: 'btn:pause', x: 16, y: 420, w: 60, h: 16, kind: 'widget' }
    ]);
    mouseDown(20, 425);
    expect(clientSaw).toEqual([]); // client never saw it
    expect(paintState.consumeClick('btn:pause')).toBe(true);
});

test('mousedown outside the paint reaches the client untouched', () => {
    paintState.publishRegions([{ id: 'paint:panel', x: 8, y: 345, w: 506, h: 150, kind: 'panel' }]);
    mouseDown(300, 100); // open game area
    expect(clientSaw).toEqual(['down@300,100']);
});

test('after paintState.reset() (script stopped) nothing is swallowed', () => {
    paintState.publishRegions([{ id: 'paint:panel', x: 8, y: 345, w: 506, h: 150, kind: 'panel' }]);
    paintState.reset();
    mouseDown(20, 425);
    expect(clientSaw.length).toBe(1);
});

test('CSS scaling maps correctly (2x-wide canvas)', () => {
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1530, height: 1006 }) as DOMRect;
    paintState.publishRegions([{ id: 'paint:panel', x: 8, y: 345, w: 506, h: 150, kind: 'panel' }]);
    mouseDown(40, 900); // css → logical (20,450): inside the panel
    expect(clientSaw).toEqual([]);
    mouseDown(1200, 200); // logical (600,100): outside
    expect(clientSaw.length).toBe(1);
});
