import { expect, test } from 'bun:test';
import { mkdtemp, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('inherited Node preload installs exclusive tracing only on the main thread', async () => {
    const directory = await mkdtemp('/var/folders/5c/93fx_qr91rb0n6zg7_chhvgc0000gn/T/opencode/reward-worker-');
    try {
        await copyFile(resolve(import.meta.dir, '../../out/e2e/RACE2-20260911T1006/preload.mjs'), resolve(directory, 'preload.mjs'));
        await writeFile(resolve(directory, 'witness.mjs'), `
            import { appendFileSync } from 'node:fs';
            import { threadId, isMainThread } from 'node:worker_threads';
            appendFileSync(new URL('./evaluations.jsonl', import.meta.url), JSON.stringify({ threadId, isMainThread }) + '\\n');
        `);
        await writeFile(resolve(directory, 'server.mjs'), `
            import { openSync, closeSync, writeFileSync } from 'node:fs';
            import { isMainThread } from 'node:worker_threads';
            const fd = openSync(new URL('./exclusive.trace', import.meta.url), 'wx');
            closeSync(fd);
            globalThis.handler = () => 'instrumented';
            writeFileSync(new URL('./installed.json', import.meta.url), JSON.stringify({ isMainThread, handler: globalThis.handler() }));
        `);
        await writeFile(resolve(directory, 'entry.mjs'), `
            import { Worker, isMainThread, parentPort } from 'node:worker_threads';
            import { writeFileSync } from 'node:fs';
            if (isMainThread) {
                const worker = new Worker(new URL(import.meta.url));
                worker.once('message', message => writeFileSync(new URL('./worker.json', import.meta.url), JSON.stringify(message)));
                worker.once('error', error => { console.error(error); process.exitCode = 1; });
            } else parentPort.postMessage({ initialized: true, patched: typeof globalThis.handler === 'function' });
        `);

        const result = spawnSync('node', ['--import', pathToFileURL(resolve(directory, 'witness.mjs')).href,
            '--import', pathToFileURL(resolve(directory, 'preload.mjs')).href, resolve(directory, 'entry.mjs')],
        { cwd: directory, encoding: 'utf8', timeout: 15000 });

        expect({ exitCode: result.status, errors: result.stderr }).toEqual({ exitCode: 0, errors: '' });
        expect(JSON.parse(await readFile(resolve(directory, 'installed.json'), 'utf8'))).toEqual({ isMainThread: true, handler: 'instrumented' });
        expect(JSON.parse(await readFile(resolve(directory, 'worker.json'), 'utf8'))).toEqual({ initialized: true, patched: false });
        const evaluations = (await readFile(resolve(directory, 'evaluations.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
        expect(evaluations).toEqual([{ threadId: 0, isMainThread: true }, { threadId: 1, isMainThread: false }]);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
