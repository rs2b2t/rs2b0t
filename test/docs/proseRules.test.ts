import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const VALE = 'node_modules/@vvago/vale/bin/vale';
const FIXTURES = 'styles/RS2B0T/fixtures';

export type Alert = { Check: string; Severity: string; Line: number; Match: string; Message: string };

export function lint(paths: string[]): Map<string, Alert[]> {
    const run = spawnSync(VALE, ['--config=.vale.ini', '--output=JSON', '--no-exit', ...paths], { encoding: 'utf8' });
    if (run.error) throw new Error(`vale did not run: ${run.error.message}`);
    const report = JSON.parse(run.stdout || '{}') as Record<string, Alert[]>;
    const byPath = new Map<string, Alert[]>();
    const cwd = `${process.cwd()}/`;
    for (const [path, alerts] of Object.entries(report)) {
        byPath.set(path.startsWith(cwd) ? path.slice(cwd.length) : path, alerts);
    }
    return byPath;
}

function alertsFor(file: string): Alert[] {
    return lint([`${FIXTURES}/${file}`]).get(`${FIXTURES}/${file}`) ?? [];
}

function checksIn(file: string): Set<string> {
    return new Set(alertsFor(file).map(a => a.Check));
}

test('BannedWords fires on markdown', () => {
    expect(checksIn('probe.md').has('RS2B0T.BannedWords')).toBe(true);
});

test('BannedWords fires inside a TypeScript comment', () => {
    expect(checksIn('probe.ts').has('RS2B0T.BannedWords')).toBe(true);
});

test('BannedWords ignores a TypeScript string literal', () => {
    expect(alertsFor('probe.ts').filter(a => a.Match === 'strikingly')).toEqual([]);
});

const BOTH_FORMATS = ['RS2B0T.SoftWords', 'RS2B0T.Wordiness', 'RS2B0T.Editorialising', 'RS2B0T.Antithesis'];

test.each(BOTH_FORMATS)('%s fires on markdown', check => {
    expect(checksIn('probe.md').has(check)).toBe(true);
});

test.each(BOTH_FORMATS)('%s fires inside a TypeScript comment', check => {
    expect(checksIn('probe.ts').has(check)).toBe(true);
});

test('SoftWords is a warning, so it never gates', () => {
    const soft = alertsFor('probe.md').filter(a => a.Check === 'RS2B0T.SoftWords');
    expect(soft.length).toBeGreaterThan(0);
    expect(soft.every(a => a.Severity === 'warning')).toBe(true);
});

const MARKDOWN_ONLY = ['RS2B0T.HeadingContent', 'RS2B0T.ThisDocument', 'RS2B0T.NegationList'];

test.each(MARKDOWN_ONLY)('%s fires on markdown', check => {
    expect(checksIn('probe.md').has(check)).toBe(true);
});

test('NegationList is disabled for TypeScript', () => {
    expect(checksIn('probe.ts').has('RS2B0T.NegationList')).toBe(false);
});

test('ThisDocument ignores a mid-sentence self-reference', () => {
    const lines = readFileSync(`${FIXTURES}/probe.md`, 'utf8').split('\n');
    const midSentence = lines.findIndex(l => l.startsWith('The banned opener')) + 1;
    expect(midSentence).toBeGreaterThan(0);
    const onThatLine = alertsFor('probe.md').filter(a => a.Check === 'RS2B0T.ThisDocument' && a.Line === midSentence);
    expect(onThatLine).toEqual([]);
});

test('HeadingContent fires only on heading lines', () => {
    const lines = readFileSync(`${FIXTURES}/probe.md`, 'utf8').split('\n');
    const offending = alertsFor('probe.md')
        .filter(a => a.Check === 'RS2B0T.HeadingContent')
        .filter(a => !lines[a.Line - 1].startsWith('#'));
    expect(offending).toEqual([]);
});

test('NegationList catches a two-item list and ignores a conjunction', () => {
    const lines = readFileSync(`${FIXTURES}/probe.md`, 'utf8').split('\n');
    const hits = alertsFor('probe.md').filter(a => a.Check === 'RS2B0T.NegationList');
    expect(hits.some(a => lines[a.Line - 1].startsWith('No prose, no preamble.'))).toBe(true);
    expect(hits.some(a => lines[a.Line - 1].includes('no coal and no bars'))).toBe(false);
});

test('lint:prose covers every source area and excludes the vendored client', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
    const script = pkg.scripts['lint:prose'];
    expect(script).toBeDefined();
    for (const path of ['docs', 'README.md', 'src/bot', 'tools', 'test', 'bundle.ts', 'bot.bundle.ts', 'eslint.config.ts', 'identifier.js']) {
        expect(script).toContain(path);
    }
    expect(script).not.toContain('src/client');
    expect(script).not.toContain('desktop');
});

test('the repository has no prose errors', () => {
    const paths = ['docs', 'README.md', 'templates', 'src/bot', 'tools', 'test', 'bundle.ts', 'bot.bundle.ts', 'eslint.config.ts', 'identifier.js'];
    const errors: string[] = [];
    for (const [file, alerts] of lint(paths)) {
        for (const a of alerts.filter(x => x.Severity === 'error')) errors.push(`${file}:${a.Line}  ${a.Check}  ${a.Match}`);
    }
    expect(errors.sort()).toEqual([]);
});

test('the docs/superpowers exclusion holds, and styles still load', () => {
    const dir = 'docs/superpowers';
    const probe = `${dir}/vale-exclusion-probe.md`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(probe, '# Overview\n\nThis line is actually crucial.\n');
    try {
        const excluded = lint([probe]).get(probe) ?? [];
        const control = alertsFor('probe.md');
        expect(excluded).toEqual([]);
        expect(control.length).toBeGreaterThan(0);
    } finally {
        rmSync(probe, { force: true });
    }
});
