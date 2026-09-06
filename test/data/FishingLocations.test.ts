import { describe, expect, test } from 'bun:test';
import { BANK_LOCATIONS } from '#/bot/api/bank/BankLocations.js';
import Tile from '#/bot/geometry/Tile.js';
import {
    FISHING_LOCATIONS,
    FISHING_LOCATION_OPTIONS,
    LOCATION_OPTIONS,
    resolveFishingLocation,
    resolveLocation
} from '#/bot/data/fishingLocations.js';

const bankTiles = new Set(BANK_LOCATIONS.map(b => `${b.tile.x},${b.tile.z},${b.tile.level}`));

describe('resolveFishingLocation', () => {
    test('None resolves to no location', () => {
        expect(resolveFishingLocation('None', new Tile(3086, 3231, 0))).toBeNull();
    });

    test('Auto detects Draynor from the fishing spots', () => {
        expect(resolveFishingLocation('Auto', new Tile(3086, 3231, 0))?.name).toBe('Draynor Village');
    });

    test('Auto detects Draynor from inside the bank', () => {
        expect(resolveFishingLocation('Auto', new Tile(3092, 3243, 0))?.name).toBe('Draynor Village');
    });

    test('Auto freeform from Lumbridge (outside Draynor map square)', () => {
        // Lumbridge 3222,3218 is map square (50,50); Draynor fish 3086,3231 is (48,50).
        expect(resolveFishingLocation('Auto', new Tile(3222, 3218, 0))).toBeNull();
    });

    test('Auto freeform on other level even when xz matches a camp', () => {
        // sameMapSquare requires level match, level 1 at Draynor coords is freeform.
        expect(resolveFishingLocation('Auto', new Tile(3086, 3231, 1))).toBeNull();
    });

    test('Auto freeform at Ardougne river fly (outside every fishing camp chunk)', () => {
        expect(resolveFishingLocation('Auto', new Tile(2566, 3374, 0))).toBeNull();
    });

    test('named locations resolve case-insensitively', () => {
        expect(resolveFishingLocation('draynor village', new Tile(3222, 3218, 0))?.name).toBe(
            'Draynor Village'
        );
        expect(resolveFishingLocation('Catherby', new Tile(0, 0, 0))?.name).toBe('Catherby');
        expect(resolveFishingLocation('Fishing Guild', new Tile(0, 0, 0))?.name).toBe('Fishing Guild');
        expect(resolveFishingLocation('Karamja (Musa Point)', new Tile(0, 0, 0))?.name).toBe(
            'Karamja (Musa Point)'
        );
        expect(resolveFishingLocation('Taverley Dungeon (lava eels)', new Tile(0, 0, 0))?.name).toBe(
            'Taverley Dungeon (lava eels)'
        );
    });

    test('unknown names resolve to null', () => {
        expect(resolveFishingLocation('Atlantis', new Tile(3086, 3231, 0))).toBeNull();
    });

    test('deprecated resolveLocation alias still works', () => {
        expect(resolveLocation('Auto', new Tile(3086, 3231, 0))?.name).toBe('Draynor Village');
    });
});

describe('FISHING_LOCATIONS table', () => {
    test('dropdown options are Auto + every location + None', () => {
        expect(FISHING_LOCATION_OPTIONS).toEqual([
            'Auto',
            ...FISHING_LOCATIONS.map(l => l.name),
            'None'
        ]);
        expect(LOCATION_OPTIONS).toEqual(FISHING_LOCATION_OPTIONS);
    });

    test('every bankStand is a known BANK_LOCATIONS tile', () => {
        for (const loc of FISHING_LOCATIONS) {
            const key = `${loc.bankStand.x},${loc.bankStand.z},${loc.bankStand.level}`;
            expect(bankTiles.has(key), `${loc.name} bank ${key}`).toBe(true);
        }
    });

    test('Catherby has a range stand for cook-after-fish', () => {
        const catherby = FISHING_LOCATIONS.find(l => l.name === 'Catherby');
        expect(catherby?.rangeStand).toEqual(new Tile(2817, 3443, 0));
        expect(catherby?.rangeName).toBe('Range');
        expect(catherby?.obstacles).toContain('door');
    });

    test('core catalog entries are verified; tick-manip camps may be provisional', () => {
        // Why: `verified` means the location sweep passed, and its bank probe looks for a loc whose name holds 'bank'; Shilo's teller is an npc, so the camp is proven by the fish-shilo-feathers scenario instead and stays provisional here.
        const provisional = new Set(['Gnome Stronghold (fishing)', 'Shilo Village']);
        for (const loc of FISHING_LOCATIONS) {
            if (provisional.has(loc.name)) {
                expect(loc.verified, loc.name).toBe(false);
            } else {
                expect(loc.verified, loc.name).toBe(true);
            }
        }
    });

    test('includes Gnome Stronghold fishing camp (#160)', () => {
        expect(FISHING_LOCATIONS.some(l => l.name === 'Gnome Stronghold (fishing)')).toBe(true);
    });

    test('Karamja banks at Draynor (no local bank)', () => {
        const musa = FISHING_LOCATIONS.find(l => l.name === 'Karamja (Musa Point)');
        expect(musa?.bankStand).toEqual(new Tile(3093, 3243, 0));
    });
});

