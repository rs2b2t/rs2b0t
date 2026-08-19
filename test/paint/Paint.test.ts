import { beforeEach, describe, expect, test } from 'bun:test';
import { Paint } from '#/bot/paint/Paint.js';
import { paintState, resolveDock } from '#/bot/paint/paintLogic.js';

const PANEL = resolveDock('chatbox');
const CHAR_W = 7;

interface Drawn {
    text: string;
    x: number;
    y: number;
    color: string;
}

/** Monospace stand-in for a canvas: every glyph is CHAR_W wide. */
function recorder(): { ctx: CanvasRenderingContext2D; drawn: Drawn[] } {
    const drawn: Drawn[] = [];
    const ctx = {
        font: '',
        textBaseline: '',
        fillStyle: '',
        strokeStyle: '',
        fillRect: () => {},
        strokeRect: () => {},
        measureText: (t: string) => ({ width: t.length * CHAR_W }),
        fillText(t: string, x: number, y: number) {
            drawn.push({ text: t, x, y, color: String(this.fillStyle) });
        }
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn };
}

/** Body text only — the title bar and the collapse toggle paint outside the content flow. */
const body = (drawn: Drawn[]): Drawn[] => drawn.filter(d => d.y > PANEL.y + 20);

const right = (d: Drawn): number => d.x + d.text.length * CHAR_W;

const LONG = 'Regicide requires 56 agility, 75 quest points and a completed Underground Pass';

describe('PaintFrame text fits the panel', () => {
    beforeEach(() => paintState.reset());

    test('a line longer than the panel is clipped with an ellipsis', () => {
        const { ctx, drawn } = recorder();
        const p = Paint.begin(ctx, { dock: 'chatbox' });
        p.title('T');
        p.text(LONG);
        p.end();

        const line = body(drawn)[0]!;
        expect(line.text.endsWith('…')).toBe(true);
        expect(right(line)).toBeLessThanOrEqual(PANEL.x + PANEL.w);
    });

    test('a short line is drawn untouched', () => {
        const { ctx, drawn } = recorder();
        const p = Paint.begin(ctx, { dock: 'chatbox' });
        p.title('T');
        p.text('idle');
        p.end();

        expect(body(drawn)[0]!.text).toBe('idle');
    });

    test('each column of a row is clipped into its own slot, not the whole panel', () => {
        const { ctx, drawn } = recorder();
        const p = Paint.begin(ctx, { dock: 'chatbox' });
        p.title('T');
        p.row(LONG, LONG);
        p.end();

        const [left, second] = body(drawn);
        expect(right(left!)).toBeLessThanOrEqual(second!.x);
        expect(right(second!)).toBeLessThanOrEqual(PANEL.x + PANEL.w);
    });

    test('wrap spills a long reason onto indented continuation lines that all fit', () => {
        const { ctx, drawn } = recorder();
        const p = Paint.begin(ctx, { dock: 'chatbox' });
        p.title('T');
        p.wrap(LONG);
        p.end();

        const lines = body(drawn);
        expect(lines.length).toBeGreaterThan(1);
        expect(lines.every(l => right(l) <= PANEL.x + PANEL.w)).toBe(true);
        expect(lines.map(l => l.text.trim()).join(' ')).toBe(LONG);
        expect(lines[1]!.text.startsWith('  ')).toBe(true);
    });
});

describe('PaintFrame.cells', () => {
    beforeEach(() => paintState.reset());

    test('a weighted cell takes proportionally more room and keeps its own colour', () => {
        const { ctx, drawn } = recorder();
        const p = Paint.begin(ctx, { dock: 'chatbox' });
        p.title('T');
        p.cells([
            { text: 'name', weight: 3, color: '#ff0000' },
            { text: 'reason', weight: 1, color: '#00ff00' }
        ]);
        p.end();

        const [name, reason] = body(drawn);
        expect(name!.color).toBe('#ff0000');
        expect(reason!.color).toBe('#00ff00');
        const inner = PANEL.w - 16;
        expect(reason!.x - name!.x).toBeCloseTo(inner * 0.75, 0);
    });
});

describe('PaintFrame.list', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `row${i}`);

    beforeEach(() => paintState.reset());

    test('shows only its window and reports how much is off screen', () => {
        const { ctx, drawn } = recorder();
        const p = Paint.begin(ctx, { dock: 'chatbox' });
        p.title('T');
        p.list('q', lines, 4);
        p.end();

        const texts = body(drawn).map(d => d.text);
        expect(texts.slice(0, 4)).toEqual(['row0', 'row1', 'row2', 'row3']);
        expect(texts[4]).toBe('1–4 of 20');
    });

    test('a wheel notch over the list scrolls it', () => {
        const first = recorder();
        const p1 = Paint.begin(first.ctx, { dock: 'chatbox' });
        p1.title('T');
        p1.list('q', lines, 4);
        p1.end();

        expect(paintState.wheel(PANEL.x + 20, PANEL.y + 60, 1)).toBe(true);

        const second = recorder();
        const p2 = Paint.begin(second.ctx, { dock: 'chatbox' });
        p2.title('T');
        expect(p2.list('q', lines, 4)).toBe(3);
        p2.end();

        expect(body(second.drawn).map(d => d.text).slice(0, 4)).toEqual(['row3', 'row4', 'row5', 'row6']);
    });

    test('per-line colour survives, and long lines are clipped', () => {
        const { ctx, drawn } = recorder();
        const p = Paint.begin(ctx, { dock: 'chatbox' });
        p.title('T');
        p.list('q', [{ text: LONG, color: '#abcdef' }], 4);
        p.end();

        const line = body(drawn)[0]!;
        expect(line.color).toBe('#abcdef');
        expect(right(line)).toBeLessThanOrEqual(PANEL.x + PANEL.w);
    });

    test('scrolls to keep the focus row on screen', () => {
        const { ctx, drawn } = recorder();
        const p = Paint.begin(ctx, { dock: 'chatbox' });
        p.title('T');
        p.list('q', lines, 4, { focus: 12 });
        p.end();

        expect(body(drawn).map(d => d.text).slice(0, 4)).toEqual(['row9', 'row10', 'row11', 'row12']);
    });
});

