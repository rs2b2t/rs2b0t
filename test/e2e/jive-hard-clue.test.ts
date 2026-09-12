import { expect, test } from 'bun:test';
import { assessHardClue, type HardClueCapture, type HardClueSample } from '../../e2e/jive-hard-clue-contract.js';

const prepared: HardClueSample = { at: 0, phase: 'prepared', clueHeld: true, hp: 80, sharks: 15,
    weaponId: 1231, special: 100, antipoisonDoses: 4, guardianLife: null };
const good: HardClueCapture = {
    guardianName: 'Saradomin Wizard',
    prep: { bankConfirmed: true, attack: 60, lostCity: true, daggerId: 1231, antipoisonId: 2448,
        sharksAvailable: 15, hostWeaponId: 861 },
    samples: [prepared,
        { ...prepared, at: 1, phase: 'dig', antipoisonDoses: 3 },
        { ...prepared, at: 2, phase: 'spawn', antipoisonDoses: 3, guardianLife: 'wizard:1' },
        { ...prepared, at: 3, phase: 'fight', antipoisonDoses: 3, guardianLife: 'wizard:1', hp: 40, special: 75 },
        { ...prepared, at: 4, phase: 'fight', antipoisonDoses: 3, guardianLife: 'wizard:1', hp: 60, special: 75, sharks: 14 },
        { ...prepared, at: 5, phase: 'kill', antipoisonDoses: 3, guardianLife: 'wizard:1', sharks: 14 },
        { ...prepared, at: 6, phase: 'post-kill-dig', sharks: 14 },
        { ...prepared, at: 7, phase: 'restored', sharks: 14, clueHeld: false, weaponId: 861 }]
};

test('accepts survival and post-kill dig when the encounter starts with15 Sharks then eats below15', () => {
    const result = assessHardClue(good);
    expect(result.passed).toBe(true);
});
for (const daggerId of [1215, 1231]) for (const [antipoisonId, doses] of [[2448, 4], [181, 3], [183, 2], [185, 1]]) {
    test(`accepts usable dagger${daggerId} and Superantipoison${antipoisonId} when prerequisites hold`, () => {
        const capture = { ...good, prep: { ...good.prep, daggerId, antipoisonId },
            samples: good.samples.map(s => ({ ...s, antipoisonDoses: s.at === 0 ? doses : doses - 1,
                weaponId: s.phase === 'restored' ? 861 : daggerId })) };
        const result = assessHardClue(capture);
        expect(result.passed).toBe(true);
    });
}
for (const prep of [
    { ...good.prep, bankConfirmed: false }, { ...good.prep, daggerId: null },
    { ...good.prep, daggerId: 1205 }, { ...good.prep, antipoisonId: null },
    { ...good.prep, antipoisonId: 175 }, { ...good.prep, attack: 59 },
    { ...good.prep, lostCity: false }, { ...good.prep, sharksAvailable: 14 }
]) test(`retains the clue without digging when preparation is blocked: ${JSON.stringify(prep)}`, () => {
    const capture: HardClueCapture = { ...good, prep, samples: [{ ...prepared, phase: 'blocked' }] };
    const result = assessHardClue(capture);
    expect(result).toMatchObject({ passed: true, outcome: 'blocked' });
});
test('rejects guardian spawn when bank supplies were not confirmed', () => {
    const result = assessHardClue({ ...good, prep: { ...good.prep, bankConfirmed: false } });
    expect(result.passed).toBe(false);
});
test('rejects clue loss when preparation is blocked', () => {
    const result = assessHardClue({ ...good, prep: { ...good.prep, sharksAvailable: 14 },
        samples: [{ ...prepared, phase: 'blocked', clueHeld: false }] });
    expect(result.passed).toBe(false);
});
test('rejects a14 Shark starting inventory even when bank stock exists', () => {
    const result = assessHardClue({ ...good, samples: good.samples.map(s => s.phase === 'prepared' ? { ...s, sharks: 14 } : s) });
    expect(result.passed).toBe(false);
});
test('requires the20 Shark target when confirmed stock permits it', () => {
    const result = assessHardClue({ ...good, prep: { ...good.prep, sharksAvailable: 20 } });
    expect(result.passed).toBe(false);
});
test('accepts the20 Shark target when confirmed stock permits it', () => {
    const result = assessHardClue({ ...good, prep: { ...good.prep, sharksAvailable: 30 },
        samples: good.samples.map(s => ({ ...s, sharks: s.sharks + 5 })) });
    expect(result.passed).toBe(true);
});
for (const phase of ['dig', 'spawn', 'kill', 'post-kill-dig', 'restored'] as const) {
    test(`rejects incomplete evidence when ${phase} is absent`, () => {
        const result = assessHardClue({ ...good, samples: good.samples.filter(s => s.phase !== phase) });
        expect(result.passed).toBe(false);
    });
}
for (const [name, samples] of [
    ['no special spent', good.samples.map(s => ({ ...s, special: 100 }))],
    ['late antidote', good.samples.map(s => s.at <= 2 ? { ...s, antipoisonDoses: 4 } : s)],
    ['wrong fight weapon', good.samples.map(s => s.phase === 'fight' ? { ...s, weaponId: 861 } : s)],
    ['no Shark upkeep', good.samples.map(s => ({ ...s, sharks: 15 }))],
    ['death', good.samples.map(s => s.at === 4 ? { ...s, hp: 0 } : s)],
    ['wrong restored weapon', good.samples.map(s => s.phase === 'restored' ? { ...s, weaponId: 1231 } : s)],
    ['different guardian death', good.samples.map(s => s.phase === 'kill' ? { ...s, guardianLife: 'wizard:2' } : s)],
    ['dig before kill', good.samples.map(s => s.phase === 'post-kill-dig' ? { ...s, at: 4.5 } : s)]
] as const) test(`rejects incomplete encounter proof when ${name}`, () => {
    const result = assessHardClue({ ...good, samples });
    expect(result.passed).toBe(false);
});
test('rejects empty evidence rather than inferring a blocked encounter', () => {
    const result = assessHardClue({ ...good, samples: [] });
    expect(result.passed).toBe(false);
});
test('rejects a different guardian rather than claiming Saradomin Wizard proof', () => {
    const result = assessHardClue({ ...good, guardianName: 'Zamorak Wizard' });
    expect(result.passed).toBe(false);
});
