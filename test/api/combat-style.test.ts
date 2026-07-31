import { describe, expect, test } from 'bun:test';

import {
    COMBAT_STYLE_OPTIONS,
    CombatStyleController,
    describeCombatStyle,
    parseCombatStyle,
    parseInterfaceCombatStyle,
    resolveCombatStyle
} from '#/bot/api/CombatStyle.js';
import type { CombatModeLabel } from '#/bot/api/CombatStyle.js';

const ORDINARY_SWORD: CombatModeLabel[] = [
    { mode: 0, label: '(Accurate)' },
    { mode: 1, label: '(Aggressive)' },
    { mode: 2, label: '(Controlled)' },
    { mode: 3, label: '(Defensive)' }
];
const THREE_MODE: CombatModeLabel[] = [
    { mode: 0, label: '(Accurate)' },
    { mode: 1, label: '(Aggressive)' },
    { mode: 2, label: '(Defensive)' }
];
const AXE: CombatModeLabel[] = [
    { mode: 0, label: '(Accurate)' },
    { mode: 1, label: '(Aggressive)' },
    { mode: 2, label: '(Aggressive)' },
    { mode: 3, label: '(Defensive)' }
];
const HEAVY_SWORD: CombatModeLabel[] = AXE.map(option => ({ ...option }));
const POLEARM: CombatModeLabel[] = [
    { mode: 0, label: '(Controlled)' },
    { mode: 1, label: '(Aggressive)' },
    { mode: 2, label: '(Defensive)' }
];
const SPEAR: CombatModeLabel[] = [
    { mode: 0, label: '(Controlled)' },
    { mode: 1, label: '(Controlled)' },
    { mode: 2, label: '(Controlled)' },
    { mode: 3, label: '(Defensive)' }
];

test('parseCombatStyle normalizes semantic styles and aliases', () => {
    expect(parseCombatStyle('attack')).toBe('attack');
    expect(parseCombatStyle('accurate')).toBe('attack');
    expect(parseCombatStyle('strength')).toBe('strength');
    expect(parseCombatStyle('aggressive')).toBe('strength');
    expect(parseCombatStyle('controlled')).toBe('controlled');
    expect(parseCombatStyle('shared')).toBe('controlled');
    expect(parseCombatStyle('defence')).toBe('defence');
    expect(parseCombatStyle('defense')).toBe('defence');
    expect(parseCombatStyle('defensive')).toBe('defence');
});

test('parseCombatStyle is case/space-insensitive and defaults to strength', () => {
    expect(parseCombatStyle('  Defence ')).toBe('defence');
    expect(parseCombatStyle('CONTROLLED')).toBe('controlled');
    expect(parseCombatStyle('nonsense')).toBe('strength');
    expect(parseCombatStyle('')).toBe('strength');
});

test('the melee dropdown offers all four semantic training styles', () => {
    expect(COMBAT_STYLE_OPTIONS).toEqual(['attack', 'strength', 'controlled', 'defence']);
});

describe('resolveCombatStyle', () => {
    test('ordinary sword maps all four labels to their semantic training styles', () => {
        expect(resolveCombatStyle('attack', ORDINARY_SWORD)).toEqual({ requested: 'attack', effective: 'attack', mode: 0 });
        expect(resolveCombatStyle('strength', ORDINARY_SWORD)).toEqual({ requested: 'strength', effective: 'strength', mode: 1 });
        expect(resolveCombatStyle('controlled', ORDINARY_SWORD)).toEqual({ requested: 'controlled', effective: 'controlled', mode: 2 });
        expect(resolveCombatStyle('defence', ORDINARY_SWORD)).toEqual({ requested: 'defence', effective: 'defence', mode: 3 });
    });

    test('ordinary three-mode layout sends unavailable controlled to its last defensive option', () => {
        expect(resolveCombatStyle('attack', THREE_MODE)?.mode).toBe(0);
        expect(resolveCombatStyle('strength', THREE_MODE)?.mode).toBe(1);
        expect(resolveCombatStyle('controlled', THREE_MODE)).toEqual({ requested: 'controlled', effective: 'defence', mode: 2 });
        expect(resolveCombatStyle('defence', THREE_MODE)?.mode).toBe(2);
    });

    test('axe and heavy-sword layouts never mistake their second aggressive mode for controlled', () => {
        for (const offered of [AXE, HEAVY_SWORD]) {
            expect(resolveCombatStyle('attack', offered)?.mode).toBe(0);
            expect(resolveCombatStyle('strength', offered)?.mode).toBe(1);
            expect(resolveCombatStyle('controlled', offered)).toEqual({ requested: 'controlled', effective: 'defence', mode: 3 });
            expect(resolveCombatStyle('defence', offered)?.mode).toBe(3);
        }
    });

    test('polearm layout respects controlled-first and falls unavailable attack back to defensive', () => {
        expect(resolveCombatStyle('attack', POLEARM)).toEqual({ requested: 'attack', effective: 'defence', mode: 2 });
        expect(resolveCombatStyle('strength', POLEARM)?.mode).toBe(1);
        expect(resolveCombatStyle('controlled', POLEARM)?.mode).toBe(0);
        expect(resolveCombatStyle('defence', POLEARM)?.mode).toBe(2);
    });

    test('spear layout selects its first controlled mode and falls attack and strength back to defensive', () => {
        expect(resolveCombatStyle('attack', SPEAR)).toEqual({ requested: 'attack', effective: 'defence', mode: 3 });
        expect(resolveCombatStyle('strength', SPEAR)).toEqual({ requested: 'strength', effective: 'defence', mode: 3 });
        expect(resolveCombatStyle('controlled', SPEAR)?.mode).toBe(0);
        expect(resolveCombatStyle('defence', SPEAR)?.mode).toBe(3);
    });

    test('fails closed rather than inferring semantics from unknown labels or positions', () => {
        expect(resolveCombatStyle('attack', [])).toBeNull();
        expect(resolveCombatStyle('strength', [{ mode: 0, label: 'Chop' }])).toBeNull();
        expect(resolveCombatStyle('defence', [{ mode: Number.NaN, label: '(Defensive)' }])).toBeNull();
        expect(resolveCombatStyle('strength', [{ mode: 0, label: '(Accurate)' }])).toBeNull();
    });
});

