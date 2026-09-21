import { expect, test } from 'bun:test';
import { join } from 'node:path';

test('real one-listener proxy isolates both fixture worlds and rejects invalid routes/builds', async () => {
    const child = Bun.spawn([process.execPath, 'run', join(import.meta.dir, '../fixtures/live-proxy-routing.ts')], { stdout: 'pipe', stderr: 'pipe' });
    const [code, output, errors] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ code, errors }).toEqual({ code: 0, errors: '' });
    expect(output).toContain('two-world HTTP/game/cache routing');
}, 15000);