describe('PaintFrame.grid', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `row${i}`);

    beforeEach(() => paintState.reset());

    test('lays entries across the panel width, reading left to right', () => {
        const { ctx, drawn } = recorder();
        const p = Paint.begin(ctx, { dock: 'chatbox' });
        p.title('T');
        p.grid('q', lines, 2, { reserve: 26 });
        p.end();

        const cells = body(drawn).filter(d => d.text.startsWith('row'));
        expect(cells.slice(0, 2).map(d => d.text)).toEqual(['row0', 'row1']);
        expect(cells[1]!.x).toBeGreaterThan(cells[0]!.x);
        expect(cells[2]!.x).toBe(cells[0]!.x);
        expect(cells.every(d => right(d) <= PANEL.x + PANEL.w)).toBe(true);
    });

    test('shows twice the entries a single column fits in the same height', () => {
        const single = recorder();
        const p1 = Paint.begin(single.ctx, { dock: 'chatbox' });
        p1.title('T');
        p1.fill('a', lines, { reserve: 26 });
        p1.end();

        const grid = recorder();
        const p2 = Paint.begin(grid.ctx, { dock: 'chatbox' });
        p2.title('T');
        p2.grid('b', lines, 2, { reserve: 26 });
        p2.end();

        const count = (d: Drawn[]) => d.filter(x => x.text.startsWith('row')).length;
        expect(count(body(grid.drawn))).toBe(count(body(single.drawn)) * 2);
    });

    test('one wheel notch moves whole rows, so the reading order holds', () => {
        const first = recorder();
        const p1 = Paint.begin(first.ctx, { dock: 'chatbox' });
        p1.title('T');
        p1.grid('q', lines, 2, { reserve: 26 });
        p1.end();

        expect(paintState.wheel(PANEL.x + 20, PANEL.y + 60, 1)).toBe(true);

        const second = recorder();
        const p2 = Paint.begin(second.ctx, { dock: 'chatbox' });
        p2.title('T');
        p2.grid('q', lines, 2, { reserve: 26 });
        p2.end();

        expect(body(second.drawn).filter(d => d.text.startsWith('row'))[0]!.text).toBe('row6');
    });

    test('scrolls to keep the focused entry on screen wherever it sits in a row', () => {
        const { ctx, drawn } = recorder();
        const p = Paint.begin(ctx, { dock: 'chatbox' });
        p.title('T');
        p.grid('q', lines, 2, { reserve: 26, focus: 31 });
        p.end();

        expect(body(drawn).filter(d => d.text.startsWith('row')).map(d => d.text)).toContain('row31');
    });
});

describe('list footer', () => {
    beforeEach(() => paintState.reset());

    test('a summary rides along with the scroll counter instead of costing a row', () => {
        const { ctx, drawn } = recorder();
        const p = Paint.begin(ctx, { dock: 'chatbox' });
        p.title('T');
        p.list('q', ['a', 'b', 'c'], 2, { footer: 'QP 44 · done 12' });
        p.end();

        const counter = body(drawn).find(d => d.text.includes('of 3'))!;
        expect(counter.text).toBe('1–2 of 3 · QP 44 · done 12');
    });

    test('a list that fits shows the summary on its own', () => {
        const { ctx, drawn } = recorder();
        const p = Paint.begin(ctx, { dock: 'chatbox' });
        p.title('T');
        p.list('q', ['a', 'b'], 4, { footer: 'QP 44 · done 12' });
        p.end();

        expect(body(drawn).map(d => d.text)).toEqual(['a', 'b', 'QP 44 · done 12']);
    });
});

describe('PaintFrame.fill', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `row${i}`);

    beforeEach(() => paintState.reset());

    test('uses the panel height that is left, and leaves the reserved footer clear', () => {
        const { ctx, drawn } = recorder();
        const p = Paint.begin(ctx, { dock: 'chatbox' });
        p.title('T');
        p.row('header');
        p.fill('q', lines, { reserve: 20 });
        p.end();

        const rows = body(drawn).filter(d => d.text.startsWith('row'));
        expect(rows.length).toBeGreaterThan(2);
        const last = rows[rows.length - 1]!;
        expect(last.y).toBeLessThanOrEqual(PANEL.y + PANEL.h - 20);
    });

    test('a collapsed panel paints no rows at all', () => {
        paintState.set('paint:collapsed', '1');
        const { ctx, drawn } = recorder();
        const p = Paint.begin(ctx, { dock: 'chatbox' });
        p.title('T');
        p.fill('q', lines, { reserve: 20 });
        p.end();

        expect(body(drawn)).toEqual([]);
    });
});
