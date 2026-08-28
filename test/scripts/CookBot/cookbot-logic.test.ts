import { describe, expect, test } from 'bun:test';
import { FIRE_SPOTS, localFirePlot } from '#/bot/api/firemaking/Firemaking.js';
import {
    canCook,
    cookKeepNames,
    LOGS_PER_TRIP,
    countRaw,
    firePlotFor,
    lastRawIndex,
    logsToWithdraw,
    needsBank,
    needsLight,
    parseSurfaceMode,
    type CookState
} from '#/bot/scripts/CookBot/CookBotLogic.js';

const pack = [
    { name: 'Raw salmon' }, { name: 'Salmon' }, { name: 'Raw salmon' },
    { name: 'Burnt fish' }, { name: 'Raw salmon' }, { name: 'Coins' }
];

describe('countRaw', () => {
    test('counts case-insensitive substring matches only', () => {
        expect(countRaw(pack, 'Raw salmon')).toBe(3);
        expect(countRaw(pack, 'raw salmon')).toBe(3);
        expect(countRaw(pack, 'Raw shark')).toBe(0);
    });
    test('ignores null names', () => {
        expect(countRaw([{ name: null }, { name: 'Raw salmon' }], 'raw salmon')).toBe(1);
    });
});

describe('lastRawIndex', () => {
    test('returns the index of the LAST match, not the first', () => {
        expect(lastRawIndex(pack, 'Raw salmon')).toBe(4);
    });
    test('-1 when none match', () => {
        expect(lastRawIndex(pack, 'Raw shark')).toBe(-1);
    });
});

describe('parseSurfaceMode', () => {
    test('reads the dropdown labels', () => {
        expect(parseSurfaceMode('Fire')).toBe('fire');
        expect(parseSurfaceMode('  fire ')).toBe('fire');
        expect(parseSurfaceMode('Range')).toBe('range');
    });
    test('anything unrecognised stays on the range', () => {
        expect(parseSurfaceMode('')).toBe('range');
        expect(parseSurfaceMode('bonfire')).toBe('range');
    });
});

describe('bank leg planning', () => {
    test('range mode banks the whole pack', () => {
        expect(cookKeepNames('range', 'Tinderbox', 'Logs')).toEqual([]);
        expect(logsToWithdraw('range', 0)).toBe(0);
    });
    test('fire mode keeps the tinderbox and the logs', () => {
        expect(cookKeepNames('fire', 'Tinderbox', 'Oak logs')).toEqual(['Tinderbox', 'Oak logs']);
    });
    test('carries one log, and does not stack them up trip after trip', () => {
        expect(LOGS_PER_TRIP).toBe(1);
        expect(logsToWithdraw('fire', 0)).toBe(1);
        expect(logsToWithdraw('fire', 1)).toBe(0);
        expect(logsToWithdraw('fire', 4)).toBe(0);
    });
});

describe('trip decisions', () => {
    const state = (over: Partial<CookState>): CookState =>
        ({ mode: 'fire', rawLeft: 10, logsLeft: 2, fireLit: true, ...over });

    test('an empty raw pack always sends the bot to the bank', () => {
        expect(needsBank(state({ rawLeft: 0 }))).toBe(true);
        expect(needsBank(state({ mode: 'range', rawLeft: 0 }))).toBe(true);
    });
    test('the one log is spent once lit, so the burning fire is what holds off the bank', () => {
        expect(needsBank(state({ logsLeft: 0, fireLit: true }))).toBe(false);
    });

    test('a fire that goes out mid-load sends the bot to the bank, not to a relight', () => {
        const out = state({ logsLeft: 0, fireLit: false, rawLeft: 12 });
        expect(needsBank(out)).toBe(true);
        expect(needsLight(out)).toBe(false);
        expect(canCook(out)).toBe(false);
    });
    test('range mode never wants logs', () => {
        expect(needsBank(state({ mode: 'range', logsLeft: 0, fireLit: false }))).toBe(false);
        expect(needsLight(state({ mode: 'range', fireLit: false }))).toBe(false);
    });
    test('lights only when there is fish to cook, a log to burn and no fire yet', () => {
        expect(needsLight(state({ fireLit: false }))).toBe(true);
        expect(needsLight(state({ fireLit: true }))).toBe(false);
        expect(needsLight(state({ fireLit: false, rawLeft: 0 }))).toBe(false);
        expect(needsLight(state({ fireLit: false, logsLeft: 0 }))).toBe(false);
    });
    test('a fire that burnt out stops the cook loop rather than the script', () => {
        expect(canCook(state({ fireLit: false }))).toBe(false);
        expect(canCook(state({ fireLit: true }))).toBe(true);
        expect(canCook(state({ mode: 'range', fireLit: false }))).toBe(true);
        expect(canCook(state({ mode: 'range', rawLeft: 0 }))).toBe(false);
    });
});

describe('firePlotFor', () => {
    const bank = { x: 3253, z: 3420, level: 0 };

    test('takes the hand-walked strip when the location has one', () => {
        const plot = firePlotFor('Varrock East', bank, 8);
        expect(plot).toEqual(FIRE_SPOTS['Varrock East']);
        // The strip is the street north of the bank, which a box around the stand barely reaches.
        expect(plot.z0).toBe(3428);
    });

    test('boxes the bank stand when it does not', () => {
        const plot = firePlotFor('Al Kharid', { x: 3269, z: 3167, level: 0 }, 8);
        expect(plot).toEqual(localFirePlot({ x: 3269, z: 3167, level: 0 }, 8));
        expect(plot.x0).toBe(3261);
        expect(plot.x1).toBe(3277);
    });

    test('Custom falls back to the box too', () => {
        expect(firePlotFor('Custom', bank, 4)).toEqual(localFirePlot(bank, 4));
    });
});
