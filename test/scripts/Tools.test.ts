import { describe, expect, test } from 'bun:test';

import {
    AXES,
    PICKAXES,
    TINDERBOX,
    axeReq,
    bestAxe,
    bestPickaxe,
    exactTool,
    hasAllTools,
    missingToolLabels,
    pickaxeReq,
    tinderboxReq,
    toolKeepNames,
    toolKitLabel,
    toolRestockPlan
} from '#/bot/scripts/Tools.js';

describe('Tools kit', () => {
    const bank = (names: string[]) => (name: string) => (names.includes(name) ? 1 : 0);
    const lvl = (skill: string) => (skill === 'mining' || skill === 'woodcutting' ? 41 : 1);

    test('ladders are best-first', () => {
        for (let i = 1; i < PICKAXES.length; i++) {
            expect(PICKAXES[i - 1].level).toBeGreaterThanOrEqual(PICKAXES[i].level);
        }
        for (let i = 1; i < AXES.length; i++) {
            expect(AXES[i - 1].level).toBeGreaterThanOrEqual(AXES[i].level);
        }
    });

    test('bestPickaxe / bestAxe respect level gates', () => {
        expect(bestPickaxe(41, n => n === 'Rune pickaxe')).toBe('Rune pickaxe');
        expect(bestPickaxe(40, n => n === 'Rune pickaxe' || n === 'Adamant pickaxe')).toBe('Adamant pickaxe');
        expect(bestAxe(20, n => ['Rune axe', 'Steel axe', 'Bronze axe'].includes(n))).toBe('Steel axe');
    });

    test('toolKeepNames expands ladders + exact', () => {
        const names = toolKeepNames([pickaxeReq(), tinderboxReq()]);
        expect(names).toContain('Rune pickaxe');
        expect(names).toContain('Bronze pickaxe');
        expect(names).toContain(TINDERBOX);
    });

    test('hasAllTools / missing labels for axe + tinderbox', () => {
        const reqs = [axeReq(), tinderboxReq()];
        const none = (_: string) => 0;
        expect(hasAllTools(reqs, lvl, none)).toBe(false);
        expect(missingToolLabels(reqs, lvl, none).sort()).toEqual(['axe', TINDERBOX].sort());

        const held = (n: string) => (n === 'Rune axe' || n === TINDERBOX ? 1 : 0);
        expect(hasAllTools(reqs, lvl, held)).toBe(true);
        expect(toolKitLabel(reqs, lvl, held)).toContain('Rune axe');
        expect(toolKitLabel(reqs, lvl, held)).toContain(TINDERBOX);
    });

    test('toolRestockPlan withdraws best banked ladder + missing exact', () => {
        const reqs = [pickaxeReq(), exactTool(TINDERBOX)];
        const inv = (_: string) => 0;
        const plan = toolRestockPlan(reqs, lvl, inv, bank(['Adamant pickaxe', 'Bronze pickaxe', TINDERBOX]));
        expect(plan.map(p => p.name)).toEqual(['Adamant pickaxe', TINDERBOX]);
        expect(plan[0].equip).toBe(true);
    });

    test('toolRestockPlan skips tools already held', () => {
        const reqs = [axeReq(), tinderboxReq()];
        const inv = (n: string) => (n === 'Rune axe' || n === TINDERBOX ? 1 : 0);
        expect(toolRestockPlan(reqs, lvl, inv, bank(['Rune axe', TINDERBOX]))).toEqual([]);
    });
});
