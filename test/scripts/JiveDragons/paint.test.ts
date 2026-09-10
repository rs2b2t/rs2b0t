import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { ClueExecutor } from '#/bot/api/ai/clues/ClueExecutor.js';
import { JIVE_BYLINE } from '#/bot/paint/jive.js';
import { paintState, resolveDock } from '#/bot/paint/paintLogic.js';
import JiveDragons from '#/bot/scripts/JiveDragons/JiveDragons.js';

const CHAR_W = 7;
const LINE = 16;
const PANEL = resolveDock('chatbox');
/** Baseline of the first body row, the one under the title strip. */
const ROW_1 = PANEL.y + 20 + LINE / 2 + 1;
const PARK_REASON = "no 'Lobster' left in the bank after a full trip. The run stopped at the booth rather than walk back to the dragons with no way to heal. Deposit food, or point the loadout at food the bank has, and restart.";

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
    paintState.set('strip:jive:JiveDragons', page);
    paintState.set('rail:jive:JiveDragons', section);
    const { ctx, drawn, boxes } = recorder();
    const bot = new JiveDragons();
    bot.parked = true;
    bot.parkReason = PARK_REASON;
    for (const [name, n] of [['Dragon bones', 9], ['Blue dragonhide', 8], ['Nature rune', 4], ['Law rune', 2]] as const) {
        bot.lootCounts.set(name, n);
    }
    bot.onPaint!(ctx);
    return { drawn, boxes };
}

describe('JiveDragons paint', () => {
    beforeEach(() => paintState.reset());

    test('the Overview section names the brand, the byline and the run counters', () => {
        const { ctx, drawn } = recorder();
        new JiveDragons().onPaint!(ctx);
        const texts = drawn.map(d => d.text).join('|');
        expect(texts).toContain('JiveDragons');
        expect(texts).toContain(JIVE_BYLINE);
        expect(texts).toContain('Kills:');
        expect(texts).toContain('Runtime:');
    });

    test('painting twice in a row does not throw', () => {
        const { ctx } = recorder();
        const bot = new JiveDragons();
        bot.onPaint!(ctx);
        bot.onPaint!(ctx);
    });

    test('every rail label fits the eight-character rail', () => {
        const texts = paintSection('Overview').drawn.map(d => d.text);
        for (const name of ['Overview', 'Combat', 'Loot', 'Clue']) {
            expect(name.length).toBeLessThanOrEqual(8);
            expect(texts).toContain(name);
        }
    });

    test('no section, parked and full, paints past the sixth body row', () => {
        const worst: Record<string, number> = {};
        for (const section of ['Overview', 'Combat', 'Loot', 'Clue']) {
            worst[section] = Math.max(...bodyRows(paintSection(section).drawn));
        }
        worst.Options = Math.max(...bodyRows(paintSection('Overview', 'Options').drawn));
        expect(Object.entries(worst).filter(([, row]) => row < 1 || row > 6)).toEqual([]);
    });

    test('no section draws a widget outside the panel', () => {
        for (const section of ['Overview', 'Combat', 'Loot', 'Clue']) {
            expect(spills(paintSection(section).boxes)).toEqual([]);
        }
        expect(spills(paintSection('Overview', 'Options').boxes)).toEqual([]);
    });
});

describe('JiveDragons paint, mid-clue', () => {
    const worldTile = reader.worldTile;

    beforeEach(() => {
        paintState.reset();
        reader.worldTile = () => ({ x: 3200, z: 3200, level: 0 });
        ClueExecutor.current = {
            clueId: 1,
            name: 'hard clue',
            step: 'dig at the crate behind the bank',
            leg: 2,
            attempt: 2,
            startedAt: Date.now(),
            target: { x: 3180, z: 3210, level: 0 },
            startDist: 40
        };
    });
    afterEach(() => {
        reader.worldTile = worldTile;
        ClueExecutor.current = null;
    });

    test('the Clue section with a trail running and a park reason stays inside the panel', () => {
        const { drawn, boxes } = paintSection('Clue');
        expect(drawn.map(d => d.text).join('|')).toContain('hard clue');
        expect(Math.max(...bodyRows(drawn))).toBeLessThanOrEqual(6);
        expect(spills(boxes)).toEqual([]);
    });
});
