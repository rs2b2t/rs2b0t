import { afterEach, expect, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { ClueExecutor } from '#/bot/api/ai/clues/ClueExecutor.js';
import { JIVE_BYLINE } from '#/bot/paint/jive.js';
import { paintState, resolveDock } from '#/bot/paint/paintLogic.js';
import JiveDragons from '#/bot/scripts/JiveDragons/JiveDragons.js';
import { restoreSafety, safetyScenario } from './safety.fixture.js';

/** Keep module-level clue settings from leaking into later paint tests. */

const CHAR_W = 7;
const LINE = 16;
const PANEL = resolveDock('chatbox');
/** Baseline of the first body row, the one under the title strip. */
const ROW_1 = PANEL.y + 20 + LINE / 2 + 1;
const PARK_REASON = "no 'Lobster' left in the bank after a full trip. The run stopped at the booth rather than walk back to the dragons with no way to heal. Deposit food, or point the loadout at food the bank has, and restart.";

interface Drawn {
    text: string;
    y: number;
}

interface Painted {
    drawn: Drawn[];
    rows: number[];
}

function paintSection(section: string): Painted {
    paintState.reset();
    paintState.set('strip:jive:JiveDragons', 'Statistics');
    paintState.set('rail:jive:JiveDragons', section);
    const drawn: Drawn[] = [];
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
        fillRect: () => {},
        strokeRect: () => {},
        measureText: (t: string) => ({ width: t.length * CHAR_W }),
        fillText(t: string, _x: number, y: number) {
            drawn.push({ text: t, y });
        }
    };
    const bot = new JiveDragons();
    bot.parked = true;
    bot.parkReason = PARK_REASON;
    bot.onPaint!(ctx as unknown as CanvasRenderingContext2D);
    const rows = drawn
        .filter(d => d.text !== JIVE_BYLINE && d.y >= ROW_1 && (d.y - ROW_1) % LINE === 0)
        .map(d => (d.y - ROW_1) / LINE + 1);
    return { drawn, rows };
}

afterEach(async () => {
    ClueExecutor.current = null;
    await restoreSafety();
});

for (const kind of ['dragons', 'kbd', 'demons'] as const) {
    test(`a ${kind} safety scenario leaves the default Clue rail for the next paint`, async () => {
        await safetyScenario(kind);
        await restoreSafety();
        expect(paintSection('Overview').drawn.map(d => d.text)).toContain('Clue');
    });
}

test('a mid-clue Clue section renders after a dragon safety scenario', async () => {
    const worldTile = reader.worldTile;
    await safetyScenario('dragons');
    await restoreSafety();
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
    try {
        const { drawn, rows } = paintSection('Clue');
        expect(drawn.map(d => d.text).join('|')).toContain('hard clue');
        expect(Math.max(...rows)).toBeLessThanOrEqual(6);
    } finally {
        reader.worldTile = worldTile;
    }
});
