#!/usr/bin/env bun
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DECL = /^export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;

/** Escape every regex metacharacter, not the ones identifiers happen to use. */
function escapeRegExp(literal: string): string {
    return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findDeadExports(sources: Map<string, string>, scanPrefix: string, dts: string): string[] {
    const dead: string[] = [];
    for (const [file, src] of sources) {
        if (!file.startsWith(scanPrefix)) {
            continue;
        }
        const names: string[] = [];
        let m: RegExpExecArray | null;
        DECL.lastIndex = 0;
        while ((m = DECL.exec(src))) {
            names.push(m[1]);
        }
        for (const name of names) {
            const word = new RegExp(`\\b${escapeRegExp(name)}\\b`);
            if (word.test(dts)) {
                continue;
            }
            let used = false;
            for (const [other, text] of sources) {
                if (other !== file && word.test(text)) {
                    used = true;
                    break;
                }
            }
            if (!used) {
                dead.push(`${file}\t${name}`);
            }
        }
    }
    return dead.sort();
}

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) {
            walk(p, out);
        } else if (p.endsWith('.ts')) {
            out.push(p);
        }
    }
    return out;
}

if (import.meta.main) {
    const root = process.cwd();
    const files = ['src', 'test', 'tools'].flatMap(d => walk(join(root, d)));
    const sources = new Map(files.map(f => [relative(root, f), readFileSync(f, 'utf8')]));
    const dts = readFileSync(join(root, 'packages/rs2b0t-api/index.d.ts'), 'utf8');
    const dead = findDeadExports(sources, 'src/bot', dts);
    if (dead.length > 0) {
        console.error(`${dead.length} exports referenced nowhere outside their declaring file:\n`);
        for (const row of dead) {
            console.error('  ' + row);
        }
        process.exit(1);
    }
    console.log('audit:exports — clean');
}
