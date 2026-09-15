import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

const harness = fileURLToPath(new URL('../../e2e/quest-armour-live.ts', import.meta.url));

for (const flags of [
    ['--no-deploy'],
    ['--minutes', '2.5'],
    ['--armour', 'leather', '--minutes', '2', '--no-deploy']
]) {
    test(`reaches the localhost guard with runner flags ${flags.join(' ')}`, () => {
        const result = Bun.spawnSync([process.execPath, harness, '--base', 'https://invalid.example', ...flags], {
            timeout: 10_000, stdout: 'pipe', stderr: 'pipe'
        });
        expect(result.exitCode).toBe(1);
        expect(result.stderr.toString()).toContain('ERR_ASSERTION');
        expect(result.stderr.toString()).toContain('local engine required');
    });
}

test('rejects unknown armor even alongside runner flags', () => {
    const result = Bun.spawnSync([process.execPath, harness, '--base', 'https://invalid.example',
        '--armour', 'unknown', '--no-deploy', '--minutes', '2'], { timeout: 10_000, stdout: 'pipe', stderr: 'pipe' });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('--armour must be metal or leather');
    expect(result.stderr.toString()).toContain('ERR_ASSERTION');
});
