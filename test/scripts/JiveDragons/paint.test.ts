import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { ClueExecutor } from '#/bot/api/ai/clues/ClueExecutor.js';
import { JIVE_BYLINE } from '#/bot/paint/jive.js';
import { paintState, resolveDock } from '#/bot/paint/paintLogic.js';
import JiveDragons from '#/bot/scripts/JiveDragons/JiveDragons.js';
import { installMidClue } from './paint.fixture.js';
import { restoreScenario, resetScenario, scenario } from './scheduler.fixture.js';
import { SettingsStore } from '#/bot/runtime/Settings.js';
import { type Box, type Drawn, recorder, spills } from '../../fixtures/script-paint.js';

const LINE = 16;
const PANEL = resolveDock('chatbox');
/** Baseline of the first body row, the one under the title strip. */
const ROW_1 = PANEL.y + 20 + LINE / 2 + 1;
const PARK_REASON = "no 'Lobster' left in the bank after a full trip. The run stopped at the booth rather than walk back to the dragons with no way to heal. Deposit food, or point the loadout at food the bank has, and restart.";

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

// Why: the default lifecycle restores module-level paint settings before each test.
beforeEach(async () => {
    await resetScenario();
});

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
        installMidClue();
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


test('live stand and spawn controls fit the Options panel while parked', async () => {
    const { bot } = await scenario('gutanoth-blue', 'melee');
    try {
        paintState.reset();
        paintState.set('strip:jive:JiveDragons', 'Options');
        bot.parked = true;
        bot.parkReason = PARK_REASON;
        const { ctx, drawn, boxes } = recorder();
        bot.onPaint(ctx);
        expect(drawn.map(d => d.text).join('|')).toContain('stand');
        expect(drawn.map(d => d.text).join('|')).toContain('spawns');
        expect(Math.max(...bodyRows(drawn))).toBeLessThanOrEqual(6);
        expect(spills(boxes)).toEqual([]);
    } finally {
        await restoreScenario();
    }
});


test('paint queues and saves a stand selection and toggles rotation without losing a fight', async () => {
    const { bot, engage } = await scenario('gutanoth-blue', 'melee');
    const saved = spyOn(SettingsStore, 'save').mockImplementation(() => {});
    try {
        await engage();
        paintState.reset();
        paintState.set('strip:jive:JiveDragons', 'Options');
        const { ctx, drawn } = recorder();
        bot.onPaint(ctx);
        const stand = drawn.find(d => d.text.startsWith('stand:'))!;
        expect(paintState.pointerDown(stand.x, stand.y)).toBe(true);
        bot.onPaint(ctx);
        expect(bot.pendingStand).toBe(2);
        expect(saved).toHaveBeenCalledWith('JiveDragons', 'stand', '2');
        const spawns = drawn.find(d => d.text.startsWith('spawns:'))!;
        expect(paintState.pointerDown(spawns.x, spawns.y)).toBe(true);
        bot.onPaint(ctx);
        expect(bot.rotateSpawns()).toBe(true);
        expect(saved).toHaveBeenCalledWith('JiveDragons', 'rotateSpawns', 'true');
        expect(bot.targetIdx).toBe(17);
    } finally {
        await restoreScenario();
    }
});
