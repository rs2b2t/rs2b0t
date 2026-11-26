import { cc, ptr } from 'bun:ffi';
import { createReadStream } from 'node:fs';
import { constants } from 'node:os';
import { delimiter, join } from 'node:path';
import { getSystemErrorName } from 'node:util';

function loadBindings() {
    return cc({
        source: new URL('./posix-harness.c', import.meta.url),
        symbols: {
            launch: { args: ['cstring', 'ptr', 'ptr', 'ptr'], returns: 'int' },
            harness_status: { args: ['int'], returns: 'int' },
            reap: { args: ['int'], returns: 'int' }
        }
    });
}

let bindings: ReturnType<typeof loadBindings>;
const RUNNING = 256;

function cString(value: string) {
    if (value.includes('\0')) throw new TypeError('spawn argument contains a null byte');
    return Buffer.from(value + '\0');
}

function vector(values: string[]) {
    const strings = values.map(cString);
    const table = BigUint64Array.from([...strings.map(s => BigInt(ptr(s))), 0n]);
    // Why: the native pointers borrow the buffers through posix_spawn.
    return Object.assign(table, { strings });
}

export function spawnHarness(cmd: string[], env: NodeJS.ProcessEnv) {
    const { symbols } = (bindings ??= loadBindings());
    const argv = vector(cmd);
    const envp = vector(Object.entries(env).filter(([, value]) => value !== undefined).map(([key, value]) => key + '=' + value));
    const fds = new Int32Array(2);
    const paths = cmd[0].includes('/') ? [cmd[0]] : (env.PATH ?? '/usr/bin:/bin').split(delimiter).map(dir => join(dir, cmd[0]));
    let denied = false;
    let pid = 0;
    for (const path of paths) {
        pid = symbols.launch(cString(path), argv, envp, fds);
        if (pid > 0) break;
        if (pid === -constants.errno.EACCES) denied = true;
        else if (pid !== -constants.errno.ENOENT && pid !== -constants.errno.ENOTDIR) break;
    }
    if (pid < 0) {
        const errno = denied && (pid === -constants.errno.ENOENT || pid === -constants.errno.ENOTDIR) ? -constants.errno.EACCES : pid;
        const code = getSystemErrorName(errno);
        const syscall = 'spawn ' + cmd[0];
        throw Object.assign(new Error(syscall + ' ' + code), { code, errno, syscall, path: cmd[0], spawnargs: cmd.slice(1) });
    }

    const [stdout, stderr] = Array.from(fds, fd => createReadStream('', { fd }));
    let stopped = false;
    const closed = Promise.all([stdout, stderr].map(stream => new Promise<void>((resolve, reject) => {
        stream.once('end', resolve);
        stream.once('error', reject);
    }))).then(async () => {
        while (!stopped) {
            const status = symbols.harness_status(pid);
            if (status < 0) throw new Error(`waitid: ${getSystemErrorName(status)}`);
            if (status !== RUNNING) return status;
            await Bun.sleep(10);
        }
        return null;
    });
    function stop() {
        if (stopped) return;
        stopped = true;
        // Why: WNOWAIT reserves the leader's PID until the last group signal.
        const status = symbols.harness_status(pid);
        if (status === -constants.errno.ECHILD) return;
        if (status < 0) throw new Error(`waitid: ${getSystemErrorName(status)}`);
        try {
            process.kill(-pid, 'SIGKILL');
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            const exited = symbols.harness_status(pid);
            if (code !== 'ESRCH' && !(code === 'EPERM' && exited >= 0 && exited < RUNNING)) throw error;
        } finally {
            if (!symbols.reap(pid)) {
                const timer = setInterval(() => { if (symbols.reap(pid)) clearInterval(timer); }, 10);
                timer.unref();
            }
        }
    }
    return { stdout, stderr, closed, stop, pid };
}
