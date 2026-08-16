import { describe, expect, test } from 'bun:test';
import { LOGIN_QUEUE_PAINT_RECT, paintLoginQueue, queueAheadLabel } from '#/bot/panel/LoginQueuePaint.js';
import { resolveDock, type Rect } from '#/bot/paint/paintLogic.js';

function overlaps(a: Rect, b: Rect): boolean {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

describe('auto-login queue paint', () => {
    test('draws a truthful two-line status card', () => {
        const text: Array<{ value: string; x: number; y: number }> = [];
        const fills: Array<[number, number, number, number]> = [];
        const ctx = {
            fillStyle: '',
            strokeStyle: '',
            lineWidth: 0,
            font: '',
            textBaseline: 'alphabetic',
            fillRect: (x: number, y: number, w: number, h: number) => fills.push([x, y, w, h]),
            strokeRect: () => {},
            fillText: (value: string, x: number, y: number) => text.push({ value, x, y })
        } as unknown as CanvasRenderingContext2D;

        paintLoginQueue(ctx, { position: 27, total: 103 });

        expect(text.map(line => line.value)).toEqual([
            'AUTO-LOGIN QUEUE',
            '26 bots in front'
        ]);
        expect(queueAheadLabel(1)).toBe('0 bots in front');
        expect(queueAheadLabel(2)).toBe('1 bot in front');
        expect(fills[0]).toEqual([
            LOGIN_QUEUE_PAINT_RECT.x,
            LOGIN_QUEUE_PAINT_RECT.y,
            LOGIN_QUEUE_PAINT_RECT.w,
            LOGIN_QUEUE_PAINT_RECT.h
        ]);
    });

    test('does not overlap either built-in script paint dock', () => {
        expect(LOGIN_QUEUE_PAINT_RECT.x).toBeGreaterThanOrEqual(0);
        expect(LOGIN_QUEUE_PAINT_RECT.y).toBeGreaterThanOrEqual(0);
        expect(LOGIN_QUEUE_PAINT_RECT.x + LOGIN_QUEUE_PAINT_RECT.w).toBeLessThanOrEqual(765);
        expect(LOGIN_QUEUE_PAINT_RECT.y + LOGIN_QUEUE_PAINT_RECT.h).toBeLessThanOrEqual(503);
        expect(overlaps(LOGIN_QUEUE_PAINT_RECT, resolveDock('topleft'))).toBe(false);
        expect(overlaps(LOGIN_QUEUE_PAINT_RECT, resolveDock('chatbox'))).toBe(false);
    });
});
