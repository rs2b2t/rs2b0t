import { describe, expect, test, beforeEach } from 'bun:test';
import { RenderGate } from './RenderGate.js';

describe('RenderGate', () => {
    beforeEach(() => {
        RenderGate.setMode('background');
        RenderGate.backgroundIntervalMs = 300;
        while (RenderGate.boosted) RenderGate.endBoost();
        RenderGate.markDrawn(0);
        RenderGate.drawn = 0;
    });

    test('focused draws every frame', () => {
        RenderGate.setMode('focused');
        expect(RenderGate.shouldDraw(1)).toBe(true);
        RenderGate.markDrawn(1);
        expect(RenderGate.shouldDraw(2)).toBe(true);
    });

    test('hidden never draws', () => {
        RenderGate.setMode('hidden');
        expect(RenderGate.shouldDraw(1000)).toBe(false);
    });

    test('background throttles to the interval', () => {
        RenderGate.setMode('background');
        RenderGate.markDrawn(1000);
        expect(RenderGate.shouldDraw(1100)).toBe(false); // 100ms < 300ms
        expect(RenderGate.shouldDraw(1300)).toBe(true);  // 300ms elapsed
    });

    test('boost overrides hidden', () => {
        RenderGate.setMode('hidden');
        RenderGate.beginBoost();
        expect(RenderGate.shouldDraw(1)).toBe(true);
        RenderGate.endBoost();
        expect(RenderGate.shouldDraw(1)).toBe(false);
    });

    test('boost is ref-counted', () => {
        RenderGate.beginBoost();
        RenderGate.beginBoost();
        RenderGate.endBoost();
        expect(RenderGate.boosted).toBe(true);
        RenderGate.endBoost();
        expect(RenderGate.boosted).toBe(false);
    });

    test('markDrawn advances the counter', () => {
        RenderGate.markDrawn(5);
        RenderGate.markDrawn(6);
        expect(RenderGate.drawn).toBe(2);
    });
});