describe('the Shilo Village camp', () => {
    const shilo = FISHING_LOCATIONS.find(l => l.name === 'Shilo Village')!;

    // Why: Shilo has no booth at all, so the fields stay off and Banking.open picks the teller up off the known bank standing at this tile.
    test('banks at the teller, naming no booth', () => {
        expect(shilo.bankStand).toEqual(new Tile(2852, 2954, 0));
        expect(shilo.boothName).toBeUndefined();
        expect(shilo.boothOp).toBeUndefined();
        const teller = BANK_LOCATIONS.find(b => b.name === 'Shilo Village')!;
        expect(teller.tile).toEqual(shilo.bankStand);
        expect(teller.npcAccess?.op).toBe('Bank');
        expect(teller.requires?.quest).toBe('Shilo Village');
    });

    test('buys its feathers off Fernahei rather than the bank', () => {
        expect(shilo.baitVendor).toEqual({ keeper: 'Fernahei', stand: new Tile(2870, 2971, 0), price: 2, item: 'Feather' });
    });

    // Why: derived by tools/nav/shilo-fishing-stands.ts; the walk round to these is 74 to 90 tiles against 14 to 56 along the village bank.
    test('refuses the four river tiles whose only stand is across the water', () => {
        expect(shilo.avoidSpots?.map(t => [t.x, t.z])).toEqual([[2850, 2976], [2855, 2977], [2860, 2976], [2869, 2977]]);
    });

    test('sweeps the village bank east to west, and every stop is inside camp membership', () => {
        expect(shilo.sweep?.map(t => [t.x, t.z])).toEqual([[2862, 2971], [2856, 2972], [2841, 2970], [2836, 2970], [2822, 2968]]);
        for (const stop of shilo.sweep ?? []) {
            expect(shilo.spot.distanceTo(stop), `${stop}`).toBeLessThanOrEqual(shilo.campRadius!);
        }
    });

    test('the bank stand and Fernahei are both inside camp membership too', () => {
        expect(shilo.spot.distanceTo(shilo.bankStand)).toBeLessThanOrEqual(shilo.campRadius!);
        expect(shilo.spot.distanceTo(shilo.baitVendor!.stand)).toBeLessThanOrEqual(shilo.campRadius!);
    });

    test('no avoided tile is also a sweep stop', () => {
        const sweep = new Set((shilo.sweep ?? []).map(t => `${t.x},${t.z}`));
        for (const t of shilo.avoidSpots ?? []) {
            expect(sweep.has(`${t.x},${t.z}`), `${t}`).toBe(false);
        }
    });

    test('the Fishing Guild keeps Roachey, so the vendor is per camp rather than global', () => {
        const guild = FISHING_LOCATIONS.find(l => l.name === 'Fishing Guild')!;
        expect(guild.baitVendor?.keeper).toBe('Roachey');
        expect(guild.baitVendor?.stand).toEqual(new Tile(2596, 3399, 0));
        expect(FISHING_LOCATIONS.filter(l => l.baitVendor).map(l => l.name)).toEqual(['Fishing Guild', 'Shilo Village']);
    });
});
