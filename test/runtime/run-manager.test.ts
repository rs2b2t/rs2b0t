import { expect, test, describe } from 'bun:test';

import { resolveRunPolicy, shouldEnableRun, type RunState } from '#/bot/runtime/RunManager.js';

const state = (o: Partial<RunState>): RunState =>
    ({ runOn: false, inCombat: false, energy: 100, energyMin: 20, modalOpen: false, ...o });

describe('shouldEnableRun', () => {
    test('never re-toggles run that is already on', () => {
        expect(shouldEnableRun(state({ runOn: true }))).toBe(false);
        expect(shouldEnableRun(state({ runOn: true, inCombat: true }))).toBe(false);
    });

    test('out of combat it waits for the regen floor', () => {
        expect(shouldEnableRun(state({ energy: 19 }))).toBe(false);
        expect(shouldEnableRun(state({ energy: 20 }))).toBe(true);
    });

    test('under attack it runs on whatever energy is left', () => {
        expect(shouldEnableRun(state({ inCombat: true, energy: 1 }))).toBe(true);
        expect(shouldEnableRun(state({ inCombat: true, energy: 19 }))).toBe(true);
    });

    test('under attack with no energy there is nothing to toggle', () => {
        expect(shouldEnableRun(state({ inCombat: true, energy: 0 }))).toBe(false);
    });

    // Why: the toggle clicks a controls-tab component and the server closes the open modal to service it, shutting the bank mid-trip.
    test('holds off while a modal is open rather than closing it', () => {
        expect(shouldEnableRun(state({ modalOpen: true }))).toBe(false);
        expect(shouldEnableRun(state({ modalOpen: true, energy: 100 }))).toBe(false);
    });

    test('once the modal closes it toggles as usual', () => {
        expect(shouldEnableRun(state({ modalOpen: false }))).toBe(true);
    });

    test('being attacked still overrides an open modal — getting away beats the interface', () => {
        expect(shouldEnableRun(state({ modalOpen: true, inCombat: true, energy: 1 }))).toBe(true);
    });
});

const GLOBAL = { runAuto: true, energyMin: 20 };

describe('resolveRunPolicy', () => {
    test('null overlay keeps the Global pair', () => {
        expect(resolveRunPolicy(null, GLOBAL)).toEqual(GLOBAL);
        expect(resolveRunPolicy(undefined, GLOBAL)).toEqual(GLOBAL);
    });

    test('a set field wins and an unset field falls through', () => {
        expect(resolveRunPolicy({ energyMin: 40 }, GLOBAL)).toEqual({ runAuto: true, energyMin: 40 });
        expect(resolveRunPolicy({ runAuto: false }, GLOBAL)).toEqual({ runAuto: false, energyMin: 20 });
    });

    test('a later overlay replaces the whole snapshot, it does not merge', () => {
        const first = resolveRunPolicy({ energyMin: 40 }, GLOBAL);
        expect(first).toEqual({ runAuto: true, energyMin: 40 });
        expect(resolveRunPolicy({ runAuto: false }, GLOBAL)).toEqual({ runAuto: false, energyMin: 20 });
    });

    test('energyMin clamps to 0-100', () => {
        expect(resolveRunPolicy({ energyMin: 250 }, GLOBAL).energyMin).toBe(100);
        expect(resolveRunPolicy({ energyMin: -5 }, GLOBAL).energyMin).toBe(0);
    });
});
