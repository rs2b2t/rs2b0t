import { describe, expect, test } from 'bun:test';
import { isOpenableBarrier } from '#/bot/nav/WalkExecutor.js';

// The pure loc filter behind the stall opener. A barrier is a loc whose NAME
// reads as a door/gate AND that offers an Open-style op — i.e. a shut passage we
// can walk through. The name gate is load-bearing: the live wardrobe incident
// had the opener click a 'Wardrobe' (also op 'Open') next to a stalled bot.
describe('isOpenableBarrier', () => {
    test("a shut Door offering 'Open' is a barrier", () => {
        expect(isOpenableBarrier('Door', ['Open'])).toBe(true);
    });

    test("a Gate offering 'Open-quietly' is a barrier (Open-prefix, not literal 'Open')", () => {
        expect(isOpenableBarrier('Gate', ['Open-quietly'])).toBe(true);
    });

    test("a Wardrobe offering 'Open' is NOT a barrier (name filter — the wardrobe incident)", () => {
        expect(isOpenableBarrier('Wardrobe', ['Open'])).toBe(false);
    });

    test("an already-open Door (offers 'Close', not 'Open') is not a barrier", () => {
        expect(isOpenableBarrier('Door', ['Close'])).toBe(false);
    });

    test('a null name is never a barrier', () => {
        expect(isOpenableBarrier(null, ['Open'])).toBe(false);
    });

    // Case-insensitive name match — loc names arrive in varying case.
    test('name match is case-insensitive', () => {
        expect(isOpenableBarrier('Large door', ['Open'])).toBe(true);
        expect(isOpenableBarrier('WOODEN GATE', ['Open'])).toBe(true);
    });

    // LocSnapshot.ops is (string | null)[]; nulls (empty op slots) must not throw
    // and must not count as an Open op.
    test('tolerates null op slots in the ops array', () => {
        expect(isOpenableBarrier('Door', [null, 'Open'])).toBe(true);
        expect(isOpenableBarrier('Door', [null, 'Close'])).toBe(false);
        expect(isOpenableBarrier('Door', [])).toBe(false);
    });
});
