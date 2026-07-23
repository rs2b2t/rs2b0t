import { expect, test } from 'bun:test';
import { resolveControl, summarize } from '#/bot/ui/paramControls.js';
import type { SettingDef } from '#/bot/runtime/Settings.js';

const def = (d: Partial<SettingDef> & Pick<SettingDef, 'type' | 'default'>): SettingDef => d as SettingDef;

test('resolveControl maps each SettingDef shape to a kind', () => {
    expect(resolveControl(def({ type: 'boolean', default: false }))).toBe('checkbox');
    expect(resolveControl(def({ type: 'number', default: 5, min: 0, max: 10 }))).toBe('slider');
    expect(resolveControl(def({ type: 'number', default: 5 }))).toBe('number');
    expect(resolveControl(def({ type: 'string', default: 'a', options: ['a', 'b'] }))).toBe('dropdown');
    expect(resolveControl(def({ type: 'string', default: 'a' }))).toBe('text');
    expect(resolveControl(def({ type: 'string[]', default: [], options: ['a', 'b'] }))).toBe('multiselect');
    expect(resolveControl(def({ type: 'string[]', default: [] }))).toBe('taglist');
    expect(resolveControl(def({ type: 'tile', default: null }))).toBe('tile');
});

test('summarize formats each kind compactly', () => {
    expect(summarize(def({ type: 'boolean', default: false }), 'true')).toBe('on');
    expect(summarize(def({ type: 'boolean', default: false }), 'false')).toBe('off');
    expect(summarize(def({ type: 'number', default: 5, min: 0, max: 10 }), '8')).toBe('8');
    expect(summarize(def({ type: 'string', default: 'a', options: ['Auto', 'None'] }), 'Auto')).toBe('Auto');
    expect(summarize(def({ type: 'string', default: '' }), '')).toBe('(empty)');
    expect(summarize(def({ type: 'string[]', default: [], options: ['Iron', 'Coal'] }), 'Iron, Coal')).toBe('Iron, Coal');
    expect(summarize(def({ type: 'string[]', default: [] }), '')).toBe('(none)');
    expect(summarize(def({ type: 'tile', default: null }), '2661,3306,0')).toBe('2661, 3306');
});

import { groupSchema, isVisible, visibilityDeps } from '#/bot/ui/paramControls.js';
import type { SettingsSchema } from '#/bot/runtime/Settings.js';

const grouped: SettingsSchema = {
    style: { type: 'string', default: 'melee', options: ['melee', 'mage'] },
    spell: { type: 'string', default: 'Wind Strike', group: 'Combat', showIf: { key: 'style', anyOf: ['mage'] } },
    food: { type: 'string', default: 'Lobster', group: 'Food' },
    eatAt: { type: 'number', default: 50, group: 'Food' },
    weapon: { type: 'string', default: '', group: 'Combat' }
};

test('groupSchema: ungrouped lead section first, then groups in first-appearance order', () => {
    expect(groupSchema(grouped)).toEqual([
        { name: '', keys: ['style'] },
        { name: 'Combat', keys: ['spell', 'weapon'] },
        { name: 'Food', keys: ['food', 'eatAt'] }
    ]);
});

test('groupSchema: fully ungrouped schema is a single lead section', () => {
    const flat: SettingsSchema = { a: { type: 'number', default: 1 }, b: { type: 'boolean', default: true } };
    expect(groupSchema(flat)).toEqual([{ name: '', keys: ['a', 'b'] }]);
});

test('isVisible: unconditioned always shows; showIf matches case-insensitively', () => {
    expect(isVisible(grouped.food, () => 'anything')).toBe(true);
    expect(isVisible(grouped.spell, key => (key === 'style' ? 'MAGE' : ''))).toBe(true);
    expect(isVisible(grouped.spell, key => (key === 'style' ? 'melee' : ''))).toBe(false);
});

test('visibilityDeps: only keys referenced by a showIf', () => {
    expect(visibilityDeps(grouped)).toEqual(new Set(['style']));
});
