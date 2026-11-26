import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';

test('the scene owns its minimap buffer from first build until logout', () => {
    const result = JSON.parse(execFileSync(process.execPath, ['--no-env-file', '--no-install', `${import.meta.dir}/fixtures/minimapBuffer.ts`], { encoding: 'utf8' }));
    expect([result.startupBytes, result.activeBytes, result.logoutBytes]).toEqual([0, 1048576, 0]);
});
