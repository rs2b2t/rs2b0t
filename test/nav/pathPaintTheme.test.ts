import { describe, expect, test } from 'bun:test';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import {
    NAV_PATH_PAINT_DEFAULTS,
    NAV_PATH_PAINT_RESERVED,
    parseHtmlColor,
    resolveNavPathPaintTheme,
    rgba
} from '#/bot/nav/pathPaintTheme.js';

describe('parseHtmlColor', () => {
    test('accepts #RGB and #RRGGBB', () => {
        expect(parseHtmlColor('#F00')).toEqual({ r: 255, g: 0, b: 0 });
        expect(parseHtmlColor('#00FF00')).toEqual({ r: 0, g: 255, b: 0 });
        expect(parseHtmlColor('00FF00')).toEqual({ r: 0, g: 255, b: 0 });
    });
    test('falls back on garbage', () => {
        expect(parseHtmlColor('nope', '#0000FF')).toEqual({ r: 0, g: 0, b: 255 });
    });
});

describe('resolveNavPathPaintTheme', () => {
    test('defaults match SP path/transport/text', () => {
        const t = resolveNavPathPaintTheme(new SettingsBag({}));
        expect(t.showText).toBe(true);
        expect(t.textSize).toBe(11);
        expect(t.walkFill).toBe(rgba(parseHtmlColor(NAV_PATH_PAINT_DEFAULTS.path), 0.32));
        expect(t.hopFill).toBe(rgba(parseHtmlColor(NAV_PATH_PAINT_DEFAULTS.transport), 0.5));
        expect(t.textFill).toBe(rgba(parseHtmlColor(NAV_PATH_PAINT_DEFAULTS.text), 1));
    });
    test('respects bag overrides', () => {
        const t = resolveNavPathPaintTheme(
            new SettingsBag({
                navPathShowText: false,
                navPathTextSize: 16,
                navPathColorPath: '#0000ff',
                navPathColorTransport: '#ff00ff',
                navPathColorClick: '#112233',
                navPathColorText: '#abcdef'
            })
        );
        expect(t.showText).toBe(false);
        expect(t.textSize).toBe(16);
        expect(t.walkStroke).toBe(rgba({ r: 0, g: 0, b: 255 }, 0.9));
        expect(t.hopStroke).toBe(rgba({ r: 255, g: 0, b: 255 }, 0.95));
        expect(t.clickStroke).toBe(rgba({ r: 0x11, g: 0x22, b: 0x33 }, 0.95));
        expect(t.textFill).toBe(rgba({ r: 0xab, g: 0xcd, b: 0xef }, 1));
    });
    test('clamps text size', () => {
        expect(resolveNavPathPaintTheme(new SettingsBag({ navPathTextSize: 2 })).textSize).toBe(8);
        expect(resolveNavPathPaintTheme(new SettingsBag({ navPathTextSize: 99 })).textSize).toBe(28);
    });
});

describe('reserved SP slots', () => {
    test('documented for later (not wired to paint)', () => {
        expect(NAV_PATH_PAINT_RESERVED.calculating).toBe('#0000FF');
        expect(NAV_PATH_PAINT_RESERVED.unreachable).toBe('#C828F0');
        expect(NAV_PATH_PAINT_RESERVED.collision).toBe('#0080FF');
    });
});
