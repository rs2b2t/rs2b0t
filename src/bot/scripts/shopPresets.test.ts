import { expect, test, describe } from 'bun:test';
import { SHOP_PRESETS, presetByLabel, presetBuyableNames } from './shopPresets.js';
import { SHOP_DB } from '../shops/data/shopdb.js';

describe('shop presets', () => {
    test('labels are unique (they are the dropdown options)', () => {
        const labels = SHOP_PRESETS.map(p => p.label);
        expect(new Set(labels).size).toBe(labels.length);
    });
    test('every keeper matches a shopdb shopkeeper (catches typos on new shops)', () => {
        for (const p of SHOP_PRESETS) {
            const rec = Object.values(SHOP_DB).find(r => r.keepers.includes(p.keeper));
            expect(rec, `no shopdb shop for keeper '${p.keeper}' (${p.label})`).toBeDefined();
        }
    });
    test('presetByLabel round-trips; unknown label -> undefined', () => {
        expect(presetByLabel(SHOP_PRESETS[0].label)?.keeper).toBe(SHOP_PRESETS[0].keeper);
        expect(presetByLabel('nope')).toBeUndefined();
    });
    test('buyable names cover the listed shops (arrows + feathers + runes present)', () => {
        const names = presetBuyableNames().map(n => n.toLowerCase());
        expect(names.some(n => n.includes('rune'))).toBe(true);
        expect(names.some(n => n.includes('arrow'))).toBe(true);
        expect(names).toContain('feather');
    });
});
