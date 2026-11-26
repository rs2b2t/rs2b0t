import { readFileSync } from 'node:fs';

export function checkBundleDefines(paths: string[]): void {
    if (paths.length === 0) throw new Error('Expected at least one browser bundle path');

    for (const path of paths) {
        if (readFileSync(path, 'utf8').includes('process.env')) {
            throw new Error(`${path} contains process.env`);
        }
    }
}

if (import.meta.main) checkBundleDefines(process.argv.slice(2));
