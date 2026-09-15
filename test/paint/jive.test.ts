import { beforeEach, describe, expect, test } from 'bun:test';
import { Paint } from '#/bot/paint/Paint.js';
import { JIVE_BYLINE, XpTracker, jiveFrame, paintLevels } from '#/bot/paint/jive.js';
import { xpAtLevel } from '#/bot/paint/levelProgress.js';
import { paintState, resolveDock } from '#/bot/paint/paintLogic.js';

const PANEL = resolveDock('chatbox');
const CHAR_W = 7;
const RAIL_W = 72;
const PAD = 8;

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

describe('jiveFrame', () => {
    beforeEach(() => paintState.reset());

    test('composes the strip, the rail and the byline in one call', () => {
        const { ctx, drawn } = recorder();
        const out = jiveFrame(ctx, {
            script: 'JiveDragons',
            status: 'holding the safespot',
            pages: ['Statistics', 'Options'],
            sections: ['Overview', 'Combat']
        });
        out.frame.end();
        const texts = drawn.map(d => d.text);
        expect(texts).toContain('JiveDragons');
        expect(texts).toContain('Overview');
        expect(texts).toContain(JIVE_BYLINE);
        expect(out.page).toBe('Statistics');
        expect(out.section).toBe('Overview');
    });

    test('the Options page shows no rail, so section comes back empty', () => {
        paintState.set('strip:jive:JiveDragons', 'Options');
        const { ctx, drawn } = recorder();
        const out = jiveFrame(ctx, {
            script: 'JiveDragons',
            status: '',
            pages: ['Statistics', 'Options'],
            sections: ['Overview', 'Combat']
        });
        out.frame.end();
        expect(out.page).toBe('Options');
        expect(out.section).toBe('');
        expect(drawn.map(d => d.text)).not.toContain('Overview');
    });
});

describe('rail inset', () => {
    beforeEach(() => paintState.reset());

    test('body rows start right of the rail once one is drawn', () => {
        const { ctx, drawn } = recorder();
        const p = Paint.begin(ctx, { dock: 'chatbox' });
        p.strip('jd', ['Statistics'], '', 'JiveDragons');
        p.rail('jdr', ['Overview', 'Combat']);
        p.text('holding the safespot');
        p.bar('HP', 0.5);
        p.buttons([{ id: 'stop', label: 'Stop' }]);
        p.end();
        for (const label of ['holding the safespot', 'HP', 'Stop']) {
            expect(drawn.find(d => d.text === label)!.x).toBeGreaterThanOrEqual(PANEL.x + RAIL_W);
        }
    });

    test('a clipped line stops at the panel edge, not past it', () => {
        const { ctx, drawn } = recorder();
        const p = Paint.begin(ctx, { dock: 'chatbox' });
        p.strip('jd', ['Statistics'], '', 'JiveDragons');
        p.rail('jdr', ['Overview']);
        p.text('x'.repeat(200));
        p.end();
        const line = drawn.find(d => d.text.startsWith('xxx'))!;
        expect(line.x + line.text.length * CHAR_W).toBeLessThanOrEqual(PANEL.x + PANEL.w);
    });

    test('a frame with no rail keeps the old left margin', () => {
        const { ctx, drawn } = recorder();
        const p = Paint.begin(ctx, { dock: 'chatbox' });
        p.title('GreenDragon');
        p.text('kills: 4');
        p.bar('HP', 0.5);
        p.end();
        expect(drawn.find(d => d.text === 'kills: 4')!.x).toBe(PANEL.x + PAD);
        expect(drawn.find(d => d.text === 'HP')!.x).toBe(PANEL.x + PAD);
    });
});

describe('XpTracker', () => {
    const table: Record<string, { xp: number; level: number }> = {
        attack: { xp: 1000, level: 20 },
        strength: { xp: 5000, level: 30 },
        hitpoints: { xp: 2000, level: 25 }
    };
    const read = { xp: (s: string) => table[s]!.xp, level: (s: string) => table[s]!.level };

    test('gains lists only the skills that moved since begin, biggest first', () => {
        const t = new XpTracker(['attack', 'strength', 'hitpoints'], read);
        t.begin();
        expect(t.gains()).toEqual([]);
        table.strength!.xp += 300;
        table.hitpoints!.xp += 500;
        expect(t.gains().map(g => [g.skill, g.gained])).toEqual([['hitpoints', 500], ['strength', 300]]);
        table.strength!.xp -= 300;
        table.hitpoints!.xp -= 500;
    });

    test('progress lists every tracked skill even at zero gain, with its level', () => {
        const t = new XpTracker(['attack'], read);
        t.begin();
        expect(t.progress()).toEqual([{ skill: 'attack', level: 20, xp: 1000, gained: 0 }]);
    });

    test('before begin nothing counts as gained', () => {
        const t = new XpTracker(['attack'], read);
        expect(t.gains()).toEqual([]);
    });
});

