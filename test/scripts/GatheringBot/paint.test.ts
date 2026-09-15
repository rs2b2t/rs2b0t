import { beforeEach, describe, expect, test } from 'bun:test';
import { JIVE_BYLINE } from '#/bot/paint/jive.js';
import { paintState, resolveDock } from '#/bot/paint/paintLogic.js';
import GatheringBot from '#/bot/scripts/GatheringBot/GatheringBot.js';

const CHAR_W = 7;
const PANEL = resolveDock('chatbox');
const BYLINE = 'Gathering scripts';
/** The rail is eight characters wide, so a longer label is drawn clipped. */
const RAIL_CHARS = 8;

interface Drawn {
    text: string;
    x: number;
    y: number;
}

interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}

function recorder(): { ctx: CanvasRenderingContext2D; drawn: Drawn[]; boxes: Box[] } {
    const drawn: Drawn[] = [];
    const boxes: Box[] = [];
    const ctx = {
        font: '',
        textBaseline: '',
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 0,
        lineJoin: '',
        save: () => {},
        restore: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {},
        fillRect(x: number, y: number, w: number, h: number) {
            boxes.push({ x, y, w, h });
        },
        strokeRect(x: number, y: number, w: number, h: number) {
            boxes.push({ x, y, w, h });
        },
        measureText: (t: string) => ({ width: t.length * CHAR_W }),
        fillText(t: string, x: number, y: number) {
            drawn.push({ text: t, x, y });
        }
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn, boxes };
}

/** Every rect that spills past the panel, a button under the bottom border included. */
function spills(boxes: Box[]): Box[] {
    return boxes.filter(b => b.x < PANEL.x || b.y < PANEL.y || b.x + b.w > PANEL.x + PANEL.w || b.y + b.h > PANEL.y + PANEL.h);
}

function paintPage(page: string, section = ''): { drawn: Drawn[]; boxes: Box[] } {
    paintState.reset();
    paintState.set('strip:gb', page);
    if (section !== '') {
        paintState.set('rail:gb', section);
    }
    const { ctx, drawn, boxes } = recorder();
    new GatheringBot().onPaint!(ctx);
    return { drawn, boxes };
}

describe('GatheringBot paint', () => {
    beforeEach(() => paintState.reset());

    // Why: the chrome is the Jive frame, and the byline is what says these are not Jive scripts.
    test('signs itself as a gathering script rather than a Jive one', () => {
        const texts = paintPage('Statistics', 'Overview').drawn.map(d => d.text);
        expect(texts).toContain(BYLINE);
        expect(texts).not.toContain(JIVE_BYLINE);
    });

    test('the strip carries both pages and the run counters', () => {
        const texts = paintPage('Statistics', 'Overview').drawn.map(d => d.text).join('|');
        expect(texts).toContain('Statistics');
        expect(texts).toContain('Options');
        expect(texts).toContain('Runtime:');
        expect(texts).toContain('Banked:');
        expect(texts).toContain('Trips:');
    });

    test('every rail label fits the rail', () => {
        const texts = paintPage('Statistics', 'Overview').drawn.map(d => d.text);
        for (const name of ['Overview', 'Levels']) {
            expect(name.length).toBeLessThanOrEqual(RAIL_CHARS);
            expect(texts).toContain(name);
        }
        // Why: both are offered only when the run is cooking or burning, so a bare bot never rails them, but the width has to hold whenever it does.
        for (const name of ['Cook', 'Burn']) {
            expect(name.length).toBeLessThanOrEqual(RAIL_CHARS);
        }
    });

    test('the Options page carries the camp and the gear, not the counters', () => {
        const texts = paintPage('Options').drawn.map(d => d.text).join('|');
        expect(texts).toContain('Loc:');
        expect(texts).toContain('Action:');
        expect(texts).toContain('Gear:');
        expect(texts).not.toContain('Runtime:');
    });

    test('the Levels section says so when nothing has been trained yet', () => {
        const texts = paintPage('Statistics', 'Levels').drawn.map(d => d.text).join('|');
        expect(texts).toContain('no tracked skills');
    });

    test('no section paints outside the panel', () => {
        for (const [page, section] of [['Statistics', 'Overview'], ['Statistics', 'Levels'], ['Options', '']] as const) {
            expect(spills(paintPage(page, section).boxes), `${page}/${section}`).toEqual([]);
        }
    });

    test('painting twice in a row does not throw', () => {
        const { ctx } = recorder();
        const bot = new GatheringBot();
        bot.onPaint!(ctx);
        bot.onPaint!(ctx);
    });
});
