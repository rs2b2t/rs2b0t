import { describe, expect, test } from 'bun:test';
import { privateScenario, assertPrivateEnvironment } from '../../e2e/jive-private-config.js';
import { assessReward } from '../../e2e/jive-reward-contract.js';

describe('private scenario authoring (synthetic, not runtime evidence)', () => {
    test.each(['missing-dds', 'missing-superanti', 'sharks14', 'guardian', 'reward'] as const)('seeds an undefeated final leg for %s', name => {
        const fixture = privateScenario(name);
        expect(fixture.trailStatus & 15).toBe(5);
        expect(fixture.trailStatus & 16).toBe(0);
    });
    test('isolates missing DDS while retaining the other supplies', () => {
        const fixture = privateScenario('missing-dds');
        expect(fixture.dds).toBe(false);
        expect(fixture.superanti).toBe(true);
        expect(fixture.sharks).toBe(20);
    });
    test('isolates missing Superanti while retaining DDS', () => {
        const fixture = privateScenario('missing-superanti');
        expect(fixture.dds).toBe(true);
        expect(fixture.superanti).toBe(false);
    });
    test('limits the entire Shark supply to fourteen', () => {
        const fixture = privateScenario('sharks14');
        expect(fixture.sharks).toBe(14);
        expect(fixture.bankSharks).toBe(0);
    });
    test('uses the requested guardian combat profile', () => {
        const fixture = privateScenario('guardian');
        expect(fixture.levels).toMatchObject({ attack: 75, strength: 75, defence: 75, hitpoints: 77, prayer: 70 });
    });
    test('uses the authentic dry Saradomin coordinate clue only for guardian', () => {
        expect(privateScenario('guardian')).toMatchObject({ clueId: 3548, casketId: 3549,
            clue: 'trail_clue_hard_sextant025', dig: { x: 2581, z: 3030, level: 0 },
            bank: { x: 2946, z: 3369, level: 0 }, sharks: 15, bankSharks: 0, trailStatus: 133 });
        for (const scenario of ['missing-dds', 'missing-superanti', 'sharks14', 'reward'] as const) {
            expect(privateScenario(scenario)).toMatchObject({ clueId: 3544, casketId: 3545,
                clue: 'trail_clue_hard_sextant023', dig: { x: 3441, z: 3419, level: 0 } });
        }
    });
    test('collects a full-pack casket without any guardian prerequisites', () => {
        const fixture = privateScenario('reward');
        expect([fixture.dds, fixture.superanti, fixture.lostCity]).toEqual([false, false, false]);
        expect(fixture.levels.attack).toBe(1);
        expect(fixture.sharks).toBe(27);
        expect(fixture.casketOnly).toBe(true);
    });
    test('rejects runtime without authorization before inspecting files or connecting', () => {
        expect(() => assertPrivateEnvironment({})).toThrow();
    });
    test('rejects shared server even when authorized', () => {
        expect(() => assertPrivateEnvironment({ RUNTIME_AUTHORIZED: '1', BASE: 'http://localhost:8890' })).toThrow();
    });
    test('rejects solved before all reward quantities even without movement', () => {
        const capture = { manifest: { interfaceId: 6963, modalId: 6960, items: [{ id: 145, count: 9 }] }, before: [], requireFullHpSpace: false,
            samples: [{ at: 1, holdings: [{ id: 145, count: 1 }], hp: 77, maxHp: 77, sharks: 27, used: 28, left: false, solved: true },
                { at: 2, holdings: [{ id: 145, count: 9 }], hp: 77, maxHp: 77, sharks: 19, used: 28, left: false }] };
        expect(assessReward(capture).violations).toContain('solved-before-accounted');
    });
});
