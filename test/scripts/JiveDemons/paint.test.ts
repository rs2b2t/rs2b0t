import { beforeEach, describe, expect, test } from 'bun:test';
import { JIVE_BYLINE } from '#/bot/paint/jive.js';
import { paintState, resolveDock } from '#/bot/paint/paintLogic.js';
import JiveDemons from '#/bot/scripts/JiveDemons/JiveDemons.js';

const CHAR_W = 7;
const LINE = 16;
const PANEL = resolveDock('chatbox');
/** Baseline of the first body row, the one under the title strip. */
const ROW_1 = PANEL.y + 20 + LINE / 2 + 1;
const PARK_REASON = "no 'Lobster' left in the bank after a full trip. The run stopped at the booth rather than walk back to the demons with no way to heal. Deposit food, or point the loadout at food the bank has, and restart.";
const SECTIONS = ['Overview', 'Combat', 'Loot'];

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

/** Which body rows the panel painted on, numbered from 1 under the title strip. */
function bodyRows(drawn: Drawn[]): number[] {
    return drawn
        .filter(d => d.text !== JIVE_BYLINE && d.y >= ROW_1 && (d.y - ROW_1) % LINE === 0)
        .map(d => (d.y - ROW_1) / LINE + 1);
}

function paintSection(section: string, page = 'Statistics'): { drawn: Drawn[]; boxes: Box[] } {
    paintState.reset();
    paintState.set('strip:jive:JiveDemons', page);
    paintState.set('rail:jive:JiveDemons', section);
    const { ctx, drawn, boxes } = recorder();
    const bot = new JiveDemons();
    bot.parked = true;
    bot.parkReason = PARK_REASON;
    for (const [name, n] of [['Coins', 9], ['Herb', 8], ['Blood rune', 4], ['Rune chainbody', 1]] as const) {
        bot.lootCounts.set(name, n);
    }
    bot.onPaint!(ctx);
    return { drawn, boxes };
}

describe('JiveDemons paint', () => {
    beforeEach(() => paintState.reset());

    test('the Overview section names the brand, the byline and the run counters', () => {
        const { ctx, drawn } = recorder();
        new JiveDemons().onPaint!(ctx);
        const texts = drawn.map(d => d.text).join('|');
        expect(texts).toContain('JiveDemons');
        expect(texts).toContain(JIVE_BYLINE);
        expect(texts).toContain('Kills:');
        expect(texts).toContain('Runtime:');
    });

    test('painting twice in a row does not throw', () => {
        const { ctx } = recorder();
        const bot = new JiveDemons();
        bot.onPaint!(ctx);
        bot.onPaint!(ctx);
    });

    test('every rail label fits the eight-character rail, and there is no clue rail', () => {
        const texts = paintSection('Overview').drawn.map(d => d.text);
        for (const name of SECTIONS) {
            expect(name.length).toBeLessThanOrEqual(8);
            expect(texts).toContain(name);
        }
        expect(texts).not.toContain('Clue');
    });

    test('no section, parked and full, paints past the sixth body row', () => {
        const worst: Record<string, number> = {};
        for (const section of SECTIONS) {
            worst[section] = Math.max(...bodyRows(paintSection(section).drawn));
        }
        worst.Options = Math.max(...bodyRows(paintSection('Overview', 'Options').drawn));
        expect(Object.entries(worst).filter(([, row]) => row < 1 || row > 6)).toEqual([]);
    });

    test('no section draws a widget outside the panel', () => {
        for (const section of SECTIONS) {
            expect(spills(paintSection(section).boxes)).toEqual([]);
        }
        expect(spills(paintSection('Overview', 'Options').boxes)).toEqual([]);
    });
});
