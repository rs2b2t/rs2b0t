#!/usr/bin/env bun
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

const SPEC_RE = /((?:from|import)\s*\(?\s*)(['"])([^'"]+)\2/g;

function toPosix(p: string): string {
    return p.split(sep).join('/');
}

export function resolveSpec(fromAbs: string, spec: string, exists: (p: string) => boolean): string | null {
    if (spec.startsWith('#3rdparty/')) {
        return null;
    }
    let p: string;
    if (spec.startsWith('#/')) {
        p = join(SRC, spec.slice(2));
    } else if (spec.startsWith('.')) {
        p = resolve(dirname(fromAbs), spec);
    } else {
        return null;
    }
    if (p.endsWith('.json')) {
        return exists(p) ? p : null;
    }
    if (p.endsWith('.js')) {
        p = p.slice(0, -3) + '.ts';
    } else if (!p.endsWith('.ts')) {
        if (exists(p + '.ts')) {
            p = p + '.ts';
        } else if (exists(join(p, 'index.ts'))) {
            p = join(p, 'index.ts');
        } else {
            return null;
        }
    }
    return exists(p) ? p : null;
}

export function renderSpec(importerAbs: string, targetAbs: string, original: string): string {
    const isJson = targetAbs.endsWith('.json');
    const base = isJson ? targetAbs : targetAbs.replace(/\.ts$/, '');
    const ext = isJson ? '' : original.endsWith('.js') ? '.js' : '';
    if (original.startsWith('#/')) {
        return '#/' + toPosix(relative(SRC, base)) + ext;
    }
    let r = toPosix(relative(dirname(importerAbs), base));
    if (!r.startsWith('.')) {
        r = './' + r;
    }
    return r + ext;
}

export function rewriteSource(
    text: string,
    importerOldAbs: string,
    importerNewAbs: string,
    move: (abs: string) => string,
    exists: (p: string) => boolean
): string {
    return text.replace(SPEC_RE, (whole, head: string, quote: string, spec: string) => {
        const targetOld = resolveSpec(importerOldAbs, spec, exists);
        if (targetOld === null) {
            return whole;
        }
        return head + quote + renderSpec(importerNewAbs, move(targetOld), spec) + quote;
    });
}

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) {
            walk(p, out);
        } else if (p.endsWith('.ts') || p.endsWith('.json')) {
            out.push(p);
        }
    }
    return out;
}

if (import.meta.main) {
    const mapPath = process.argv[2];
    const dry = process.argv.includes('--dry');
    if (!mapPath) {
        console.error('usage: bun tools/codemod-move.ts <moves.json> [--dry]');
        process.exit(2);
    }

    const raw: Record<string, string> = JSON.parse(readFileSync(mapPath, 'utf8'));
    const moves = new Map<string, string>();
    for (const [from, to] of Object.entries(raw)) {
        moves.set(resolve(ROOT, from), resolve(ROOT, to));
    }

    const files = ['src', 'test', 'tools'].flatMap(d => walk(join(ROOT, d)));
    const known = new Set(files);
    const exists = (p: string) => known.has(p);
    const move = (p: string) => moves.get(p) ?? p;

    for (const [from, to] of moves) {
        if (!known.has(from)) {
            console.error(`move source missing: ${relative(ROOT, from)}`);
            process.exit(1);
        }
        if (known.has(to)) {
            console.error(`move target exists: ${relative(ROOT, to)}`);
            process.exit(1);
        }
    }

    const pending: Array<[string, string]> = [];
    let changed = 0;
    for (const file of files) {
        if (!file.endsWith('.ts')) {
            continue;
        }
        const before = readFileSync(file, 'utf8');
        const after = rewriteSource(before, file, move(file), move, exists);
        if (after !== before) {
            changed++;
        }
        // Only write files whose content or path changed.
        if (after !== before || moves.has(file)) {
            pending.push([move(file), after]);
        }
    }

    console.log(`${moves.size} files move; ${changed} files have specifier rewrites`);
    if (dry) {
        process.exit(0);
    }

    for (const [from, to] of moves) {
        mkdirSync(dirname(to), { recursive: true });
        execFileSync('git', ['mv', relative(ROOT, from), relative(ROOT, to)], { cwd: ROOT });
    }
    for (const [path, text] of pending) {
        writeFileSync(path, text);
    }

    // Why: imports change across all three trees, so staging only the moved files leaves broken imports.
    const touched = [...new Set(pending.map(([p]) => relative(ROOT, p).split('/')[0]))].sort();
    console.log(`done — stage all of: git add ${touched.join(' ')}`);
}
