import { describe, expect, test } from 'bun:test';
import { BANK_LOCATIONS } from '#/bot/api/bank/BankLocations.js';
import Tile from '#/bot/geometry/Tile.js';
import {
    MINING_LOCATIONS,
    MINING_LOCATION_OPTION_LABELS,
    MINING_LOCATION_OPTIONS,
    miningLocationLabel,
    resolveMiningLocation
} from '#/bot/data/miningLocations.js';

const bankTiles = new Set(BANK_LOCATIONS.map(b => `${b.tile.x},${b.tile.z},${b.tile.level}`));

describe('resolveMiningLocation', () => {
    test('None → null', () => {
        expect(resolveMiningLocation('None', new Tile(3181, 3371, 0))).toBeNull();
    });

    test('Auto near SW Varrock mine', () => {
        expect(resolveMiningLocation('Auto', new Tile(3181, 3371, 0))?.name).toBe(
            'Southwest Varrock Mine'
        );
    });

    test('Auto near Barbarian Village prefers Barb over distant mines', () => {
        expect(resolveMiningLocation('Auto', new Tile(3080, 3420, 0))?.name).toBe('Barbarian Village');
    });

    test('Auto snaps at the Wilderness Skeleton Mine', () => {
        expect(resolveMiningLocation('Auto', new Tile(3018, 3590, 0))?.name).toBe(
            'Wilderness Skeleton Mine'
        );
    });

    test('named match is case-insensitive', () => {
        expect(resolveMiningLocation('rimmington mine', new Tile(0, 0, 0))?.name).toBe('Rimmington Mine');
    });

    test('named match for South-east Ardougne Mine', () => {
        const loc = resolveMiningLocation('South-east Ardougne Mine', new Tile(0, 0, 0));
        expect(loc?.name).toBe('South-east Ardougne Mine');
        expect(loc?.bankStand.x).toBe(2655);
        expect(loc?.bankStand.z).toBe(3283);
    });

    test('Auto and named selection resolve the Wilderness Hobgoblin Mine', () => {
        const named = resolveMiningLocation('wilderness hobgoblin mine', new Tile(0, 0, 0));
        expect(named?.name).toBe('Wilderness Hobgoblin Mine');
        expect(named?.spot).toEqual(new Tile(3093, 3751, 0));
        expect(named?.bankStand).toEqual(new Tile(3094, 3493, 0));
        expect(named?.resources).toEqual(['iron', 'coal', 'mithril', 'adamantite']);

        expect(resolveMiningLocation('Auto', new Tile(3088, 3758, 0))?.name).toBe(
            'Wilderness Hobgoblin Mine'
        );
    });

    test('Edgeville Dungeon Mine uses its clear mixed-rock stand and Edgeville bank', () => {
        const loc = resolveMiningLocation('edgeville dungeon mine', new Tile(0, 0, 0));
        expect(loc?.name).toBe('Edgeville Dungeon Mine');
        expect(loc?.spot).toEqual(new Tile(3132, 9874, 0));
        expect(loc?.bankStand).toEqual(new Tile(3094, 3493, 0));
        expect(loc?.resources).toEqual([
            'copper',
            'tin',
            'iron',
            'coal',
            'silver',
            'mithril',
            'adamantite'
        ]);
        expect(loc?.notes).toContain('no Brass key required');
    });

    test('named Wilderness Skeleton Mine selects the verified coal field', () => {
        const loc = resolveMiningLocation('WILDERNESS SKELETON MINE', new Tile(0, 0, 0));
        expect(loc?.name).toBe('Wilderness Skeleton Mine');
        expect(loc?.spot).toEqual(new Tile(3018, 3590, 0));
        expect(loc?.bankStand).toEqual(new Tile(3094, 3493, 0));
        expect(loc?.resources).toEqual(['coal']);
    });
});

