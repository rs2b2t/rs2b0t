import { test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

test('client startup paints without the full-canvas buffer and MapView keeps its rendering area', () => {
    execFileSync(process.execPath, ['--no-env-file', '--no-install', join(import.meta.dir, 'fixtures/startupCanvas.ts')]);
});
