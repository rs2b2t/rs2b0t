import process from 'node:process';
import { fileURLToPath } from 'node:url';

export function ownedService(executablePath, env, groups = process.env.E2E_SERVICE_GROUPS) {
    if (!groups || process.platform === 'win32') return { executablePath, env };
    return {
        executablePath: fileURLToPath(new URL('./owned-service.py', import.meta.url)),
        env: { ...env, E2E_SERVICE_GROUPS: groups, E2E_SERVICE_EXECUTABLE: executablePath }
    };
}
