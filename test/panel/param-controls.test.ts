import { expect, test } from 'bun:test';
import { resolveControl, summarize } from '#/bot/panel/paramControls.js';
import { GLOBAL_SETTINGS, MAP_PICKER_SETTINGS, type SettingDef } from '#/bot/runtime/Settings.js';

const def = (d: Partial<SettingDef> & Pick<SettingDef, 'type' | 'default'>): SettingDef => d as SettingDef;

test('resolveControl maps each SettingDef shape to a kind', () => {
    expect(resolveControl(def({ type: 'boolean', default: false }))).toBe('checkbox');
    expect(resolveControl(def({ type: 'number', default: 5, min: 0, max: 10 }))).toBe('slider');
    expect(resolveControl(def({ type: 'number', default: 5 }))).toBe('number');
    expect(resolveControl(def({ type: 'string', default: 'a', options: ['a', 'b'] }))).toBe('dropdown');
    expect(resolveControl(def({ type: 'string', default: 'a' }))).toBe('text');
    expect(resolveControl(def({ type: 'string', default: '#0a3d7a', color: true }))).toBe('color');
    expect(resolveControl(def({ type: 'string[]', default: [], options: ['a', 'b'] }))).toBe('multiselect');
    expect(resolveControl(def({ type: 'string[]', default: [] }))).toBe('taglist');
    expect(resolveControl(def({ type: 'tile', default: null }))).toBe('tile');
});

test('every Global / MapPicker HTML colour setting uses the colour control', () => {
    const colorKeys = [
        ...Object.entries(GLOBAL_SETTINGS),
        ...Object.entries(MAP_PICKER_SETTINGS)
    ].filter(([, d]) => d.color === true);
    expect(colorKeys.length).toBeGreaterThanOrEqual(7);
    for (const [key, d] of colorKeys) {
        expect(d.type).toBe('string');
        expect(typeof d.default).toBe('string');
        expect(String(d.default)).toMatch(/^#[0-9A-Fa-f]{3,8}$/);
        expect(resolveControl(d)).toBe('color');
        // Guard against hex defaults that forgot color: true — already filtered.
        expect(key.length).toBeGreaterThan(0);
    }
    // Nav path paint colours must all opt in (regression vs freeform text fields).
    for (const key of [
        'navPathColorPath',
        'navPathColorTransport',
        'navPathColorClick',
        'navPathColorText',
        'navPathColorClient',
        'navPathColorClientRunAlt'
    ]) {
        expect(GLOBAL_SETTINGS[key]?.color).toBe(true);
        expect(resolveControl(GLOBAL_SETTINGS[key]!)).toBe('color');
    }
    expect(MAP_PICKER_SETTINGS.dotColor?.color).toBe(true);
});

test('summarize formats each kind compactly', () => {
    expect(summarize(def({ type: 'boolean', default: false }), 'true')).toBe('on');
    expect(summarize(def({ type: 'boolean', default: false }), ' YES ')).toBe('on');
    expect(summarize(def({ type: 'boolean', default: false }), 'false')).toBe('off');
    expect(summarize(def({ type: 'number', default: 5, min: 0, max: 10 }), '8')).toBe('8');
    expect(summarize(def({ type: 'string', default: 'a', options: ['Auto', 'None'] }), 'Auto')).toBe('Auto');
    expect(summarize(def({ type: 'string', default: '' }), '')).toBe('(empty)');
    expect(summarize(def({ type: 'string[]', default: [], options: ['Iron', 'Coal'] }), 'Iron, Coal')).toBe('Iron, Coal');
    expect(summarize(def({
        type: 'string[]',
        default: [],
        options: ['cook', 'sheep'],
        optionLabels: { cook: "Cook's Assistant", sheep: 'Sheep Shearer' }
    }), 'cook, sheep')).toBe("Cook's Assistant, Sheep Shearer");
    expect(summarize(def({
        type: 'string',
        default: 'cook',
        options: ['cook'],
        optionLabels: { cook: "Cook's Assistant" }
    }), 'cook')).toBe("Cook's Assistant");
    expect(summarize(def({ type: 'string[]', default: [] }), '')).toBe('(none)');
    expect(summarize(def({ type: 'tile', default: null }), '2661,3306,0')).toBe('2661, 3306');
});

import { groupSchema, isVisible, visibilityDeps } from '#/bot/panel/paramControls.js';
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
