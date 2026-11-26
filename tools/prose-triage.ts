import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { checkComments, isCommentLine } from './lint-prose-extras.js';

const VALE = 'node_modules/@vvago/vale/bin/vale';

export type Row = { file: string; comments: number; blocks: number; errors: number };

export function trackedSources(root: string): string[] {
    const out = spawnSync('git', ['ls-files', '--', root], { encoding: 'utf8' });
    if (out.status !== 0) return [];
    return out.stdout.split('\n').filter(path => path.endsWith('.ts'));
}

function walkSources(root: string, found: string[] = []): string[] {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        const path = join(root, entry.name);
        if (entry.isDirectory()) walkSources(path, found);
        else if (path.endsWith('.ts')) found.push(path);
    }
    return found;
}

export function sources(root: string): string[] {
    const tracked = trackedSources(root);
    return tracked.length > 0 ? tracked : walkSources(root);
}

function valeErrors(root: string): Map<string, number> {
    const run = spawnSync(VALE, ['--config=.vale.ini', '--output=JSON', '--no-exit', root], { encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`vale failed: ${run.stderr?.trim() || run.error?.message || `status ${run.status}`}`);
    const report = JSON.parse(run.stdout) as Record<string, { Severity: string }[]>;
    const counts = new Map<string, number>();
    const cwd = `${process.cwd()}/`;
    for (const [path, alerts] of Object.entries(report)) {
        counts.set(path.startsWith(cwd) ? path.slice(cwd.length) : path, alerts.filter(a => a.Severity === 'error').length);
    }
    return counts;
}

function isDirectory(root: string): boolean {
    try {
        return statSync(root).isDirectory();
    } catch {
        return false;
    }
}

export function manifest(root: string): Row[] {
    if (!isDirectory(root)) throw new Error(`prose triage: root is not a directory: ${root}`);
    const files = sources(root);
    if (files.length === 0) throw new Error(`prose triage: root holds no TypeScript files: ${root}`);
    const errors = valeErrors(root);
    const rows: Row[] = [];
    for (const file of files) {
        const lines = readFileSync(file, 'utf8').split('\n');
        const comments = lines.filter(isCommentLine).length;
        if (comments === 0) continue;
        const blocks = checkComments([file]).filter(f => f.check === 'comment-block').length;
        rows.push({ file, comments, blocks, errors: errors.get(file) ?? 0 });
    }
    return rows.sort((a, b) => b.errors - a.errors || b.comments - a.comments);
}

if (import.meta.main) {
    const root = process.argv[2] ?? 'src/bot';
    let rows: Row[];
    try {
        rows = manifest(root);
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(2);
    }
    for (const r of rows) console.log(`${r.errors}\t${r.blocks}\t${r.comments}\t${r.file}`);
    console.log(`${rows.length} files, ${rows.reduce((n, r) => n + r.comments, 0)} comment lines, ${rows.reduce((n, r) => n + r.errors, 0)} vale errors`);
}
