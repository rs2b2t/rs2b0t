/**
 * Map picker display theme — SettingsStore namespace `MapPicker` (in-picker Settings modal).
 * Not part of Global settings.
 */
import { parseHtmlColor, rgba } from '../nav/pathPaintTheme.js';
import {
    MAP_PICKER_SETTINGS,
    MAP_PICKER_SETTINGS_NS,
    SettingsBag,
    SettingsStore
} from '../runtime/Settings.js';

/** Default dark blue — readable on basemap. */
export const MAP_PICKER_DOT_DEFAULT = '#0a3d7a';
export const MAP_PICKER_DOT_ALPHA_DEFAULT = 0.85;

export const MAP_PICKER_BASEMAP_KEY = 'showBasemap';
export const MAP_PICKER_SHOW_KEY = 'showWalkable';
export const MAP_PICKER_COLOR_KEY = 'dotColor';
export const MAP_PICKER_ALPHA_KEY = 'dotAlpha';

export type MapPickerDotTheme = {
    showBasemap: boolean;
    showWalkable: boolean;
    fill: string;
    colorRaw: string;
    alpha: number;
    showWalkableUrlLocked: boolean;
};

function mapPickerBag(): SettingsBag {
    return new SettingsBag(SettingsStore.resolve(MAP_PICKER_SETTINGS_NS, MAP_PICKER_SETTINGS));
}

export function getMapPickerShowBasemap(): boolean {
    return mapPickerBag().bool(MAP_PICKER_BASEMAP_KEY, true);
}

export function setMapPickerShowBasemap(show: boolean): void {
    SettingsStore.save(MAP_PICKER_SETTINGS_NS, MAP_PICKER_BASEMAP_KEY, show ? 'true' : 'false');
}

export function getMapPickerShowWalkable(): boolean {
    return mapPickerBag().bool(MAP_PICKER_SHOW_KEY, false);
}

export function setMapPickerShowWalkable(show: boolean): void {
    SettingsStore.save(MAP_PICKER_SETTINGS_NS, MAP_PICKER_SHOW_KEY, show ? 'true' : 'false');
}

export function isMapPickerShowWalkableUrlLocked(): boolean {
    return SettingsStore.isUrlOverride(MAP_PICKER_SETTINGS_NS, MAP_PICKER_SHOW_KEY);
}

export function resolveMapPickerDotTheme(): MapPickerDotTheme {
    const g = mapPickerBag();
    const showBasemap = g.bool(MAP_PICKER_BASEMAP_KEY, true);
    const showWalkable = g.bool(MAP_PICKER_SHOW_KEY, false);
    const colorRaw = g.str(MAP_PICKER_COLOR_KEY, MAP_PICKER_DOT_DEFAULT);
    const alpha = g.num(MAP_PICKER_ALPHA_KEY, MAP_PICKER_DOT_ALPHA_DEFAULT);
    const rgb = parseHtmlColor(colorRaw, MAP_PICKER_DOT_DEFAULT);
    return {
        showBasemap,
        showWalkable,
        fill: rgba(rgb, alpha),
        colorRaw,
        alpha,
        showWalkableUrlLocked: isMapPickerShowWalkableUrlLocked()
    };
}

/** Display keys that should repaint the open map picker when saved. */
export function isMapPickerThemeSettingKey(key: string): boolean {
    return (
        key === MAP_PICKER_BASEMAP_KEY ||
        key === MAP_PICKER_SHOW_KEY ||
        key === MAP_PICKER_COLOR_KEY ||
        key === MAP_PICKER_ALPHA_KEY
    );
}
