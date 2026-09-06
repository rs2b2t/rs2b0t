import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { generateProt } from '../../tools/gen-prot.js';

const ENGINE = process.env.ENGINE_DIR ?? join(homedir(), 'code', 'rs2b2t-engine-289');

describe('protocol drift', () => {
    test('committed ClientProt matches the engine', () => {
        const { client } = generateProt(ENGINE);
        const committed = readFileSync('src/client/io/ClientProt.ts', 'utf8');
        expect(client).toBe(committed);
    });

    test('committed ServerProt matches the engine', () => {
        const { server } = generateProt(ENGINE);
        const committed = readFileSync('src/client/io/ServerProt.ts', 'utf8');
        expect(server).toBe(committed);
    });
});