test('interface labels are the source of semantic combat styles', () => {
    expect(parseInterfaceCombatStyle('(Accurate)')).toBe('attack');
    expect(parseInterfaceCombatStyle(' (AGGRESSIVE) ')).toBe('strength');
    expect(parseInterfaceCombatStyle('(Controlled)')).toBe('controlled');
    expect(parseInterfaceCombatStyle('(Defensive)')).toBe('defence');
    expect(parseInterfaceCombatStyle('Block')).toBeNull();
});

test('combat-style descriptions disclose any unavailable-style fallback', () => {
    const controlled = resolveCombatStyle('controlled', ORDINARY_SWORD);
    const fallback = resolveCombatStyle('controlled', THREE_MODE);
    const spearFallback = resolveCombatStyle('strength', SPEAR);
    expect(controlled && describeCombatStyle(controlled)).toBe('controlled (training Attack, Strength & Defence)');
    expect(fallback && describeCombatStyle(fallback)).toBe('defence (training Defence; controlled unavailable)');
    expect(spearFallback && describeCombatStyle(spearFallback)).toBe('defence (training Defence; strength unavailable)');
});

describe('CombatStyleController', () => {
    function harness(initialModes: CombatModeLabel[] | null, initialCurrent: number) {
        let modes = initialModes;
        let current = initialCurrent;
        const selected: number[] = [];
        const controller = new CombatStyleController({
            offeredModes: () => modes,
            currentMode: () => current,
            selectMode: mode => {
                if (!modes?.some(option => option.mode === mode)) {
                    return false;
                }
                selected.push(mode);
                current = mode;
                return true;
            }
        });
        return {
            controller,
            selected,
            current: () => current,
            setModes: (value: CombatModeLabel[] | null) => {
                modes = value;
            }
        };
    }

    test('four-mode resolve, set, and already-selected checks share one target', () => {
        const state = harness(ORDINARY_SWORD, 1);
        expect(state.controller.resolution('controlled')).toEqual({ requested: 'controlled', effective: 'controlled', mode: 2 });
        expect(state.controller.has('controlled')).toBe(false);
        expect(state.controller.set('controlled')).toBe(true);
        expect(state.selected).toEqual([2]);
        expect(state.current()).toBe(2);
        expect(state.controller.has('controlled')).toBe(true);
    });

    test('three-mode controlled sets and asserts the same defensive fallback', () => {
        const state = harness(THREE_MODE, 0);
        expect(state.controller.resolution('controlled')).toEqual({ requested: 'controlled', effective: 'defence', mode: 2 });
        expect(state.controller.set('controlled')).toBe(true);
        expect(state.current()).toBe(2);
        expect(state.controller.has('controlled')).toBe(true);
        expect(state.controller.has('defence')).toBe(true);
    });

    test('an unavailable or empty combat interface fails closed', () => {
        const state = harness(null, 0);
        expect(state.controller.resolution('attack')).toBeNull();
        expect(state.controller.mode('attack')).toBeNull();
        expect(state.controller.has('attack')).toBe(false);
        expect(state.controller.set('attack')).toBe(false);
        expect(state.selected).toEqual([]);

        state.setModes([]);
        expect(state.controller.resolution('strength')).toBeNull();
        expect(state.controller.has('strength')).toBe(false);
        expect(state.controller.set('strength')).toBe(false);
        expect(state.selected).toEqual([]);
    });
});
