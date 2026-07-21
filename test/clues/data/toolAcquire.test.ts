import { expect, test, describe } from 'bun:test';

import { nextCoordTool, SPADE_SPAWNS, SPADE_NAME, TRIO, PROFESSOR, MURPHY, KOJO } from '#/bot/clues/data/toolAcquire.js';

describe('nextCoordTool (item-keyed chain order)', () => {
    test('nothing held -> sextant first', () => {
        expect(nextCoordTool({ sextant: false, watch: false, chart: false })).toBe('sextant');
    });
    test('sextant held, no watch -> watch', () => {
        expect(nextCoordTool({ sextant: true, watch: false, chart: false })).toBe('watch');
    });
    test('sextant+watch held, no chart -> chart', () => {
        expect(nextCoordTool({ sextant: true, watch: true, chart: false })).toBe('chart');
    });
    test('all three held -> null (done)', () => {
        expect(nextCoordTool({ sextant: true, watch: true, chart: true })).toBe(null);
    });
    test('strict order: a held watch without a sextant still asks for the sextant first', () => {
        // the server chain is strictly ordered — you cannot get a watch before a sextant
        expect(nextCoordTool({ sextant: false, watch: true, chart: false })).toBe('sextant');
    });
});

describe('data sanity', () => {
    test('two spade spawns, Ardougne and Falador, far apart', () => {
        expect(SPADE_SPAWNS.length).toBe(2);
        expect(SPADE_SPAWNS[0].distanceTo(SPADE_SPAWNS[1])).toBeGreaterThan(300);
    });
    test('trio + spade names', () => {
        expect(TRIO).toEqual(['Sextant', 'Watch', 'Chart']);
        expect(SPADE_NAME).toBe('Spade');
    });
    test('three NPC stops with distinct anchors and a Treasure-Trails preference', () => {
        const anchors = [PROFESSOR, MURPHY, KOJO].map(s => `${s.anchor.x},${s.anchor.z}`);
        expect(new Set(anchors).size).toBe(3);
        expect(PROFESSOR.prefer.join(' ').toLowerCase()).toContain('treasure');
    });
});
