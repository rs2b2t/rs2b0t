import { describe, expect, test } from 'bun:test';
import { shouldPaintOverlay } from '#/bot/panel/Overlay.js';

describe('overlay idle policy', () => {
    test('idle client (no path, no script) skips paint', () => {
        expect(
            shouldPaintOverlay({ pathEnabled: false, pathTiles: 0, scriptPaintReady: false, hasOnPaint: true, loginQueued: false })
        ).toBe(false);
    });

    test('running script with onPaint paints', () => {
        expect(
            shouldPaintOverlay({ pathEnabled: false, pathTiles: 0, scriptPaintReady: true, hasOnPaint: true, loginQueued: false })
        ).toBe(true);
    });

    test('script startup with onPaint stays idle until its baseline is ready', () => {
        expect(
            shouldPaintOverlay({ pathEnabled: false, pathTiles: 0, scriptPaintReady: false, hasOnPaint: true, loginQueued: false })
        ).toBe(false);
    });

    test('nav path labels paint even without a script', () => {
        expect(
            shouldPaintOverlay({ pathEnabled: true, pathTiles: 12, scriptPaintReady: false, hasOnPaint: false, loginQueued: false })
        ).toBe(true);
    });

    test('path enabled but empty store does not paint labels', () => {
        expect(
            shouldPaintOverlay({ pathEnabled: true, pathTiles: 0, scriptPaintReady: false, hasOnPaint: false, loginQueued: false })
        ).toBe(false);
    });

    test('queued auto-login paints without a nav path or ready script', () => {
        expect(
            shouldPaintOverlay({ pathEnabled: false, pathTiles: 0, scriptPaintReady: false, hasOnPaint: false, loginQueued: true })
        ).toBe(true);
    });
});
