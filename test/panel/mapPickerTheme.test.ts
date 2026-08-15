import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
    getMapPickerShowBasemap,
    isMapPickerThemeSettingKey,
    keyNameToTypeId,
    MAP_PICKER_BASEMAP_KEY,
    MAP_PICKER_DOT_DEFAULT,
    MAP_PICKER_KEY_TYPES_KEY,
    resolveMapPickerDotTheme,
    setMapPickerShowBasemap
} from '#/bot/panel/mapPickerTheme.js';
import { MAP_PICKER_SETTINGS_NS, SettingsStore } from '#/bot/runtime/Settings.js';

beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
});
afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
});

describe('resolveMapPickerDotTheme', () => {
    test('defaults: basemap on → no walkable grid; no Key types', () => {
        const t = resolveMapPickerDotTheme();
        expect(t.showBasemap).toBe(true);
        expect(t.showWalkable).toBe(false);
        expect(t.keyIconTypes).toEqual([]);
        expect(t.showPlaceLabels).toBe(false);
        expect(t.showMultiTint).toBe(false);
        expect(t.showFreeTint).toBe(false);
        expect(t.colorRaw).toBe(MAP_PICKER_DOT_DEFAULT);
    });

    test('showBasemap=false → classic mode (walkable dots on)', () => {
        setMapPickerShowBasemap(false);
        expect(getMapPickerShowBasemap()).toBe(false);
        const t = resolveMapPickerDotTheme();
        expect(t.showBasemap).toBe(false);
        expect(t.showWalkable).toBe(true);
    });

    test('keyIconTypes multiselect', () => {
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, MAP_PICKER_KEY_TYPES_KEY, 'Bank,Altar');
        expect(resolveMapPickerDotTheme().keyIconTypes).toEqual(['Bank', 'Altar']);
        expect(keyNameToTypeId('Bank')).toBe(5);
        expect(keyNameToTypeId('Altar')).toBe(19);
    });

    test('custom colour and alpha', () => {
        setMapPickerShowBasemap(false);
        // Always go through SettingsStore so box-scoped keys match saved().
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'dotColor', '#ff0000');
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'dotAlpha', '0.5');
        const t = resolveMapPickerDotTheme();
        expect(t.colorRaw).toBe('#ff0000');
        expect(t.alpha).toBeCloseTo(0.5, 5);
        expect(t.fill).toBe('rgba(255, 0, 0, 0.5)');
    });

    test('fractional opacity is not rounded to an integer', () => {
        setMapPickerShowBasemap(false);
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, 'dotAlpha', '0.35');
        const t = resolveMapPickerDotTheme();
        expect(t.alpha).toBeCloseTo(0.35, 5);
        expect(t.fill).toContain('0.35');
    });
});

describe('set/get MapPicker settings stay aligned with SettingsStore', () => {
    test('setMapPickerShowBasemap writes MapPicker namespace', () => {
        setMapPickerShowBasemap(false);
        expect(SettingsStore.saved(MAP_PICKER_SETTINGS_NS, MAP_PICKER_BASEMAP_KEY)).toBe('false');
        expect(getMapPickerShowBasemap()).toBe(false);
    });

    test('SettingsStore.onChange fires for MapPicker namespace', () => {
        let seen: { name: string; key: string; value: string } | null = null;
        const unsub = SettingsStore.onChange((name, key, value) => {
            seen = { name, key, value: String(value) };
        });
        try {
            setMapPickerShowBasemap(false);
            expect(seen as { name: string; key: string; value: string } | null).toEqual({ name: MAP_PICKER_SETTINGS_NS, key: MAP_PICKER_BASEMAP_KEY, value: 'false' });
        } finally {
            unsub();
        }
    });
});

describe('isMapPickerThemeSettingKey', () => {
    test('display + pre-baked layer keys repaint live', () => {
        expect(isMapPickerThemeSettingKey(MAP_PICKER_BASEMAP_KEY)).toBe(true);
        expect(isMapPickerThemeSettingKey('dotColor')).toBe(true);
        expect(isMapPickerThemeSettingKey(MAP_PICKER_KEY_TYPES_KEY)).toBe(true);
        expect(isMapPickerThemeSettingKey('showPlaceLabels')).toBe(true);
        expect(isMapPickerThemeSettingKey('showMultiTint')).toBe(true);
        expect(isMapPickerThemeSettingKey('showFreeTint')).toBe(true);
        expect(isMapPickerThemeSettingKey('bakeLabels')).toBe(false);
        expect(isMapPickerThemeSettingKey('showWalkable')).toBe(false);
    });
});
