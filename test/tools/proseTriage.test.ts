import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { manifest, sources, trackedSources } from '../../tools/prose-triage.js';

function tree(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'triage-'));
    for (const [name, body] of Object.entries(files)) {
        const path = join(dir, name);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, body);
    }
    return dir;
}

test('files without comments are omitted', () => {
    const dir = tree({ 'bare.ts': 'export const a = 1;\n', 'noted.ts': '// one\nexport const b = 2;\n' });
    const rows = manifest(dir);
    expect(rows.map(r => r.file.split('/').pop())).toEqual(['noted.ts']);
    expect(rows[0].comments).toBe(1);
});

test('rows are sorted by errors then comments, descending', () => {
    const dir = tree({
        'clean.ts': '// one\n// two\n// three\n// four\nexport const a = 1;\n',
        'dirty.ts': '// this is actually crucial\nexport const b = 2;\n'
    });
    const rows = manifest(dir);
    expect(rows.map(r => r.file.split('/').pop())).toEqual(['dirty.ts', 'clean.ts']);
    expect(rows[0].errors).toBe(2);
    expect(rows[1].errors).toBe(0);
});

test('warnings are not counted as errors', () => {
    const dir = tree({ 'soft.ts': '// the whole thing is really slow\nexport const a = 1;\n' });
    expect(manifest(dir)[0].errors).toBe(0);
});

test('comment counts include delimiters and exempt lines while blocks count only findings', () => {
    const dir = tree({ 'block.ts': '/**\n * one\n * two\n * three\n */\n\n// prettier-ignore\nexport const a = 1; // inline\n' });
    const rows = manifest(dir);
    expect(rows[0].blocks).toBe(1);
    expect(rows[0].comments).toBe(6);
});

test('a root inside the repository is enumerated from git', () => {
    const found = sources('.');
    expect(found).toContain('tools/lint-prose-extras.ts');
    expect(found.filter(f => f.startsWith('node_modules/'))).toEqual([]);
    expect(found.every(f => f.endsWith('.ts'))).toBe(true);
});

test('a root outside the repository falls back to a filesystem walk', () => {
    const dir = tree({ 'top.ts': 'export const a = 1;\n', 'nested/deep.ts': 'export const b = 2;\n', 'notes.md': '# title\n' });
    expect(trackedSources(dir)).toEqual([]);
    expect(sources(dir).sort()).toEqual([join(dir, 'nested/deep.ts'), join(dir, 'top.ts')]);
});

test('a missing root is a hard failure', () => {
    expect(() => manifest('does-not-exist-xyz')).toThrow('prose triage: root is not a directory: does-not-exist-xyz');
});

test('a root that is a file is a hard failure', () => {
    const dir = tree({ 'only.ts': '// one\n' });
    const path = join(dir, 'only.ts');
    expect(() => manifest(path)).toThrow(`prose triage: root is not a directory: ${path}`);
});

test('a root holding no TypeScript files is a hard failure', () => {
    const dir = tree({ 'notes.md': '# title\n', 'nested/more.md': '# other\n' });
    expect(() => manifest(dir)).toThrow(`prose triage: root holds no TypeScript files: ${dir}`);
});

test('a root of TypeScript files with no comments returns no rows without throwing', () => {
    const dir = tree({ 'bare.ts': 'export const a = 1;\n', 'nested/plain.ts': 'export const b = 2;\n' });
    expect(sources(dir).length).toBe(2);
    expect(manifest(dir)).toEqual([]);
});

test('the command line reports a missing root and exits 2', () => {
    const run = spawnSync('bun', ['tools/prose-triage.ts', 'does-not-exist-xyz'], { encoding: 'utf8' });
    expect(run.status).toBe(2);
    expect(run.stderr.trim()).toBe('prose triage: root is not a directory: does-not-exist-xyz');
    expect(run.stdout).toBe('');
});
