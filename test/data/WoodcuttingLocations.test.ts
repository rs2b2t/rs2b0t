import { describe, expect, test } from 'bun:test';
import { BANK_LOCATIONS } from '#/bot/api/bank/BankLocations.js';
import Tile from '#/bot/geometry/Tile.js';
import {
    WOODCUTTING_LOCATIONS,
    WOODCUTTING_LOCATION_OPTIONS,
    resolveWoodcuttingLocation,
    ENT_NPC_IDS,
    ENT_LIFE_TICKS,
    isEntNpcId,
    entNpcOnTile
} from '#/bot/data/woodcuttingLocations.js';

const bankTiles = new Set(BANK_LOCATIONS.map(b => `${b.tile.x},${b.tile.z},${b.tile.level}`));

describe('resolveWoodcuttingLocation', () => {
    test('None → null', () => {
        expect(resolveWoodcuttingLocation('None', new Tile(3087, 3234, 0))).toBeNull();
    });

    test('Auto near Draynor willows', () => {
        expect(resolveWoodcuttingLocation('Auto', new Tile(3087, 3234, 0))?.name).toBe(
            'Draynor Willows'
        );
    });

    test('Auto near Seers maples', () => {
        expect(resolveWoodcuttingLocation('Auto', new Tile(2728, 3501, 0))?.name).toBe('Seers Maples');
    });

    test('Auto freeform at willows NW of Crafting Guild (outside every WC camp chunk)', () => {
        // 2910,3328, not same 64×64 as Crafting Guild mine or any WC preset.
        expect(resolveWoodcuttingLocation('Auto', new Tile(2910, 3328, 0))).toBeNull();
    });

    test('named match is case-insensitive', () => {
        expect(resolveWoodcuttingLocation('edgeville yews', new Tile(0, 0, 0))?.name).toBe(
            'Edgeville Yews'
        );
    });
});

describe('WOODCUTTING_LOCATIONS table', () => {
    test('dropdown is Auto + camps + None', () => {
        expect(WOODCUTTING_LOCATION_OPTIONS).toEqual([
            'Auto',
            ...WOODCUTTING_LOCATIONS.map(l => l.name),
            'None'
        ]);
    });

    test('every bankStand is a known BANK_LOCATIONS tile', () => {
        for (const loc of WOODCUTTING_LOCATIONS) {
            const key = `${loc.bankStand.x},${loc.bankStand.z},${loc.bankStand.level}`;
            expect(bankTiles.has(key), `${loc.name} bank ${key}`).toBe(true);
        }
    });

    test('core catalog entries are verified; tick-manip camps may be provisional', () => {
        const provisional = new Set([
            'S Falador Oaks',
            'Lumbridge Farmer Willows',
            'Lumbridge Castle Willows'
        ]);
        for (const loc of WOODCUTTING_LOCATIONS) {
            if (provisional.has(loc.name)) {
                expect(loc.verified, loc.name).toBe(false);
            } else {
                expect(loc.verified, loc.name).toBe(true);
            }
        }
    });

    test('includes tick-manip WC camps (#160)', () => {
        const names = new Set(WOODCUTTING_LOCATIONS.map(l => l.name));
        expect(names.has('S Falador Oaks')).toBe(true);
        expect(names.has('Lumbridge Farmer Willows')).toBe(true);
        expect(names.has('Lumbridge Castle Willows')).toBe(true);
    });

    test('fire spots are not mixed into chop camps', () => {
        // Burn strips live in FiremakingLogic, chop table is trees + bank only.
        for (const loc of WOODCUTTING_LOCATIONS) {
            expect('rangeStand' in loc).toBe(false);
            expect(loc.spot).toBeDefined();
            expect(loc.bankStand).toBeDefined();
        }
    });
});

describe('ENT_NPC_IDS', () => {
    test('covers pack 444-452 and stops before suit of armour', () => {
        expect(ENT_LIFE_TICKS).toBe(60);
        expect(ENT_NPC_IDS.size).toBe(9);
        expect(isEntNpcId(443)).toBe(false);
        expect(isEntNpcId(444)).toBe(true);
        expect(isEntNpcId(452)).toBe(true);
        expect(isEntNpcId(453)).toBe(false);
    });

    test('entNpcOnTile is the clicked loc only', () => {
        const tree = { x: 3087, z: 3234, level: 0 };
        const neighbour = { x: 3088, z: 3234, level: 0 };
        const npcs = [{ id: 444, tile: tree }];
        expect(entNpcOnTile(npcs, tree)).toBe(true);
        expect(entNpcOnTile(npcs, neighbour)).toBe(false);
        expect(entNpcOnTile([{ id: 443, tile: tree }], tree)).toBe(false);
    });
});
