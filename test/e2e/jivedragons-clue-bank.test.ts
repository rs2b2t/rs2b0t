import { expect, test } from 'bun:test';
import { assessClueBank } from '../../e2e/jivedragons-clue-bank-contract.js';

const sample = { at: 0, kind: 'tick', tile: { x: 2901, z: 9809 }, bankOpen: false, clueHeld: true, hides: 1, bankHides: 0, solver: null };
const good = [sample, { ...sample, at: 1, tile: { x: 2965, z: 3380 } },
    { ...sample, at: 2, tile: { x: 2946, z: 3369 }, bankOpen: true },
    { ...sample, at: 3, tile: { x: 2946, z: 3369 }, bankOpen: true, hides: 0, bankHides: 1 },
    { ...sample, at: 4, tile: { x: 2950, z: 3345 }, solver: { clueId: 2693, target: { x: 2976, z: 3343 } } },
    { ...sample, at: 5, tile: { x: 2956, z: 3345 }, solver: { clueId: 2693, target: { x: 2976, z: 3343 } } }];
test('accepts dungeon egress then Falador deposit with clue held then actual solver movement', () => {
    expect(assessClueBank(good).passed).toBe(true);
});
test('rejects default Edgeville banking', () => {
    expect(assessClueBank(good.map(e => e.bankOpen ? { ...e, tile: { x: 3094, z: 3493 } } : e)).passed).toBe(false);
});
test('rejects solver starting before successful bank preparation', () => {
    expect(assessClueBank([{ ...sample, solver: { clueId: 2693, target: null } }, ...good]).violations).toContain('solver-before-bank');
});
test('rejects depositing the clue or missing actual loot deposit', () => {
    expect(assessClueBank(good.map(e => e.bankOpen ? { ...e, clueHeld: false } : e)).passed).toBe(false);
    expect(assessClueBank(good.map(e => ({ ...e, bankHides: 0 }))).passed).toBe(false);
});
test('rejects an underground walk directly to a surface bank', () => {
    expect(assessClueBank([{ ...sample, kind: 'walk-request', goal: { x: 3094, z: 3493 } }, ...good]).violations).toContain('underground-surface-walk');
});
test('rejects requesting bank access before egress even if it opens later', () => {
    expect(assessClueBank([{ ...sample, kind: 'bank-request' }, ...good]).violations).toContain('bank-request-before-preferred-arrival');
});
