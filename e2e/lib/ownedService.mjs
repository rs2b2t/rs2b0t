import { rmSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export function ownedService(executablePath, env) {
    const groups = process.env.E2E_SERVICE_GROUPS;
    if (!groups || process.platform === 'win32') return { executablePath, env };
    return {
        executablePath: fileURLToPath(new URL('./owned-service.sh', import.meta.url)),
        env: { ...env, E2E_SERVICE_GROUPS: groups, E2E_SERVICE_EXECUTABLE: executablePath }
    };
}

export function releaseOnExit(child) {
    const groups = process.env.E2E_SERVICE_GROUPS;
    if (!groups || process.platform === 'win32' || !child.pid) return;
    const pid = child.pid;
    const release = () => {
        try {
            process.kill(-pid, 0);
        } catch (error) {
            if (error.code !== 'ESRCH') throw error;
            rmSync(join(groups, String(pid)), { force: true });
        }
    };
    if (child.exitCode !== null || child.signalCode !== null) release();
    else child.once('exit', release);
}
