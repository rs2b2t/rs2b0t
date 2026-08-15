import { describe, expect, test } from 'bun:test';

import { supplierPhase, type SupplierPhase, type SupplierState } from '#/bot/scripts/ArravSupplier/ArravSupplierLogic.js';

function state(over: Partial<SupplierState> = {}): SupplierState {
    return {
        inBlackArm: false,
        inPhoenix: false,
        hasKey: false,
        hasReport: false,
        crossbows: 0,
        phoenixHalf: 0,
        blackarmHalf: 0,
        certsBanked: 0,
        certTarget: 10,
        ...over
    };
}

const dual = (over: Partial<SupplierState> = {}) => state({ inBlackArm: true, inPhoenix: true, ...over });

describe('arrav supplier phases', () => {
    test('without a key it waits for one rather than walking at a locked door', () => {
        expect(supplierPhase(state())).toBe('await-key');
    });

    test('with a key and no crossbows it raids the store', () => {
        expect(supplierPhase(state({ hasKey: true }))).toBe('raid-store');
    });

    test('one crossbow is not two', () => {
        expect(supplierPhase(state({ hasKey: true, crossbows: 1 }))).toBe('raid-store');
    });

    test('two crossbows go to Katrine', () => {
        expect(supplierPhase(state({ hasKey: true, crossbows: 2 }))).toBe('join-blackarm');
    });

    test('a black arm member with no report kills Jonny', () => {
        expect(supplierPhase(state({ inBlackArm: true }))).toBe('kill-jonny');
    });

    test('a black arm member holding the report uses it on Straven', () => {
        expect(supplierPhase(state({ inBlackArm: true, hasReport: true }))).toBe('join-phoenix');
    });

    test('a dual-gang supplier below target farms the phoenix half first', () => {
        expect(supplierPhase(dual())).toBe('take-phoenix-half');
    });

    test('holding the phoenix half it farms the black arm half', () => {
        expect(supplierPhase(dual({ phoenixHalf: 1 }))).toBe('take-blackarm-half');
    });

    test('holding both halves it mints', () => {
        expect(supplierPhase(dual({ phoenixHalf: 1, blackarmHalf: 1 }))).toBe('mint');
    });

    test('at target it stops, even holding both halves', () => {
        expect(supplierPhase(dual({ certsBanked: 10, certTarget: 10, phoenixHalf: 1, blackarmHalf: 1 }))).toBe('done');
    });

    test('past target it stays done', () => {
        expect(supplierPhase(dual({ certsBanked: 24, certTarget: 10 }))).toBe('done');
    });

    test('it never reaches a redeem phase, at any stock level', () => {
        const phases = new Set<SupplierPhase>();
        for (const certsBanked of [0, 1, 5, 9, 10, 20]) {
            for (const phoenixHalf of [0, 1]) {
                for (const blackarmHalf of [0, 1]) {
                    phases.add(supplierPhase(dual({ certsBanked, phoenixHalf, blackarmHalf })));
                }
            }
        }
        expect([...phases].sort()).toEqual(['done', 'mint', 'take-blackarm-half', 'take-phoenix-half']);
    });

    test('the bootstrap runs in one order and never skips a gang', () => {
        const seen: SupplierPhase[] = [];
        let s = state({ certTarget: 2 });
        seen.push(supplierPhase(s));
        s = { ...s, hasKey: true };
        seen.push(supplierPhase(s));
        s = { ...s, crossbows: 2 };
        seen.push(supplierPhase(s));
        s = { ...s, inBlackArm: true, crossbows: 0 };
        seen.push(supplierPhase(s));
        s = { ...s, hasReport: true };
        seen.push(supplierPhase(s));
        s = { ...s, inPhoenix: true, hasReport: false };
        seen.push(supplierPhase(s));
        expect(seen).toEqual([
            'await-key', 'raid-store', 'join-blackarm', 'kill-jonny', 'join-phoenix', 'take-phoenix-half'
        ]);
    });
});
