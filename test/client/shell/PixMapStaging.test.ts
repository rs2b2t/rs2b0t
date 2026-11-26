import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

test('prepareGame surfaces allocate staging on first draw and repaint changed pixels', () => {
    const fixture = join(import.meta.dir, 'fixtures/pixMapStaging.ts');
    const result = JSON.parse(execFileSync(process.execPath, ['--no-env-file', '--no-install', fixture, '2'], { encoding: 'utf8' }));
    expect(result.initial.allocations).toBe(8);
    expect(result.allocations).toBe(14);
    expect(result.draws).toBe(36);
    expect(result.sha256).toBe('fdbf7eb209cf595bcf806895dcc26b8feb1e8e761a4cab4834a92d2ec6cba340');
});
