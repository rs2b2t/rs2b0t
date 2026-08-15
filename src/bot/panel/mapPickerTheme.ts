/**
 * Map picker display theme — SettingsStore namespace `MapPicker` (in-picker Settings modal).
 * Not part of Global settings.
 */
import { parseHtmlColor, rgba } from '../event/webwalk/pathPaintTheme.js';
import { WORLDMAP_KEY_NAMES } from '../../client/mapview/worldmapKeyNames.js';
import {
    MAP_PICKER_SETTINGS,
    MAP_PICKER_SETTINGS_NS,
    SettingsBag,
    SettingsStore
} from '../runtime/Settings.js';

/** Default dark blue — readable on basemap. */
export const MAP_PICKER_DOT_DEFAULT = '#0a3d7a';
const MAP_PICKER_DOT_ALPHA_DEFAULT = 0.85;

export const MAP_PICKER_BASEMAP_KEY = 'showBasemap';
const MAP_PICKER_COLOR_KEY = 'dotColor';
const MAP_PICKER_ALPHA_KEY = 'dotAlpha';
export const MAP_PICKER_KEY_TYPES_KEY = 'keyIconTypes';
const MAP_PICKER_LABELS_KEY = 'showPlaceLabels';
const MAP_PICKER_MULTI_KEY = 'showMultiTint';
const MAP_PICKER_FREE_KEY = 'showFreeTint';

type MapPickerDotTheme = {
    /** Classic worldmap terrain mode (vs collision-dot mode). */
    showBasemap: boolean;
    /**
     * Walkable collision dots — only drawn when basemap is **off** (classic mode).
     * Always true in classic mode; always false in basemap mode.
     */
    showWalkable: boolean;
    /** Selected Key legend type names (empty = none). */
    keyIconTypes: string[];
    /** Pre-baked town / place-name labels. */
    showPlaceLabels: boolean;
    showMultiTint: boolean;
    showFreeTint: boolean;
    fill: string;
    colorRaw: string;
    alpha: number;
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

/** Key type names enabled in settings (classic Key legend names). */
function getMapPickerKeyIconTypes(): string[] {
    const list = mapPickerBag().list(MAP_PICKER_KEY_TYPES_KEY, []);
    // Drop unknown names (schema options are the source of truth).
    const allowed = new Set(WORLDMAP_KEY_NAMES.map(n => n.toLowerCase()));
    return list.filter(n => allowed.has(n.toLowerCase()));
}

/**
 * Map Key legend name → mapfunction type id (index in WORLDMAP_KEY_NAMES).
 */
export function keyNameToTypeId(name: string): number | null {
    const wanted = name.trim().toLowerCase();
    const i = WORLDMAP_KEY_NAMES.findIndex(n => n.toLowerCase() === wanted);
    return i >= 0 ? i : null;
}

export function resolveMapPickerDotTheme(): MapPickerDotTheme {
    const g = mapPickerBag();
    const showBasemap = g.bool(MAP_PICKER_BASEMAP_KEY, true);
    // Classic mode always shows the walkable grid; basemap mode never does.
    const showWalkable = !showBasemap;
    const colorRaw = g.str(MAP_PICKER_COLOR_KEY, MAP_PICKER_DOT_DEFAULT);
    const alpha = g.num(MAP_PICKER_ALPHA_KEY, MAP_PICKER_DOT_ALPHA_DEFAULT);
    const rgb = parseHtmlColor(colorRaw, MAP_PICKER_DOT_DEFAULT);
    return {
        showBasemap,
        showWalkable,
        keyIconTypes: getMapPickerKeyIconTypes(),
        showPlaceLabels: g.bool(MAP_PICKER_LABELS_KEY, false),
        showMultiTint: g.bool(MAP_PICKER_MULTI_KEY, false),
        showFreeTint: g.bool(MAP_PICKER_FREE_KEY, false),
        fill: rgba(rgb, alpha),
        colorRaw,
        alpha
    };
}

/** Display / layer keys that should repaint the open map picker when saved. */
export function isMapPickerThemeSettingKey(key: string): boolean {
    return (
        key === MAP_PICKER_BASEMAP_KEY ||
        key === MAP_PICKER_COLOR_KEY ||
        key === MAP_PICKER_ALPHA_KEY ||
        key === MAP_PICKER_KEY_TYPES_KEY ||
        key === MAP_PICKER_LABELS_KEY ||
        key === MAP_PICKER_MULTI_KEY ||
        key === MAP_PICKER_FREE_KEY
    );
}
