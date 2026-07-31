import { describe, expect, test } from 'bun:test';
import Tile from '#/bot/api/Tile.js';
import {
    boothFields,
    locationOptions,
    MAP_SQUARE,
    resolveGatheringLocation,
    sameMapSquare,
    type GatheringLocation
} from '#/bot/api/GatheringLocations.js';

const TABLE: GatheringLocation[] = [
    {
        name: 'Near',
        // map square floor(3100/64)=48, floor(3200/64)=50
        spot: new Tile(3100, 3200, 0),
        bankStand: new Tile(3093, 3243, 0),
        verified: true
    },
    {
        name: 'Far',
        // map square floor(3200/64)=50, floor(3300/64)=51
        spot: new Tile(3200, 3300, 0),
        bankStand: new Tile(3253, 3420, 0),
        verified: false
    },
    {
        name: 'Upstairs',
        spot: new Tile(3100, 3200, 1),
        bankStand: new Tile(3093, 3243, 1),
        verified: false
    },
    {
        name: 'NearSibling',
        // Same 64×64 as Near, slightly farther from 3101,3201
        spot: new Tile(3110, 3210, 0),
        bankStand: new Tile(3093, 3243, 0),
        verified: true
    }
];

describe('sameMapSquare', () => {
    test('same chunk + level', () => {
        expect(sameMapSquare(new Tile(3100, 3200, 0), new Tile(3101, 3201, 0))).toBe(true);
        expect(sameMapSquare(new Tile(3100, 3200, 0), new Tile(3200, 3300, 0))).toBe(false);
        expect(sameMapSquare(new Tile(3100, 3200, 0), new Tile(3100, 3200, 1))).toBe(false);
    });

    test('MAP_SQUARE is 64', () => {
        expect(MAP_SQUARE).toBe(64);
    });
});

describe('resolveGatheringLocation', () => {
    test('None / blank → null (power mode)', () => {
        expect(resolveGatheringLocation('None', new Tile(3100, 3200, 0), TABLE)).toBeNull();
        expect(resolveGatheringLocation('  ', new Tile(3100, 3200, 0), TABLE)).toBeNull();
    });

    test('named match is case-insensitive', () => {
        expect(resolveGatheringLocation('near', new Tile(0, 0, 0), TABLE)?.name).toBe('Near');
        expect(resolveGatheringLocation('FAR', new Tile(0, 0, 0), TABLE)?.name).toBe('Far');
    });

    test('unknown name → null', () => {
        expect(resolveGatheringLocation('Atlantis', new Tile(3100, 3200, 0), TABLE)).toBeNull();
    });

    test('Auto snaps only when start shares a preset map square', () => {
        // Inside Near's chunk → Near (closer than NearSibling).
        expect(resolveGatheringLocation('Auto', new Tile(3101, 3201, 0), TABLE)?.name).toBe('Near');
        // Inside Far's chunk (3200,3300 → mx50,mz51); 3205,3305 shares it.
        expect(resolveGatheringLocation('Auto', new Tile(3205, 3305, 0), TABLE)?.name).toBe('Far');
    });

    test('Auto freeform when outside every preset chunk', () => {
        // Between Near (48,50) and Far (50,51) — different square.
        expect(resolveGatheringLocation('Auto', new Tile(3150, 3250, 0), TABLE)).toBeNull();
        // Lumbridge-ish far from both.
        expect(resolveGatheringLocation('Auto', new Tile(3222, 3218, 0), TABLE)).toBeNull();
    });

    test('Auto prefers same level even if other level is closer in xz', () => {
        expect(resolveGatheringLocation('Auto', new Tile(3100, 3200, 1), TABLE)?.name).toBe('Upstairs');
    });

    test('Auto does not fall back across levels when none share the start level', () => {
        // Ground-only table: start on level 2 → freeform null (no same-chunk match).
        const onlyGround: GatheringLocation[] = [TABLE[0]!, TABLE[1]!];
        expect(resolveGatheringLocation('Auto', new Tile(3100, 3200, 2), onlyGround)).toBeNull();
    });

    test('Auto picks nearest among multiple same-chunk camps', () => {
        // NearSibling is farther from 3101,3201 than Near.
        expect(resolveGatheringLocation('Auto', new Tile(3101, 3201, 0), TABLE)?.name).toBe('Near');
        // Closer to NearSibling within the same chunk.
        expect(resolveGatheringLocation('Auto', new Tile(3112, 3212, 0), TABLE)?.name).toBe(
            'NearSibling'
        );
    });
});

describe('locationOptions / boothFields', () => {
    test('options are Auto + names + None', () => {
        expect(locationOptions(TABLE)).toEqual([
            'Auto',
            'Near',
            'Far',
            'Upstairs',
            'NearSibling',
            'None'
        ]);
    });

    test('boothFields default when location missing booth overrides', () => {
        expect(boothFields(null)).toEqual({ boothName: 'Bank booth', boothOp: 'Use-quickly' });
        expect(boothFields(TABLE[0])).toEqual({ boothName: 'Bank booth', boothOp: 'Use-quickly' });
        expect(
            boothFields({
                ...TABLE[0]!,
                boothName: 'Bank chest',
                boothOp: 'Use'
            })
        ).toEqual({ boothName: 'Bank chest', boothOp: 'Use' });
    });
});
