import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

export type Finding = { file: string; line: number; check: string; message: string };

const DOC_CAP = 150;

const GENERATED = /^[ \t]*(?:<!--|\/\/+|\/\*+|\*)[ \t]*@?generated\b/im;

function isGenerated(body: string): boolean {
    return GENERATED.test(body.slice(0, 400));
}

export function checkDocCap(files: string[]): Finding[] {
    const found: Finding[] = [];
    for (const file of files) {
        const body = readFileSync(file, 'utf8');
        if (isGenerated(body)) continue;
        const lines = body.split('\n');
        const count = lines.at(-1) === '' ? lines.length - 1 : lines.length;
        if (count > DOC_CAP) {
            found.push({ file, line: DOC_CAP + 1, check: 'doc-cap', message: `${count} lines exceeds the ${DOC_CAP}-line cap; split the file rather than compressing it.` });
        }
    }
    return found;
}

const MAX_BLOCK = 2;
const RATIONALE = /\b(because|so that|the reason)\b/i;
const DIRECTIVE = /^\s*(?:\/\/|\/\*+|\*)\s*(eslint|@ts-|prettier|vale|biome|c8|istanbul|oxlint)/;
const DOC_PATH = String.raw`docs\/[\w./-]*\.md(?:#[\w-]+)?`;
const ISSUE_REF = String.raw`\(?#\d+\)?`;
const CITATION = new RegExp(String.raw`^(?:@?see\s+)?(?:${DOC_PATH}|${ISSUE_REF})[\s.,;:]*(?:\*\/)?$`, 'i');
const WHY = /(^|\s)Why:/;
const RUNNER = String.raw`(?:\S+\.sh|bun|sh|node|npx|npm)`;
const ENVS = String.raw`(?:[A-Z_][A-Z0-9_]*=\S*\s+)*`;
const LABEL = String.raw`(?:[A-Za-z][\w .'()+/-]{0,30}:\s+)?`;
const USAGE = new RegExp(String.raw`^${LABEL}${ENVS}${RUNNER}(?=\s|$)`, 'i');
const USAGE_HEADER = /:$/;
const CONTINUED = /\\$/;
const HEADER_MAX = 2;

type Block = { start: number; lines: string[] };

function commentBlocks(body: string): Block[] {
    const blocks: Block[] = [];
    let current: Block | null = null;
    for (const [index, line] of body.split('\n').entries()) {
        const isComment = /^\s*(\/\/|\/\*|\*)/.test(line);
        if (isComment) {
            current ??= { start: index + 1, lines: [] };
            current.lines.push(line);
        } else if (current) {
            blocks.push(current);
            current = null;
        }
    }
    if (current) blocks.push(current);
    return blocks;
}

function text(block: Block): string {
    return block.lines.map(l => l.replace(/^\s*(\/\/|\/\*+|\*\/|\*)/, '').trim()).join(' ');
}

function joinContinuations(payload: string[]): string[] {
    const joined: string[] = [];
    for (const line of payload) {
        const prev = joined.at(-1);
        if (prev !== undefined && CONTINUED.test(prev)) joined[joined.length - 1] = `${prev.replace(CONTINUED, '').trim()} ${line}`;
        else joined.push(line);
    }
    return joined;
}

function isUsageBlock(payload: string[]): boolean {
    const lines = joinContinuations(payload);
    const command = lines.map(l => USAGE.test(l));
    if (!command.some(Boolean)) return false;
    const exempt = [...command];
    let run = 0;
    for (let i = lines.length - 2; i >= 0; i--) {
        if (command[i]) { run = 0; continue; }
        const header = run === 0 ? command[i + 1] && USAGE_HEADER.test(lines[i]) : exempt[i + 1] && run < HEADER_MAX;
        if (!header) { run = 0; continue; }
        exempt[i] = true;
        run++;
    }
    return exempt.every(Boolean);
}

export function checkComments(files: string[]): Finding[] {
    const found: Finding[] = [];
    for (const file of files) {
        const source = readFileSync(file, 'utf8');
        if (isGenerated(source)) continue;
        for (const block of commentBlocks(source)) {
            if (block.lines.some(l => DIRECTIVE.test(l))) continue;
            const body = text(block);
            if (RATIONALE.test(body) && !WHY.test(body)) {
                found.push({ file, line: block.start, check: 'why-tag', message: 'Rationale comment without a Why: tag. Collapse it to one tagged line or move it to docs/decisions/.' });
            }
            const payload = block.lines.map(l => text({ start: 0, lines: [l] })).filter(l => l !== '' && !CITATION.test(l));
            const allTagged = payload.length > 0 && payload.every(l => WHY.test(l));
            if (payload.length > MAX_BLOCK && !allTagged && !isUsageBlock(payload)) {
                found.push({ file, line: block.start, check: 'comment-block', message: `${payload.length}-line comment block. Keep comments to a rare one-liner where the code is cryptic.` });
            }
        }
    }
    return found;
}

const CHECKS = ['doc-cap', 'why-tag', 'comment-block'];
const DEFAULT_GATE = ['doc-cap'];

function workingFiles(roots: string[], ext: string): string[] {
    const out = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...roots], { encoding: 'utf8' });
    if (out.status !== 0) throw new Error(`git ls-files failed: ${out.stderr.trim()}`);
    return [...new Set(out.stdout.split('\0'))].filter(path => path.endsWith(ext) && existsSync(path));
}

if (import.meta.main) {
    const gateArg = process.argv.find(a => a.startsWith('--gate='));
    const names = gateArg ? gateArg.slice('--gate='.length).split(',') : DEFAULT_GATE;
    const unknown = names.filter(name => !CHECKS.includes(name));
    if (unknown.length > 0) {
        console.error(`unknown gate name ${unknown.join(', ')}; valid names are ${CHECKS.join(', ')}`);
        process.exit(2);
    }
    const gate = new Set(names);

    const markdown = workingFiles(['docs', 'README.md', 'templates'], '.md');
    const sources = workingFiles(['src/bot', 'tools', 'test'], '.ts');
    if (markdown.length === 0 || sources.length === 0) {
        console.error(`found no source files (markdown=${markdown.length} sources=${sources.length}); run this from the repository root`);
        process.exit(2);
    }

    const findings = [...checkDocCap(markdown), ...checkComments(sources)];
    for (const f of findings) {
        const gated = gate.has(f.check) ? 'error' : 'report';
        console.log(`${f.file}:${f.line}  ${gated}  ${f.check}  ${f.message}`);
    }

    const blocking = findings.filter(f => gate.has(f.check));
    const counts = new Map<string, number>();
    for (const f of findings) counts.set(f.check, (counts.get(f.check) ?? 0) + 1);
    console.log([...counts].map(([check, n]) => `${check}=${n}`).join(' ') || 'no findings');
    if (blocking.length > 0) process.exit(1);
}
