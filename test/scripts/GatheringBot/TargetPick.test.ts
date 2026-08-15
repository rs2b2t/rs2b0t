import { describe, expect, test } from 'bun:test';
import {
    LOCAL_MINE_PREFER_RADIUS,
    pickNearestPreferLocal,
    shouldCooldownGatherTile
} from '#/bot/scripts/GatheringBot/TargetPick.js';

describe('pickNearestPreferLocal', () => {
    const rock = (id: string, dist: number) => ({ id, dist });

    test('prefers local cluster when any rock is within prefer radius', () => {
        const near = rock('near', 3);
        const far = rock('far', 28);
        expect(LOCAL_MINE_PREFER_RADIUS).toBe(12);
        expect(pickNearestPreferLocal([far, near], r => r.dist)?.id).toBe('near');
        expect(pickNearestPreferLocal([far], r => r.dist)?.id).toBe('far');
    });

    test('among local rocks picks the closest', () => {
        const a = rock('a', 5);
        const b = rock('b', 2);
        const far = rock('far', 40);
        expect(pickNearestPreferLocal([a, far, b], r => r.dist)?.id).toBe('b');
    });

    test('empty candidates → null', () => {
        expect(pickNearestPreferLocal([], () => 0)).toBe(null);
    });
});

describe('shouldCooldownGatherTile', () => {
    test('does not cooldown after a successful ore/log', () => {
        expect(shouldCooldownGatherTile(true, true)).toBe(false);
        expect(shouldCooldownGatherTile(true, false)).toBe(false);
    });

    test('cools only failed clicks when other targets exist', () => {
        expect(shouldCooldownGatherTile(false, true)).toBe(true);
        expect(shouldCooldownGatherTile(false, false)).toBe(false);
    });
});
