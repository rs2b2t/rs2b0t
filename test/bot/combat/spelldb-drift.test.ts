import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CONTENT = process.env.CONTENT_DIR ?? join(homedir(), 'code', 'rs2b2t-content');

describe.skipIf(!existsSync(join(CONTENT, 'scripts')))('spelldb drift (content-gated)', () => {
    test('src/bot/api/combat/data/spelldb.ts matches the content pack', () => {
        const run = Bun.spawnSync(['bun', 'tools/combat/gen-spelldb.ts', '--check']);
        expect(run.exitCode, new TextDecoder().decode(run.stderr)).toBe(0);
    });
});
