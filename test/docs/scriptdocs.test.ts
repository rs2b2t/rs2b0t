import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { ScriptRegistry } from '#/bot/runtime/ScriptRegistry.js';
import { renderScriptDocs } from '../../tools/gen-scriptdocs.js';
import '#/bot/scripts/index.js';

test('docs/SCRIPTS.md matches the script registry', () => {
    const fresh = renderScriptDocs(ScriptRegistry.list());
    const current = readFileSync('docs/SCRIPTS.md', 'utf8');
    expect(current === fresh ? 'current' : 'STALE — run: bun run gen:scriptdocs').toBe('current');
});

test('every registered script is listed', () => {
    const current = readFileSync('docs/SCRIPTS.md', 'utf8');
    const missing = ScriptRegistry.list().filter(meta => !current.includes(`### ${meta.name}`));
    expect(missing.map(meta => meta.name)).toEqual([]);
});

test('the script documentation CLI checks the registry without browser audio', () => {
    const result = Bun.spawnSync([process.execPath, 'tools/gen-scriptdocs.ts', '--check'], {
        stdout: 'pipe', stderr: 'pipe', timeout: 10_000
    });
    expect(result.stderr.toString()).toBe('');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('docs/SCRIPTS.md matches the registry');
});