describe('paintLevels', () => {
    beforeEach(() => paintState.reset());

    const gain = (skill: string, level: number, gained: number) => ({ skill, level, xp: xpAtLevel(level) + 50, gained });

    test('draws a bar and an eta row per skill, right of the rail', () => {
        const { ctx, drawn } = recorder();
        const out = jiveFrame(ctx, { script: 'JiveDragons', status: '', pages: ['Statistics'], sections: ['Overview', 'Levels'] });
        paintLevels(out.frame, [gain('strength', 71, 4000), gain('hitpoints', 80, 1500)], 10, 2);
        out.frame.end();
        const texts = drawn.map(d => d.text);
        expect(texts).toContain('Str 71');
        expect(texts).toContain('HP 80');
        expect(texts.filter(t => t.startsWith('eta '))).toHaveLength(2);
        expect(drawn.find(d => d.text === 'Str 71')!.x).toBeGreaterThanOrEqual(PANEL.x + RAIL_W);
        expect(drawn.find(d => d.text === 'HP 80')!.y).toBeGreaterThan(drawn.find(d => d.text === 'Str 71')!.y);
    });

    test('paints only as many skills as fit above the reserved rows', () => {
        const { ctx, drawn } = recorder();
        const out = jiveFrame(ctx, { script: 'JiveDragons', status: '', pages: ['Statistics'], sections: ['Overview', 'Levels'] });
        const gains = ['attack', 'strength', 'defence', 'hitpoints', 'prayer'].map((s, i) => gain(s, 70, 5000 - i));
        paintLevels(out.frame, gains, 10, 2);
        expect(out.frame.rowsLeft()).toBeGreaterThanOrEqual(2);
        out.frame.end();
        const bars = drawn.filter(d => /^[A-Za-z]+ 70$/.test(d.text));
        expect(bars).toHaveLength(3);
        expect(bars.map(b => b.text)).toEqual(['Att 70', 'Str 70', 'Def 70']);
    });

    test('says so when nothing has gained yet', () => {
        const { ctx, drawn } = recorder();
        const out = jiveFrame(ctx, { script: 'JiveDragons', status: '', pages: ['Statistics'], sections: ['Overview', 'Levels'] });
        paintLevels(out.frame, [], 10, 2);
        out.frame.end();
        expect(drawn.map(d => d.text)).toContain('no experience yet');
    });
});

describe('bar label', () => {
    beforeEach(() => paintState.reset());

    function rectRecorder(): { ctx: CanvasRenderingContext2D; drawn: Drawn[]; rects: { x: number; w: number }[] } {
        const base = recorder();
        const rects: { x: number; w: number }[] = [];
        (base.ctx as unknown as { fillRect: (x: number, y: number, w: number, h: number) => void }).fillRect = (x, _y, w) => {
            rects.push({ x, w });
        };
        return { ctx: base.ctx, drawn: base.drawn, rects };
    }

    test('a label wider than the slot pushes the bar right instead of running under it', () => {
        const { ctx, drawn, rects } = rectRecorder();
        const p = Paint.begin(ctx, { dock: 'chatbox' });
        p.title('x');
        const before = rects.length;
        p.bar('Range 70', 0.5);
        p.end();
        const label = drawn.find(d => d.text === 'Range 70')!;
        const track = rects[before]!;
        expect(track.x).toBeGreaterThanOrEqual(label.x + 'Range 70'.length * CHAR_W);
    });

    test('a short label keeps the fixed slot, so bars stay aligned', () => {
        const { ctx, drawn, rects } = rectRecorder();
        const p = Paint.begin(ctx, { dock: 'chatbox' });
        p.title('x');
        const before = rects.length;
        p.bar('HP', 0.5);
        p.end();
        expect(rects[before]!.x).toBe(drawn.find(d => d.text === 'HP')!.x + 48);
    });
});
