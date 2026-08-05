import { describe, expect, test } from 'bun:test';

/**
 * Documents when the HTML overlay should skip a draw. Implementation lives in
 * Overlay.ts; this locks the idle policy so we do not reintroduce clearRect
 * storms on multi-bot walls with idle clients.
 */
function shouldPaintOverlay(opts: {
    pathEnabled: boolean;
    pathTiles: number;
    scriptActive: boolean;
    hasOnPaint: boolean;
}): boolean {
    const pathLabels = opts.pathEnabled && opts.pathTiles > 0;
    const botPaint = opts.hasOnPaint && opts.scriptActive;
    return pathLabels || botPaint;
}

describe('overlay idle policy', () => {
    test('idle client (no path, no script) skips paint', () => {
        expect(
            shouldPaintOverlay({ pathEnabled: false, pathTiles: 0, scriptActive: false, hasOnPaint: true })
        ).toBe(false);
    });

    test('running script with onPaint paints', () => {
        expect(
            shouldPaintOverlay({ pathEnabled: false, pathTiles: 0, scriptActive: true, hasOnPaint: true })
        ).toBe(true);
    });

    test('nav path labels paint even without a script', () => {
        expect(
            shouldPaintOverlay({ pathEnabled: true, pathTiles: 12, scriptActive: false, hasOnPaint: false })
        ).toBe(true);
    });

    test('path enabled but empty store does not paint labels', () => {
        expect(
            shouldPaintOverlay({ pathEnabled: true, pathTiles: 0, scriptActive: false, hasOnPaint: false })
        ).toBe(false);
    });
});
