import { describe, expect, test } from 'bun:test';

import { BANK_LOCATIONS } from '#/bot/api/bank/BankLocations.js';
import {
    COOK_LOCATIONS,
    COOK_LOCATION_OPTIONS,
    cookLocation,
    resolveCookLocation
} from '#/bot/api/cooking/CookLocations.js';
import { CUSTOM_LOCATION, MAX_SURFACE_CHEB, nearestCookSurface } from '#/bot/data/cookLocations.js';
import Tile from '#/bot/geometry/Tile.js';

const anyBank = (): boolean => true;
const named = (name: string) => cookLocation(name)!;

describe('cook location catalog', () => {
    test('carries every bank', () => {
        expect(COOK_LOCATIONS.map(l => l.name).sort()).toEqual(BANK_LOCATIONS.map(b => b.name).sort());
    });

    test('offers Auto and Custom alongside the banks', () => {
        expect(COOK_LOCATION_OPTIONS[0]).toBe('Auto');
        expect(COOK_LOCATION_OPTIONS).toContain(CUSTOM_LOCATION);
        expect(COOK_LOCATION_OPTIONS).toContain('Catherby');
    });

    test('keeps the curated Catherby range', () => {
        const surface = named('Catherby').surface!;
        expect(surface.stand).toEqual(new Tile(2817, 3443, 0));
        expect(surface.loc).toEqual(new Tile(2817, 3444, 0));
        expect(surface.locName).toBe('Range');
        expect(surface.arriveRadius).toBe(0);
        expect(named('Catherby').verified).toBe(true);
    });

    test('keeps the curated Draynor fireplace and its door approach', () => {
        const surface = named('Draynor').surface!;
        expect(surface.locName).toBe('Fireplace');
        expect(surface.kind).toBe('fire');
        expect(surface.approach).toEqual(new Tile(3102, 3258, 0));
        expect(surface.stand).toEqual(new Tile(3100, 3257, 0));
    });

    test('prefers an oven over an equally close fire', () => {
        // Seers bank has a Fireplace at 2711,3476 and a Range at 2715,3476, both 15 away.
        const picked = nearestCookSurface(new Tile(2725, 3491, 0))!;
        expect(picked.kind).toBe('oven');
        expect([picked.x, picked.z]).toEqual([2715, 3476]);
    });

    test('takes the closer surface when both are the same kind', () => {
        const picked = nearestCookSurface(new Tile(2817, 3450, 0))!;
        expect([picked.x, picked.z]).toEqual([2818, 3455]);
    });

    test('finds nothing when the only surfaces are out of range or off-plane', () => {
        expect(nearestCookSurface(new Tile(2817, 3444, 1))).toBeNull();
        expect(nearestCookSurface(new Tile(2817, 3444, 0), 0)).not.toBeNull();
        expect(nearestCookSurface(new Tile(3094, 3493, 0))).toBeNull();
    });

    test('derives a surface for banks with no curated entry', () => {
        const alKharid = named('Al Kharid');
        expect(alKharid.surface!.loc).toEqual(new Tile(3271, 3180, 0));
        expect(alKharid.verified).toBe(false);
        expect(alKharid.surface!.arriveRadius).toBeGreaterThan(0);
    });

    test('leaves banks with nothing in range fire-only', () => {
        for (const name of ['Edgeville', 'Yanille', 'Falador West', 'Canifis', 'Duel Arena', 'Mage Arena']) {
            expect(named(name).surface).toBeNull();
        }
    });

    test('never pairs a surface further than the cutoff or off-plane', () => {
        for (const loc of COOK_LOCATIONS) {
            if (!loc.surface) {
                continue;
            }
            const bank = loc.bank.tile;
            expect(loc.surface.loc.level).toBe(bank.level);
            expect(Math.max(Math.abs(loc.surface.loc.x - bank.x), Math.abs(loc.surface.loc.z - bank.z)))
                .toBeLessThanOrEqual(MAX_SURFACE_CHEB);
        }
    });
});

describe('resolveCookLocation', () => {
    test('matches a name regardless of case', () => {
        expect(resolveCookLocation('catherby', new Tile(0, 0, 0), anyBank)!.name).toBe('Catherby');
    });

    test('returns null for Custom so the tile settings win', () => {
        expect(resolveCookLocation(CUSTOM_LOCATION, new Tile(2809, 3441, 0), anyBank)).toBeNull();
    });

    test('Auto takes the nearest bank', () => {
        expect(resolveCookLocation('Auto', new Tile(2800, 3440, 0), anyBank)!.name).toBe('Catherby');
        expect(resolveCookLocation('Auto', new Tile(3250, 3420, 0), anyBank)!.name).toBe('Varrock East');
    });

    test('Auto skips a bank this account cannot open', () => {
        const notCanifis = (name: string): boolean => name !== 'Canifis';
        const near = new Tile(3512, 3481, 0);
        expect(resolveCookLocation('Auto', near, anyBank)!.name).toBe('Canifis');
        expect(resolveCookLocation('Auto', near, l => notCanifis(l.name))!.name).not.toBe('Canifis');
    });

    test('an unknown name resolves to nothing rather than a surprise bank', () => {
        expect(resolveCookLocation('Lumbridge', new Tile(3222, 3218, 0), anyBank)).toBeNull();
    });
});
