import { describe, expect, test } from 'bun:test';
import Tile from '#/bot/api/Tile.js';
import {
    boothFields,
    locationOptions,
    resolveGatheringLocation,
    type GatheringLocation
} from '#/bot/scripts/GatheringLocations.js';

const TABLE: GatheringLocation[] = [
    {
        name: 'Near',
        spot: new Tile(3100, 3200, 0),
        bankStand: new Tile(3093, 3243, 0),
        verified: true
    },
    {
        name: 'Far',
        spot: new Tile(3200, 3300, 0),
        bankStand: new Tile(3253, 3420, 0),
        verified: false
    },
    {
        name: 'Upstairs',
        spot: new Tile(3100, 3200, 1),
        bankStand: new Tile(3093, 3243, 1),
        verified: false
    }
];

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

    test('Auto picks Euclidean-nearest spot on the same level', () => {
        // Closer to Far in Euclidean distance than Near.
        expect(resolveGatheringLocation('Auto', new Tile(3190, 3290, 0), TABLE)?.name).toBe('Far');
        expect(resolveGatheringLocation('Auto', new Tile(3101, 3201, 0), TABLE)?.name).toBe('Near');
    });

    test('Auto prefers same level even if other level is closer in xz', () => {
        expect(resolveGatheringLocation('Auto', new Tile(3100, 3200, 1), TABLE)?.name).toBe('Upstairs');
    });

    test('Auto falls back across levels when none share the start level', () => {
        const onlyGround: GatheringLocation[] = [TABLE[0]!, TABLE[1]!];
        expect(resolveGatheringLocation('Auto', new Tile(3100, 3200, 2), onlyGround)?.name).toBe('Near');
    });
});

describe('locationOptions / boothFields', () => {
    test('options are Auto + names + None', () => {
        expect(locationOptions(TABLE)).toEqual(['Auto', 'Near', 'Far', 'Upstairs', 'None']);
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
