import { spawn } from 'node:child_process';
import { closeSync, openSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { ownedService, releaseOnExit } from '../../../e2e/lib/ownedService.mjs';

const [mode, prefix, lifetime, ...flags] = process.argv.slice(2);
if (mode === 'service') {
    writeFileSync(prefix + '.pid', String(process.pid));
    console.log('ready');
    process.send('ready');
    setTimeout(() => console.log('survived'), Number(lifetime));
} else {
    const detached = flags.includes('detached');
    const owned = detached && !flags.includes('unregistered');
    const service = owned ? ownedService('node', process.env) : { executablePath: 'node', env: process.env };
    const fd = flags.includes('private') ? openSync(prefix + '.log', 'w') : 'inherit';
    const child = spawn(service.executablePath, [process.argv[1], 'service', prefix, lifetime], {
        detached, env: service.env, stdio: ['ignore', fd, fd, 'ipc']
    });
    if (fd !== 'inherit') closeSync(fd);
    if (owned) releaseOnExit(child);
    if (flags.includes('hold-pipe')) {
        spawn('node', ['-e', 'setTimeout(() => {}, 6000)'], { stdio: 'inherit' }).unref();
    }
    process.on('exit', () => writeFileSync(prefix + '.exited', ''));
    child.once('message', () => {
        child.disconnect();
        if (flags.includes('exit')) child.unref();
    });
    child.once('exit', code => { process.exitCode = code ?? 1; });
}
