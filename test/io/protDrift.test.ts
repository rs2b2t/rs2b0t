import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEFAULT_ENGINE_DIR, generateProt, parseRevision } from '../../tools/gen-prot.js';

const ENGINE = DEFAULT_ENGINE_DIR;

describe.skipIf(!existsSync(join(ENGINE, 'src/network/game/client/ClientGameProt.ts')))('protocol drift (engine-gated)', () => {
    test('engine checkout is revision 289', () => {
        const worldConfig = readFileSync(join(ENGINE, 'src/util/WorldConfig.ts'), 'utf8');
        expect(
            /revision:\s*289/.test(worldConfig),
            `ENGINE_DIR (${ENGINE}) is not on revision 289 — point ENGINE_DIR at a 289 checkout before trusting this drift check`
        ).toBe(true);
    });

    test('committed ClientProt matches the engine', () => {
        const { client } = generateProt(ENGINE);
        const committed = readFileSync('src/client/io/ClientProt.ts', 'utf8');
        expect(client).toBe(committed);
    });

    test('committed CLIENT_VERSION matches the engine revision', () => {
        const revision = parseRevision(readFileSync(join(ENGINE, 'src/util/WorldConfig.ts'), 'utf8'));
        const committed = readFileSync('src/client/io/ClientProt.ts', 'utf8');
        expect(committed).toContain(`export const CLIENT_VERSION = ${revision};`);
    });

    test('committed ServerProt matches the engine', () => {
        const { server } = generateProt(ENGINE);
        const committed = readFileSync('src/client/io/ServerProt.ts', 'utf8');
        expect(server).toBe(committed);
    });
});
