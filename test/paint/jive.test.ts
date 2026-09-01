import { beforeEach, describe, expect, test } from 'bun:test';
import { Paint } from '#/bot/paint/Paint.js';
import { paintState, resolveDock } from '#/bot/paint/paintLogic.js';

const PANEL = resolveDock('chatbox');
const CHAR_W = 7;

interface Drawn {
    text: string;
    x: number;
    y: number;
}

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
            drawn.push({ text: t, x, y });
        }
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn };
}

describe('strip', () => {
    beforeEach(() => paintState.reset());

    test('draws every tab, the status and the brand, brand furthest right', () => {
        const { ctx, drawn } = recorder();
        const p = Paint.begin(ctx, { dock: 'chatbox' });
        p.strip('jd', ['Statistics', 'Options'], 'holding the safespot', 'JiveDragons');
        p.end();
        const texts = drawn.map(d => d.text);
        expect(texts).toContain('Statistics');
        expect(texts).toContain('Options');
        expect(texts).toContain('JiveDragons');
        const brand = drawn.find(d => d.text === 'JiveDragons')!;
        const status = drawn.find(d => d.text.startsWith('holding'))!;
        expect(brand.x).toBeGreaterThan(status.x);
    });

    test('returns the first tab by default and the clicked tab after a click', () => {
        const { ctx } = recorder();
        const first = Paint.begin(ctx, { dock: 'chatbox' });
        expect(first.strip('jd', ['Statistics', 'Options'], '', 'JiveDragons')).toBe('Statistics');
        first.end();

        paintState.pointerDown(PANEL.x + 8 + 'Statistics'.length * CHAR_W + 20, PANEL.y + 8);
        const second = Paint.begin(ctx, { dock: 'chatbox' });
        expect(second.strip('jd', ['Statistics', 'Options'], '', 'JiveDragons')).toBe('Options');
        second.end();
    });

    test('draws the collapse glyph and keeps the brand clear of it', () => {
        const { ctx, drawn } = recorder();
        const p = Paint.begin(ctx, { dock: 'chatbox' });
        p.strip('jd', ['Statistics', 'Options'], '', 'JiveDragons');
        p.end();
        expect(drawn.map(d => d.text)).toContain('-');
        const brand = drawn.find(d => d.text === 'JiveDragons')!;
        expect(brand.x + brand.text.length * CHAR_W).toBeLessThanOrEqual(PANEL.x + PANEL.w - 20);
    });
});

describe('rail', () => {
    beforeEach(() => paintState.reset());

    test('draws every entry and returns the first by default', () => {
        const { ctx, drawn } = recorder();
        const p = Paint.begin(ctx, { dock: 'chatbox' });
        p.strip('jd', ['Statistics'], '', 'JiveDragons');
        expect(p.rail('jdr', ['Overview', 'Combat', 'Loot'])).toBe('Overview');
        p.end();
        const texts = drawn.map(d => d.text);
        expect(texts).toContain('Overview');
        expect(texts).toContain('Combat');
        expect(texts).toContain('Loot');
    });

    test('an unknown stored value falls back to the first entry', () => {
        paintState.set('rail:jdr', 'Gone');
        const { ctx } = recorder();
        const p = Paint.begin(ctx, { dock: 'chatbox' });
        p.strip('jd', ['Statistics'], '', 'JiveDragons');
        expect(p.rail('jdr', ['Overview', 'Combat'])).toBe('Overview');
        p.end();
    });
});

describe('statGrid', () => {
    beforeEach(() => paintState.reset());

    test('lays cells two across, right of the rail', () => {
        const { ctx, drawn } = recorder();
        const p = Paint.begin(ctx, { dock: 'chatbox' });
        p.strip('jd', ['Statistics'], '', 'JiveDragons');
        p.rail('jdr', ['Overview']);
        p.statGrid([
            [{ text: 'Kills: 4' }, { text: 'Trips: 1' }],
            [{ text: 'Food: 12' }, { text: 'Casts: 90' }]
        ]);
        p.end();
        const kills = drawn.find(d => d.text === 'Kills: 4')!;
        const trips = drawn.find(d => d.text === 'Trips: 1')!;
        const food = drawn.find(d => d.text === 'Food: 12')!;
        expect(trips.x).toBeGreaterThan(kills.x);
        expect(food.y).toBeGreaterThan(kills.y);
        expect(kills.x).toBeGreaterThan(PANEL.x + 60);
    });
});

describe('footer', () => {
    beforeEach(() => paintState.reset());

    test('right-aligns inside the panel', () => {
        const { ctx, drawn } = recorder();
        const p = Paint.begin(ctx, { dock: 'chatbox' });
        p.strip('jd', ['Statistics'], '', 'JiveDragons');
        p.footer('by jive');
        p.end();
        const line = drawn.find(d => d.text === 'by jive')!;
        expect(line.x + 'by jive'.length * CHAR_W).toBeLessThanOrEqual(PANEL.x + PANEL.w);
        expect(line.x).toBeGreaterThan(PANEL.x + PANEL.w / 2);
    });
});
