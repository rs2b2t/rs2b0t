import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function walk(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const p = join(dir, name);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });
}
