import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { ownedService } from '../../../e2e/lib/ownedService.mjs';

const [mode, prefix, lifetime, ...flags] = process.argv.slice(2);
if (mode === 'service') {
    if (flags.includes('brief-child')) {
        const last = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 400)'], { stdio: 'ignore' });
        writeFileSync(prefix + '.last', String(last.pid));
        last.unref();
    }
    if (flags.includes('lock')) {
        const fd = openSync(prefix + '.lock', 'w');
        const lock = spawnSync('/usr/bin/python3', ['-I', '-c', 'import fcntl; fcntl.flock(0, fcntl.LOCK_EX | fcntl.LOCK_NB)'], { stdio: [fd, 'ignore', 'inherit'] });
        if (lock.status !== 0) throw new Error('Could not acquire fixture lock');
    }
    writeFileSync(prefix + '.pid', String(process.pid));
    console.log('ready');
    process.send('ready');
    if (flags.includes('stopped')) process.kill(-process.pid, 'SIGSTOP');
    if (!flags.includes('brief-child')) setTimeout(() => console.log('survived'), Number(lifetime));
} else {
    const detached = flags.includes('detached');
    const owned = detached && !flags.includes('unregistered');
    const service = owned ? ownedService('node', process.env) : { executablePath: 'node', env: process.env };
    const fd = flags.includes('private') ? openSync(prefix + '.log', 'w') : 'inherit';
    const child = spawn(service.executablePath, [process.argv[1], 'service', prefix, lifetime, ...flags], {
        detached, cwd: flags.includes('change-cwd') ? '/' : undefined, env: service.env, stdio: ['ignore', fd, fd, 'ipc']
    });
    if (fd !== 'inherit') closeSync(fd);
    if (flags.includes('brief-child')) {
        const hold = setInterval(() => {
            if (existsSync(prefix + '.release')) clearInterval(hold);
        }, 20);
    }
    if (flags.includes('hold-pipe')) {
        spawn('node', ['-e', 'setTimeout(() => {}, 6000)'], { stdio: 'inherit' }).unref();
    }
    if (flags.includes('ordinary-child')) {
        const child = spawn('/bin/sleep', ['6'], { stdio: 'ignore' });
        writeFileSync(prefix + '.ordinary', String(child.pid));
        child.unref();
    }
    process.on('exit', () => writeFileSync(prefix + '.exited', String(process.pid)));
    child.once('message', () => {
        child.disconnect();
        if (flags.includes('exit')) child.unref();
    });
    child.once('exit', code => { process.exitCode = code ?? 1; });
}
