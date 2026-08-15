import { describe, expect, test } from 'bun:test';

import doors from '#/bot/event/webwalk/data/doors.json';

const rows = doors as { locId: number }[];

describe('arrav doors are not baked as walkable edges', () => {
    test('the Phoenix hideout door is absent', () => {
        expect(rows.filter(d => d.locId === 2397)).toEqual([]);
    });

    test('the weapon store door is absent', () => {
        expect(rows.filter(d => d.locId === 2398)).toEqual([]);
    });

    test('the Black Arm door is absent', () => {
        expect(rows.filter(d => d.locId === 2399)).toEqual([]);
    });

    test('the ungated street door into the alley is still present', () => {
        expect(rows.filter(d => d.locId === 1530).length).toBeGreaterThan(0);
    });
});
