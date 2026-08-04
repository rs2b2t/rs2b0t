import { describe, expect, test } from 'bun:test';

import { combatShowingThreshold } from '#/bot/adapter/ClientAdapter.js';

// Client stamps combatCycle at loopCycle + 400, so a target reads as fighting while
// (400 - threshold) cycles remain. That has to stay the same wall-clock span whatever
// rate the client's logic loop runs at.
const STAMP_CYCLES = 400;
const ERA_DELTIME_MS = 20;
const ERA_WINDOW_MS = 6000;

const windowMs = (deltime: number): number => (STAMP_CYCLES - combatShowingThreshold(deltime)) * deltime;

describe('combat window is independent of the client logic rate', () => {
    test('matches the era client exactly at its 20ms tick', () => {
        expect(combatShowingThreshold(ERA_DELTIME_MS)).toBe(100);
        expect(windowMs(ERA_DELTIME_MS)).toBe(ERA_WINDOW_MS);
    });

    test('a slower bot loop keeps the same 6s window', () => {
        for (const deltime of [25, 40, 50, 100]) {
            expect(windowMs(deltime)).toBeCloseTo(ERA_WINDOW_MS, 6);
        }
    });

    test('the naive cycle-count threshold would have stretched the window', () => {
        // what a fixed 100-cycle threshold does once the loop slows to 50ms
        const naive = (STAMP_CYCLES - 100) * 50;
        expect(naive).toBe(15000);
        expect(windowMs(50)).toBe(ERA_WINDOW_MS);
    });
});
