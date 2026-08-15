import { describe, expect, test } from 'bun:test';
import {
    CRUSHED_GEMSTONE_ID,
    CHISEL_ID,
    GEM_OPTIONS,
    GEMS,
    eligibleGems,
    gemById,
    gemByCutId,
    gemByUncutId
} from '#/bot/scripts/GemCutter/GemCutterLogic.js';

describe('eligibleGems — level boundaries and ordering', () => {
    test('every gem the player can cut is included, lowest level first', () => {
        const result = eligibleGems(99, []);
        expect(result.length).toBe(GEMS.length);
        for (let i = 1; i < result.length; i++) {
            expect(result[i - 1].level).toBeLessThanOrEqual(result[i].level);
        }
    });

    test('exactly at the required level is enough', () => {
        const names = eligibleGems(20, []).map(g => g.name);
        expect(names).toContain('Sapphire');
        expect(names).not.toContain('Emerald');
    });

    test('just below the required level is excluded', () => {
        const names = eligibleGems(19, []).map(g => g.name);
        expect(names).not.toContain('Sapphire');
    });

    test('empty selection cuts every reachable gem', () => {
        expect(eligibleGems(99, [])).toHaveLength(GEMS.length);
    });

    test('a non-empty selection restricts to the named gems, case-insensitively', () => {
        const result = eligibleGems(99, ['SAPPHIRE', 'ruby']);
        expect(result.map(g => g.name)).toEqual(['Sapphire', 'Ruby']);
    });

    test('unknown selections add nothing', () => {
        expect(eligibleGems(99, ['Not a gem'])).toHaveLength(0);
    });
});

describe('gem table — a known row per uncut/cut id, engine-verified levels', () => {
    test('every entry has distinct unique ids', () => {
        const uncuts = new Set(GEMS.map(g => g.uncutId));
        const cuts = new Set(GEMS.map(g => g.cutId));
        expect(uncuts.size).toBe(GEMS.length);
        expect(cuts.size).toBe(GEMS.length);
    });

    test('engine-verified levels and xp', () => {
        const sapphire = GEMS.find(g => g.key === 'sapphire')!;
        const emerald = GEMS.find(g => g.key === 'emerald')!;
        const ruby = GEMS.find(g => g.key === 'ruby')!;
        const diamond = GEMS.find(g => g.key === 'diamond')!;
        const dragonstone = GEMS.find(g => g.key === 'dragonstone')!;
        const opal = GEMS.find(g => g.key === 'opal')!;
        const jade = GEMS.find(g => g.key === 'jade')!;
        const redTopaz = GEMS.find(g => g.key === 'red_topaz')!;

        expect(sapphire.level).toBe(20);
        expect(sapphire.xp).toBe(500);
        expect(emerald.level).toBe(27);
        expect(emerald.xp).toBe(675);
        expect(ruby.level).toBe(34);
        expect(ruby.xp).toBe(850);
        expect(diamond.level).toBe(43);
        expect(diamond.xp).toBe(1075);
        expect(dragonstone.level).toBe(55);
        expect(dragonstone.xp).toBe(1375);
        expect(opal.level).toBe(1);
        expect(opal.xp).toBe(150);
        expect(jade.level).toBe(13);
        expect(jade.xp).toBe(200);
        expect(redTopaz.level).toBe(16);
        expect(redTopaz.xp).toBe(250);
    });

    test('crushable gems flagged correctly', () => {
        expect(GEMS.find(g => g.key === 'opal')!.canCrush).toBe(true);
        expect(GEMS.find(g => g.key === 'jade')!.canCrush).toBe(true);
        expect(GEMS.find(g => g.key === 'red_topaz')!.canCrush).toBe(true);
        expect(GEMS.find(g => g.key === 'sapphire')!.canCrush).toBe(false);
        expect(GEMS.find(g => g.key === 'diamond')!.canCrush).toBe(false);
    });

    test('GEM_OPTIONS carries every gem name for the settings UI', () => {
        expect(GEM_OPTIONS).toHaveLength(GEMS.length);
        expect(GEM_OPTIONS).toContain('Sapphire');
        expect(GEM_OPTIONS).toContain('Dragonstone');
        expect(GEM_OPTIONS).toContain('Opal');
    });
});

describe('id lookups', () => {
    test('gemById finds either the uncut or the cut id', () => {
        const sapphire = GEMS.find(g => g.key === 'sapphire')!;
        expect(gemById(sapphire.uncutId)?.key).toBe('sapphire');
        expect(gemById(sapphire.cutId)?.key).toBe('sapphire');
    });

    test('gemByCutId only matches the cut id', () => {
        const sapphire = GEMS.find(g => g.key === 'sapphire')!;
        expect(gemByCutId(sapphire.cutId)?.key).toBe('sapphire');
        expect(gemByCutId(sapphire.uncutId)).toBeNull();
    });

    test('gemByUncutId only matches the uncut id', () => {
        const sapphire = GEMS.find(g => g.key === 'sapphire')!;
        expect(gemByUncutId(sapphire.uncutId)?.key).toBe('sapphire');
        expect(gemByUncutId(sapphire.cutId)).toBeNull();
    });

    test('unmatched ids and unknown gems are null', () => {
        expect(gemById(-1)).toBeNull();
        expect(gemByCutId(-1)).toBeNull();
        expect(gemByUncutId(-1)).toBeNull();
    });
});

describe('constants', () => {
    test('CHISEL_ID matches content', () => {
        expect(CHISEL_ID).toBe(1755);
    });
    test('CRUSHED_GEMSTONE_ID matches content', () => {
        expect(CRUSHED_GEMSTONE_ID).toBe(1633);
    });
});