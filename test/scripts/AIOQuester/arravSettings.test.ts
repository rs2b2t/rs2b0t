import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { ArravConfig } from '#/bot/api/ai/quests/defs/shieldofarrav/config.js';
import { AIO_SETTINGS } from '#/bot/scripts/AIOQuester/AIOQuester.js';
import { ARRAV_GANG_OPTIONS, applyArravSettings } from '#/bot/scripts/AIOQuester/AIOQuesterLogic.js';

// Why: ArravConfig is a module singleton shared across the suite, so a test that leaves it dirty fails an unrelated file.
function restoreDefaults(): void {
    ArravConfig.gang = 'random';
    ArravConfig.partner = '';
    ArravConfig.certTarget = 2;
}

beforeEach(restoreDefaults);
afterEach(restoreDefaults);

describe('arrav settings', () => {
    test('the schema offers exactly the three documented gangs', () => {
        expect(AIO_SETTINGS.arravGang?.options).toEqual([...ARRAV_GANG_OPTIONS]);
        expect(AIO_SETTINGS.arravGang?.default).toBe('random');
    });

    test('the partner and certificate settings carry the documented defaults', () => {
        expect(AIO_SETTINGS.arravPartner?.default).toBe('');
        expect(AIO_SETTINGS.arravCerts?.default).toBe(2);
        expect(AIO_SETTINGS.arravCerts?.min).toBe(1);
    });

    test('valid settings land on the config', () => {
        applyArravSettings({ gang: 'blackarm', partner: 'Zezima', certs: 6 });
        expect(ArravConfig.gang).toBe('blackarm');
        expect(ArravConfig.partner).toBe('Zezima');
        expect(ArravConfig.certTarget).toBe(6);
    });

    test('an unknown gang falls back to random rather than throwing mid-quest', () => {
        applyArravSettings({ gang: 'nonsense', partner: '', certs: 2 });
        expect(ArravConfig.gang).toBe('random');
    });

    test('a certificate target below one is clamped', () => {
        applyArravSettings({ gang: 'random', partner: '', certs: 0 });
        expect(ArravConfig.certTarget).toBe(1);
        applyArravSettings({ gang: 'random', partner: '', certs: -5 });
        expect(ArravConfig.certTarget).toBe(1);
    });

    test('a fractional target is floored, and a broken one falls back to the default', () => {
        applyArravSettings({ gang: 'random', partner: '', certs: 7.9 });
        expect(ArravConfig.certTarget).toBe(7);
        applyArravSettings({ gang: 'random', partner: '', certs: Number.NaN });
        expect(ArravConfig.certTarget).toBe(2);
    });

    test('a partner name is trimmed', () => {
        applyArravSettings({ gang: 'random', partner: '  Zezima  ', certs: 2 });
        expect(ArravConfig.partner).toBe('Zezima');
    });
});
