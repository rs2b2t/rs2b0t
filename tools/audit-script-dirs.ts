#!/usr/bin/env bun
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative } from 'node:path';

const SCRIPTS = 'src/bot/scripts';
const SPEC = /(?:from\s+|import\(\s*)['"]([^'"]+)['"]/g;

/** The contribution directory a scripts/ file belongs to; null for the registry barrel at the root. */
export function contributionOf(file: string): string | null {
    const rest = file.slice(SCRIPTS.length + 1);
    const slash = rest.indexOf('/');
    return slash === -1 ? null : rest.slice(0, slash);
}

export function findCrossDirImports(sources: Map<string, string>): string[] {
    const found: string[] = [];
    for (const [file, src] of sources) {
        const from = contributionOf(file);
        if (from === null) {
            continue;
        }
        SPEC.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = SPEC.exec(src))) {
            const spec = m[1];
            if (!spec.startsWith('.')) {
                continue;
            }
            const target = posix.normalize(posix.join(posix.dirname(file), spec));
            if (!target.startsWith(`${SCRIPTS}/`)) {
                continue;
            }
            const to = contributionOf(target);
            if (to !== null && to !== from) {
                found.push(`${file}\t${spec}`);
            }
        }
    }
    return found.sort();
}

function walk(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const p = join(dir, name);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });
}

if (import.meta.main) {
    const files = walk(SCRIPTS).map(p => relative(process.cwd(), p));
    const sources = new Map(files.map(f => [f, readFileSync(f, 'utf8')]));
    const found = findCrossDirImports(sources);
    for (const line of found) {
        console.error(line);
    }
    console.log(`${sources.size} files scanned; ${found.length} cross-contribution imports`);
    if (found.length) {
        console.error('A scripts/ directory is one contribution. Shared code belongs inside it.');
        process.exit(1);
    }
}
