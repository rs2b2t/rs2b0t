import { describe, expect, test } from 'bun:test';

import {
    AXES,
    PICKAXES,
    TINDERBOX,
    axeReq,
    bestAxe,
    bestFromTiers,
    bestPickaxe,
    canWieldTool,
    exactTool,
    hasAllTools,
    missingToolLabels,
    pickaxeReq,
    tinderboxReq,
    toolAttackLevel,
    toolKeepNames,
    toolKitLabel,
    toolRestockPlan,
    toolsNeedingEquip
} from '#/bot/api/Tools.js';

describe('Tools kit', () => {
    const bank = (names: string[]) => (name: string) => (names.includes(name) ? 1 : 0);
    // Attack 40 so rune tools are wieldable in the default kit tests.
    const lvl = (skill: string) =>
        skill === 'mining' || skill === 'woodcutting' ? 41 : skill === 'attack' ? 40 : 1;

    test('tiers are best-first', () => {
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

    test('bestFromTiers matches bestPickaxe', () => {
        const avail = (n: string) => n === 'Mithril pickaxe' || n === 'Bronze pickaxe';
        expect(bestFromTiers(41, PICKAXES, avail)).toBe(bestPickaxe(41, avail));
    });

    test('toolKeepNames expands tiers + exact', () => {
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

    test('toolRestockPlan withdraws best banked tier + missing exact', () => {
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

    test('toolRestockPlan withdraws better bank tier when worse is held', () => {
        const reqs = [axeReq(true), tinderboxReq()];
        // Bronze equipped/held, steel + tinderbox in bank — must pull steel (and tinderbox if missing).
        const inv = (n: string) => (n === 'Bronze axe' ? 1 : 0);
        const plan = toolRestockPlan(reqs, lvl, inv, bank(['Steel axe', 'Bronze axe', TINDERBOX]));
        expect(plan.map(p => p.name)).toEqual(['Steel axe', TINDERBOX]);
        expect(plan[0].equip).toBe(true);
    });

    test('toolRestockPlan skips same-tier bank duplicate when best is already held', () => {
        const reqs = [axeReq(true)];
        const inv = (n: string) => (n === 'Steel axe' ? 1 : 0);
        expect(toolRestockPlan(reqs, lvl, inv, bank(['Steel axe', 'Bronze axe']))).toEqual([]);
    });

    test('toolsNeedingEquip when best tier held but not worn', () => {
        const reqs = [axeReq(true), tinderboxReq()];
        const count = (n: string) => (n === 'Rune axe' || n === TINDERBOX ? 1 : 0);
        const noneWorn = () => false;
        expect(toolsNeedingEquip(reqs, lvl, count, noneWorn)).toEqual(['Rune axe']);
        expect(toolsNeedingEquip(reqs, lvl, count, n => n === 'Rune axe')).toEqual([]);
    });

    test('toolsNeedingEquip skips non-equip reqs', () => {
        const reqs = [axeReq(false), tinderboxReq()];
        const count = (n: string) => (n === 'Rune axe' || n === TINDERBOX ? 1 : 0);
        expect(toolsNeedingEquip(reqs, lvl, count, () => false)).toEqual([]);
    });

    test('toolAttackLevel / canWieldTool follow classic metal Attack gates', () => {
        expect(toolAttackLevel('Rune pickaxe')).toBe(40);
        expect(toolAttackLevel('Adamant axe')).toBe(30);
        expect(toolAttackLevel('Steel pickaxe')).toBe(5);
        expect(toolAttackLevel('Bronze axe')).toBe(1);
        expect(canWieldTool('Rune pickaxe', 39)).toBe(false);
        expect(canWieldTool('Rune pickaxe', 40)).toBe(true);
        expect(canWieldTool('Mithril axe', 19)).toBe(false);
        expect(canWieldTool('Mithril axe', 20)).toBe(true);
    });

    test('toolsNeedingEquip skips wield when Attack is too low (backpack use still ok)', () => {
        const reqs = [pickaxeReq(true)];
        const count = (n: string) => (n === 'Rune pickaxe' ? 1 : 0);
        // Mining 90 can *use* rune pick; Attack 1 cannot *wield* it.
        const lowAtk = (skill: string) => (skill === 'mining' ? 90 : skill === 'attack' ? 1 : 1);
        expect(toolsNeedingEquip(reqs, lowAtk, count, () => false)).toEqual([]);
        const highAtk = (skill: string) => (skill === 'mining' ? 90 : skill === 'attack' ? 40 : 1);
        expect(toolsNeedingEquip(reqs, highAtk, count, () => false)).toEqual(['Rune pickaxe']);
    });
});
