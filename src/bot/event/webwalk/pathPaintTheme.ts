// Why: the wired settings are path, transport, click and text, plus size and show-text.
// Why: calculating, unreachable and collision are reserved slots, not yet in the Global UI.

import { SettingsStore, type SettingsBag } from '../../runtime/Settings.js';

/** Defaults: red path, green transports, white text/click; alphas applied at paint time. */
export const NAV_PATH_PAINT_DEFAULTS = {
    path: '#FF0000',
    transport: '#00FF00',
    click: '#FFFFFF',
    text: '#FFFFFF',
    textSize: 11,
    showText: true
} as const;

/** Paint roles we do not wire yet (no live data). */
export const NAV_PATH_PAINT_RESERVED = {
    calculating: '#0000FF',
    unreachable: '#C828F0',
    collision: '#0080FF'
} as const;

interface Rgb {
    r: number;
    g: number;
    b: number;
}

export interface NavPathPaintTheme {
    walkFill: string;
    walkStroke: string;
    doneFill: string;
    doneStroke: string;
    hopFill: string;
    hopStroke: string;
    clickStroke: string;
    textFill: string;
    textShadow: string;
    textSize: number;
    showText: boolean;
}

/** Parse HTML `#RGB` / `#RRGGBB` (optional leading #). Falls back on invalid input. */
export function parseHtmlColor(raw: string, fallback: string = NAV_PATH_PAINT_DEFAULTS.path): Rgb {
    const tryParse = (s: string): Rgb | null => {
        const t = s.trim().replace(/^#/, '');
        if (/^[0-9a-fA-F]{3}$/.test(t)) {
            return {
                r: parseInt(t[0]! + t[0]!, 16),
                g: parseInt(t[1]! + t[1]!, 16),
                b: parseInt(t[2]! + t[2]!, 16)
            };
        }
        if (/^[0-9a-fA-F]{6}$/.test(t)) {
            return {
                r: parseInt(t.slice(0, 2), 16),
                g: parseInt(t.slice(2, 4), 16),
                b: parseInt(t.slice(4, 6), 16)
            };
        }
        return null;
    };
    return tryParse(raw) ?? tryParse(fallback) ?? { r: 255, g: 0, b: 0 };
}

export function rgba(c: Rgb, a: number): string {
    const alpha = Math.max(0, Math.min(1, a));
    return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

export function resolveNavPathPaintTheme(bag?: SettingsBag): NavPathPaintTheme {
    const g = bag ?? SettingsStore.globalBag();
    const path = parseHtmlColor(g.str('navPathColorPath', NAV_PATH_PAINT_DEFAULTS.path), NAV_PATH_PAINT_DEFAULTS.path);
    const transport = parseHtmlColor(
        g.str('navPathColorTransport', NAV_PATH_PAINT_DEFAULTS.transport),
        NAV_PATH_PAINT_DEFAULTS.transport
    );
    const click = parseHtmlColor(g.str('navPathColorClick', NAV_PATH_PAINT_DEFAULTS.click), NAV_PATH_PAINT_DEFAULTS.click);
    const text = parseHtmlColor(g.str('navPathColorText', NAV_PATH_PAINT_DEFAULTS.text), NAV_PATH_PAINT_DEFAULTS.text);
    let textSize = g.num('navPathTextSize', NAV_PATH_PAINT_DEFAULTS.textSize);
    if (!Number.isFinite(textSize)) {
        textSize = NAV_PATH_PAINT_DEFAULTS.textSize;
    }
    textSize = Math.max(8, Math.min(28, Math.round(textSize)));
    const showText = g.bool('navPathShowText', NAV_PATH_PAINT_DEFAULTS.showText);

    return {
        walkFill: rgba(path, 0.32),
        walkStroke: rgba(path, 0.9),
        doneFill: rgba(path, 0.1),
        doneStroke: rgba(path, 0.35),
        hopFill: rgba(transport, 0.5),
        hopStroke: rgba(transport, 0.95),
        clickStroke: rgba(click, 0.95),
        textFill: rgba(text, 1),
        textShadow: 'rgba(0, 0, 0, 0.75)',
        textSize,
        showText
    };
}
