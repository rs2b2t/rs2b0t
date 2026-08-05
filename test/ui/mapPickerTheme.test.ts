import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
    getMapPickerShowBasemap,
    getMapPickerShowWalkable,
    isMapPickerShowWalkableUrlLocked,
    isMapPickerThemeSettingKey,
    MAP_PICKER_BASEMAP_KEY,
    MAP_PICKER_DOT_DEFAULT,
    MAP_PICKER_SHOW_KEY,
    resolveMapPickerDotTheme,
    setMapPickerShowBasemap,
    setMapPickerShowWalkable
} from '#/bot/ui/mapPickerTheme.js';
import { MAP_PICKER_SETTINGS_NS, SettingsStore } from '#/bot/runtime/Settings.js';

const K = (key: string) => `rs2b0t:set:${MAP_PICKER_SETTINGS_NS}:${key}`;

beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
});
afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
});

describe('resolveMapPickerDotTheme', () => {
    test('defaults: basemap on, walkable dots off, dark blue fill when enabled', () => {
        const t = resolveMapPickerDotTheme();
        expect(t.showBasemap).toBe(true);
        expect(t.showWalkable).toBe(false);
        expect(t.colorRaw).toBe(MAP_PICKER_DOT_DEFAULT);
        expect(t.fill).toMatch(/^rgba\(10, 61, 122,/);
        expect(t.alpha).toBeCloseTo(0.85, 5);
        expect(t.showWalkableUrlLocked).toBe(false);
    });

    test('showBasemap=false', () => {
        setMapPickerShowBasemap(false);
        expect(getMapPickerShowBasemap()).toBe(false);
        expect(resolveMapPickerDotTheme().showBasemap).toBe(false);
    });

    test('showWalkable=true shows dots', () => {
        sessionStorage.setItem(K(MAP_PICKER_SHOW_KEY), 'true');
        expect(getMapPickerShowWalkable()).toBe(true);
        expect(resolveMapPickerDotTheme().showWalkable).toBe(true);
    });

    test('custom colour and alpha', () => {
        sessionStorage.setItem(K('dotColor'), '#ff0000');
        sessionStorage.setItem(K('dotAlpha'), '0.5');
        const t = resolveMapPickerDotTheme();
        expect(t.fill).toBe('rgba(255, 0, 0, 0.5)');
        expect(t.alpha).toBe(0.5);
    });
});

describe('set/get MapPicker settings stay aligned with SettingsStore', () => {
    test('setMapPickerShowWalkable writes MapPicker namespace', () => {
        expect(getMapPickerShowWalkable()).toBe(false);
        setMapPickerShowWalkable(true);
        expect(getMapPickerShowWalkable()).toBe(true);
        expect(sessionStorage.getItem(K(MAP_PICKER_SHOW_KEY))).toBe('true');

        setMapPickerShowWalkable(false);
        expect(getMapPickerShowWalkable()).toBe(false);
    });

    test('SettingsStore.save MapPicker keys match getters', () => {
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, MAP_PICKER_SHOW_KEY, 'true');
        expect(getMapPickerShowWalkable()).toBe(true);
        SettingsStore.save(MAP_PICKER_SETTINGS_NS, MAP_PICKER_SHOW_KEY, 'false');
        expect(getMapPickerShowWalkable()).toBe(false);
    });

    test('SettingsStore.onChange fires for MapPicker namespace', () => {
        let seen: { name: string; key: string; value: string } | null = null;
        const unsub = SettingsStore.onChange((name, key, value) => {
            seen = { name, key, value };
        });
        try {
            setMapPickerShowWalkable(true);
            expect(seen).toEqual({ name: MAP_PICKER_SETTINGS_NS, key: MAP_PICKER_SHOW_KEY, value: 'true' });
            SettingsStore.save(MAP_PICKER_SETTINGS_NS, MAP_PICKER_BASEMAP_KEY, 'false');
            expect(seen).toEqual({
                name: MAP_PICKER_SETTINGS_NS,
                key: MAP_PICKER_BASEMAP_KEY,
                value: 'false'
            });
            expect(getMapPickerShowBasemap()).toBe(false);
        } finally {
            unsub();
        }
    });
});

describe('isMapPickerThemeSettingKey', () => {
    test('only display keys that repaint live', () => {
        expect(isMapPickerThemeSettingKey(MAP_PICKER_BASEMAP_KEY)).toBe(true);
        expect(isMapPickerThemeSettingKey(MAP_PICKER_SHOW_KEY)).toBe(true);
        expect(isMapPickerThemeSettingKey('dotColor')).toBe(true);
        expect(isMapPickerThemeSettingKey('dotAlpha')).toBe(true);
        expect(isMapPickerThemeSettingKey('bakeLabels')).toBe(false);
        expect(isMapPickerThemeSettingKey('showNavPath')).toBe(false);
    });
});

describe('isMapPickerShowWalkableUrlLocked', () => {
    test('false without URL override', () => {
        expect(isMapPickerShowWalkableUrlLocked()).toBe(false);
    });
});
