#!/usr/bin/env bun
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, relative } from 'node:path';

export const SPEC = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;

/** Repo-root path a relative specifier names; null when it is bare, aliased or names a non-TypeScript file. */
export function resolveSpec(fromFile: string, spec: string): string | null {
    if (!spec.startsWith('.')) {
        return null;
    }
    const target = posix.normalize(posix.join(posix.dirname(fromFile), spec));
    if (target.endsWith('.js')) {
        return `${target.slice(0, -3)}.ts`;
    }
    if (target.endsWith('.ts')) {
        return target;
    }
    // Why: moduleResolution "bundler" makes the extensionless spelling idiomatic, and it typechecks.
    return posix.basename(target).includes('.') ? null : `${target}.ts`;
}

function depGraph(sources: Map<string, string>): Map<string, Set<string>> {
    const dep = new Map<string, Set<string>>();
    for (const [file, src] of sources) {
        const out = new Set<string>();
        SPEC.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = SPEC.exec(src))) {
            const target = resolveSpec(file, m[1]);
            // Why: membership never leaves the supplied map, so product source under src/ is not swept in.
            if (target !== null && sources.has(target)) {
                out.add(target);
            }
        }
        dep.set(file, out);
    }
    return dep;
}

/** Modules under `sources` that `consumers` imports; used to spot offline consumers living outside the tree. */
function outboundInto(consumers: Map<string, string>, sources: Map<string, string>): Set<string> {
    const out = new Set<string>();
    for (const [file, src] of consumers) {
        SPEC.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = SPEC.exec(src))) {
            const target = resolveSpec(file, m[1]);
            if (target !== null && sources.has(target)) {
                out.add(target);
            }
        }
    }
    return out;
}

/** The bidirectional import closure around `entry`: consumers, their ABI, minus ABI shared with offline code.
 *  `offlineTests` names consumers outside the scanned tree — a unit test proves its target runs without a browser. */
export function liveClosure(
    entry: string,
    sources: Map<string, string>,
    offlineTests: Map<string, string> = new Map()
): { move: string[]; heldBack: string[] } {
    const dep = depGraph(sources);
    const reaches = (file: string, seen: Set<string>): boolean => {
        if (seen.has(file)) {
            return false;
        }
        seen.add(file);
        for (const d of dep.get(file) ?? []) {
            if (d === entry || reaches(d, seen)) {
                return true;
            }
        }
        return false;
    };
    // Why: the entry joins the closure only when it is inside the scanned tree, so pointing the audit
    // at the post-move entry over tools/ reports an empty closure rather than the entry itself.
    const core = new Set<string>(sources.has(entry) ? [entry] : []);
    for (const file of sources.keys()) {
        if (reaches(file, new Set())) {
            core.add(file);
        }
    }
    const abi = new Set<string>();
    const frontier = [...core];
    while (frontier.length) {
        for (const d of dep.get(frontier.pop() as string) ?? []) {
            if (!abi.has(d) && !core.has(d)) {
                abi.add(d);
                frontier.push(d);
            }
        }
    }
    const offline = [...sources.keys()].filter(f => !core.has(f) && !abi.has(f));
    // Why: only ABI modules are eligible, so a unit test covering a harness never drags the harness back.
    const testedOffline = outboundInto(offlineTests, sources);
    const heldBack = [...abi]
        .filter(a => testedOffline.has(a) || offline.some(o => dep.get(o)?.has(a)))
        .sort();
    const held = new Set(heldBack);
    const move = [...core, ...[...abi].filter(a => !held.has(a))].sort();
    return { move, heldBack };
}

/** Files under `fromPrefix` whose specifiers resolve into `toPrefix`, as `file\tspecifier`.
 *  Why: the closure drops edges leaving its source map, so it cannot see a tools/ file reaching into e2e/. */
