import { beforeEach, expect, test } from 'bun:test';
import { installPaintInput } from '#/bot/ui/PaintInput.js';
import { paintState } from '#/bot/api/hud/paintLogic.js';

let canvas: HTMLElement;
let clientSaw: string[];

beforeEach(() => {
    document.body.replaceChildren();
    paintState.reset();
    canvas = document.createElement('div');
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
    expect(clientSaw).toEqual([]);
    expect(paintState.consumeClick('btn:pause')).toBe(true);
});

test('mousedown outside the paint reaches the client untouched', () => {
    paintState.publishRegions([{ id: 'paint:panel', x: 8, y: 345, w: 506, h: 150, kind: 'panel' }]);
    mouseDown(300, 100);
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
    mouseDown(40, 900);
    expect(clientSaw).toEqual([]);
    mouseDown(1200, 200);
    expect(clientSaw.length).toBe(1);
});
