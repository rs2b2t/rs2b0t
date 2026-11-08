import { expect, test } from 'bun:test';
import { join } from 'node:path';

test('launcher owns separate builds, ports, profiles and child processes', async () => {
    const child = Bun.spawn(['python3', join(import.meta.dir, 'b0t-launcher.py')], { stdout: 'pipe', stderr: 'pipe' });
    const [code, output, errors] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ code, output, errors: code === 0 ? '' : errors }).toEqual({ code: 0, output: '', errors: '' });
}, 20000);
