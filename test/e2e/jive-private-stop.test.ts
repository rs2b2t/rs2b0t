import { expect, test } from 'bun:test';
import * as live from '../../e2e/jive-private-live.js';

test.each([
    { kind: 'solver-end', status: 'abandoned', hp: 77, expected: true },
    { kind: 'solver-end', status: 'guardian-lost', hp: 77, expected: true },
    { kind: 'solver-end', status: 'dead', hp: 77, expected: true },
    { kind: 'tick', status: 'solving', hp: 0, expected: true },
    { kind: 'tick', status: 'reward blocked: no bank', hp: 77, expected: true },
    { kind: 'solver-end', status: 'hard kit: dds', hp: 77, expected: false },
    { kind: 'solver-end', status: 'solving', hp: 77, expected: false },
    { kind: 'tick', status: 'abandoned', hp: 77, expected: false },
    { kind: 'tick', status: 'guardian-lost', hp: 77, expected: false },
    { kind: 'tick', status: 'dead', hp: 77, expected: false },
    { kind: 'solver-start', status: 'guardian-lost', hp: 77, expected: false },
    { kind: 'solver-end', status: 'yield', hp: 77, expected: false },
    { kind: 'solver-end', status: 'event-yield', hp: 77, expected: false },
])('stops only on an observed failure %#', ({ kind, status, hp, expected }) => {
    expect(live.privateRunFailed([{ kind, status, hp }])).toBe(expected);
});