describe('MINING_LOCATIONS table', () => {
    test('dropdown is Auto + camps + None', () => {
        expect(MINING_LOCATION_OPTIONS[0]).toBe('Auto');
        expect(MINING_LOCATION_OPTIONS.at(-1)).toBe('None');
        expect(MINING_LOCATION_OPTIONS).toHaveLength(MINING_LOCATIONS.length + 2);
        for (const loc of MINING_LOCATIONS) {
            expect(MINING_LOCATION_OPTIONS).toContain(loc.name);
        }
    });

    test('dropdown camps are alphabetical between Auto and None', () => {
        const camps = MINING_LOCATION_OPTIONS.slice(1, -1);
        expect(camps).toEqual([...camps].sort((a, b) => a.localeCompare(b)));
    });

    test('every bankStand is a known BANK_LOCATIONS tile', () => {
        for (const loc of MINING_LOCATIONS) {
            const key = `${loc.bankStand.x},${loc.bankStand.z},${loc.bankStand.level}`;
            expect(bankTiles.has(key), `${loc.name} bank ${key}`).toBe(true);
        }
    });

    test('core catalog entries are verified; tick-manip camps may be provisional', () => {
        const provisional = new Set([
            'Legends Guild Iron (west)',
            'Legends Guild Iron (east)',
            'South-east Ardougne Mine'
        ]);
        for (const loc of MINING_LOCATIONS) {
            if (provisional.has(loc.name)) {
                expect(loc.verified, loc.name).toBe(false);
            } else {
                expect(loc.verified, loc.name).toBe(true);
            }
        }
    });

    test('has CSV core camps', () => {
        const names = new Set(MINING_LOCATIONS.map(l => l.name));
        for (const n of [
            'Southwest Varrock Mine',
            'Rimmington Mine',
            'Al Kharid Mine',
            'Mining Guild',
            'Lava Maze Runite Mine',
            'Wilderness Hobgoblin Mine',
            'Edgeville Dungeon Mine',
            'Wilderness Skeleton Mine'
        ]) {
            expect(names.has(n), n).toBe(true);
        }
    });

    test('includes Legends Guild iron tick-manip camps (#160)', () => {
        const names = new Set(MINING_LOCATIONS.map(l => l.name));
        expect(names.has('Legends Guild Iron (west)')).toBe(true);
        expect(names.has('Legends Guild Iron (east)')).toBe(true);
    });

    test('recommended combat is 2× highest aggressive NPC + 1', () => {
        const rec = (name: string) => MINING_LOCATIONS.find(l => l.name === name)?.recommendedCombat;
        expect(rec('Al Kharid Mine')).toBe(29); // Scorpion 14
        expect(rec('Coal Trucks')).toBe(55); // Giant bat 27
        expect(rec('Dwarven Mine')).toBe(65); // King Scorpion 32
        expect(rec('Edgeville Dungeon Mine')).toBe(85); // Hobgoblin 42
        expect(rec('Lava Maze Runite Mine')).toBe(69); // Deadly red spider 34
        expect(rec('Wilderness Hobgoblin Mine')).toBe(57); // Hobgoblin 28
        expect(rec('Wilderness Skeleton Mine')).toBe(45); // Skeleton 22
        expect(rec('Desert Mining Camp')).toBe(91); // Guard 45
        // Inside guild — no resident aggro
        expect(rec('Mining Guild')).toBeUndefined();
        expect(rec('Rimmington Mine')).toBeUndefined();
        expect(rec('Southeast Varrock Mine')).toBeUndefined();
    });

    test('option labels keep bare names as values and show combat rec in the UI', () => {
        expect(miningLocationLabel({ name: 'Dwarven Mine', recommendedCombat: 65 })).toBe(
            'Dwarven Mine (65 Combat recommended)'
        );
        expect(MINING_LOCATION_OPTION_LABELS['Dwarven Mine']).toBe('Dwarven Mine (65 Combat recommended)');
        expect(MINING_LOCATION_OPTION_LABELS['Edgeville Dungeon Mine']).toBe(
            'Edgeville Dungeon Mine (85 Combat recommended)'
        );
        // Safe camps are not in the label map (dropdown shows the bare name).
        expect(MINING_LOCATION_OPTION_LABELS['Mining Guild']).toBeUndefined();
        // Persisted options stay bare so resolve still matches.
        expect(MINING_LOCATION_OPTIONS).toContain('Dwarven Mine');
        expect(MINING_LOCATION_OPTIONS.some(o => o.includes('Combat recommended'))).toBe(false);
    });
});
