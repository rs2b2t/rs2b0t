import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { engineLoginKey, parseModulusHex, parsePublicExponent } from '../../e2e/lib/engineLoginKey.js';

const ENGINE = process.env.ENGINE_DIR ?? join(homedir(), 'code', 'rs2b2t-engine');
const PEM = join(ENGINE, 'data', 'config', 'private.pem');

const DUMP = `publicExponent:
    00:81:f3:90:b2:cf:8c:a7:03:9e:e5:07:97:59:51:
    d5:a0:b1:5a:87:bf:8b:3f:99:c9:66:83:41:18:c5:
    0f:d9:4d
privateExponent:
    00:aa`;

describe('parsePublicExponent', () => {
    test('a compact 65537 line', () => {
        expect(parsePublicExponent('publicExponent: 65537 (0x10001)\nprivateExponent: 1')).toBe('65537');
    });

    test('a LostCity colon-hex dump', () => {
        expect(parsePublicExponent(DUMP)).toBe('58778699976184461502525193738213253649000149147835990136706041084440742975821');
    });
});

describe('parseModulusHex', () => {
    test('the openssl -modulus line', () => {
        expect(parseModulusHex('Modulus=FF\n')).toBe('255');
    });
});

describe.skipIf(!existsSync(PEM))('engineLoginKey', () => {
    test('reads decimal rsae and rsan from private.pem', () => {
        const key = engineLoginKey(ENGINE);
        expect(/^\d+$/.test(key.rsae)).toBe(true);
        expect(/^\d+$/.test(key.rsan)).toBe(true);
        expect(key.rsan.length).toBeGreaterThan(100);
        expect(engineLoginKey(ENGINE)).toEqual(key);
    });
});