export function importsInto(fromPrefix: string, toPrefix: string, sources: Map<string, string>): string[] {
    const found: string[] = [];
    for (const [file, src] of sources) {
        if (!file.startsWith(`${fromPrefix}/`)) {
            continue;
        }
        SPEC.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = SPEC.exec(src))) {
            const target = resolveSpec(file, m[1]);
            if (target !== null && target.startsWith(`${toPrefix}/`)) {
                found.push(`${file}\t${m[1]}`);
            }
        }
    }
    return found.sort();
}

/** Files under `fromPrefix` holding a string literal that names a path inside `toPrefix`, as `file\tliteral`.
 *  Why: a specifier assembled by concatenation never appears as one literal, so specifier analysis misses it. */
export function mentionsAcross(
    fromPrefix: string,
    toPrefix: string,
    sources: Map<string, string>,
    exempt: Set<string>
): string[] {
    const needle = `${toPrefix}/`;
    const found: string[] = [];
    for (const [file, src] of sources) {
        if (!file.startsWith(`${fromPrefix}/`) || exempt.has(file)) {
            continue;
        }
        for (const lit of src.match(/'[^'\n]*'|"[^"\n]*"/g) ?? []) {
            const body = lit.slice(1, -1);
            // Why: only a relative fragment can be concatenated into a working specifier, so prose
            // naming an e2e command is not a violation.
            if (body.includes(needle) && /^\.{1,2}\//.test(body)) {
                found.push(`${file}\t${body}`);
            }
        }
    }
    return found.sort();
}

/** Files under `prefix` that drive a browser, which belong on the e2e side whatever they import.
 *  Why: it matches an import of playwright rather than the word, so naming a symbol after it is not a hit. */
export function playwrightUnder(prefix: string, sources: Map<string, string>): string[] {
    const DRIVES = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]playwright|chromium\.launch\s*\(/;
    return [...sources]
        .filter(([f, s]) => f.startsWith(`${prefix}/`) && DRIVES.test(s))
        .map(([f]) => f)
        .sort();
}

/** Files transitively importing `entry`. This is the violation set; ABI modules `entry` imports are not. */
export function consumersOf(entry: string, sources: Map<string, string>): string[] {
    const dep = depGraph(sources);
    const reaches = (file: string, seen: Set<string>): boolean => {
        if (seen.has(file)) {
            return false;
        }
        seen.add(file);
        for (const d of dep.get(file) ?? []) {
            if (d === entry || reaches(d, seen)) {
                return true;
            }
        }
        return false;
    };
    return [...sources.keys()].filter(f => reaches(f, new Set())).sort();
}

export function misnamedUnder(prefix: string, files: string[]): string[] {
    return files
        .filter(f => f.startsWith(`${prefix}/`) && (f.endsWith('-test.ts') || f.endsWith('-live.ts')))
        .sort();
}

const BUN_TEST = /(?:\.|_)(?:test|spec)\.(?:ts|tsx|js|jsx)$/;

export function bunTestNamesUnder(prefix: string, files: string[]): string[] {
    return files.filter(f => f.startsWith(`${prefix}/`) && BUN_TEST.test(f)).sort();
}

export function walk(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const p = join(dir, name);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });
}

export function readTree(dir: string): Map<string, string> {
    const files = walk(dir).map(p => relative(process.cwd(), p));
    return new Map(files.map(f => [f, readFileSync(f, 'utf8')]));
}

if (import.meta.main) {
    const entry = process.argv.includes('--after') ? 'e2e/lib/harness.ts' : 'e2e/lib/harness.ts';
    const sources = readTree('tools');
    const { move, heldBack } = liveClosure(entry, sources, readTree('test'));
    if (process.argv.includes('--plan')) {
        for (const f of move) {
            console.log(`e2e/${f.slice('tools/'.length)}\t${f}`);
        }
    } else {
        console.log(`${sources.size} scanned; ${move.length} live; ${heldBack.length} held back`);
        for (const h of heldBack) {
            console.log(`  held back: ${h}`);
        }
    }
}
