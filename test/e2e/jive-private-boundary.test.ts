import { describe, expect, test, setSystemTime } from 'bun:test';
import { mkdtempSync, mkdirSync, symlinkSync, closeSync, writeSync, readFileSync, rmSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertEngineCwd, assertPrivatePorts, openPrivateTrace, assertPrivateUrl, candidateRoot, privateEngine } from '../../e2e/jive-private-boundary.mjs';
import { cleanupPrivate, confirmPrivateDisconnect, requirePrivateAccount, routePrivateHttp, routePrivateSocket } from '../../e2e/jive-private-session.js';

describe('private isolation', () => {
    test('rejects a cwd different from the validated engine', () => {
        expect(() => assertEngineCwd(process.cwd(), tmpdir())).toThrow();
    });
    test.each([
        { web: { port: 8890, managementPort: 8899 }, node: { port: 43596 } },
        { web: { port: 8891, managementPort: 8899 }, node: { port: 43595 } },
        { web: { port: 8891, managementPort: 8888 }, node: { port: 43596 } },
        {},
    ])('rejects missing or shared ports %#', config => {
        expect(() => assertPrivatePorts(config)).toThrow();
    });
    test('accepts only the complete private port set', () => {
        expect(() => assertPrivatePorts({ web: { port: 8891, managementPort: 8899 }, node: { port: 43596 } })).not.toThrow();
    });
    test('creates trace exclusively inside the real evidence tree', () => {
        const root = realpathSync(mkdtempSync(join(tmpdir(), 'private-boundary-')));
        try {
            const evidence = join(root, 'out/e2e');
            mkdirSync(evidence, { recursive: true });
            const path = join(evidence, 'trace.jsonl');
            const fd = openPrivateTrace(root, path);
            try { writeSync(fd, 'frame\n'); } finally { closeSync(fd); }
            expect(readFileSync(path, 'utf8')).toBe('frame\n');
            expect(() => openPrivateTrace(root, path)).toThrow();
            expect(() => openPrivateTrace(root, join(root, 'outside.jsonl'))).toThrow();
            symlinkSync(root, join(evidence, 'link'));
            expect(() => openPrivateTrace(root, join(evidence, 'link/escape.jsonl'))).toThrow();
            symlinkSync(path, join(evidence, 'alias.jsonl'));
            expect(() => openPrivateTrace(root, join(evidence, 'alias.jsonl'))).toThrow();
        } finally { rmSync(root, { recursive: true, force: true }); }
    });
    test('keeps appending through the descriptor when the path is replaced', () => {
        const root = realpathSync(mkdtempSync(join(tmpdir(), 'private-descriptor-')));
        try {
            mkdirSync(join(root, 'out/e2e'), { recursive: true });
            const path = join(root, 'out/e2e/trace.jsonl');
            const fd = openPrivateTrace(root, path);
            try {
                renameSync(path, `${path}.original`);
                writeFileSync(path, 'replacement');
                writeSync(fd, 'frame\n');
            } finally { closeSync(fd); }
            expect(readFileSync(path, 'utf8')).toBe('replacement');
            expect(readFileSync(`${path}.original`, 'utf8')).toBe('frame\n');
        } finally { rmSync(root, { recursive: true, force: true }); }
    });
    test.each(['http://localhost:8890/bot.html', 'https://w1.rs2b2t.com', 'http://localhost:8891@evil.test/', 'ws://localhost:8890/', 'ws://localhost:43596/', 'file:///tmp/a'])('rejects non-private endpoint %s', url => {
        expect(() => assertPrivateUrl(url)).toThrow();
    });
    test('aborts redirects without following or fulfilling them', async () => {
        const actions: string[] = [];
        await routePrivateHttp({
            request: () => ({ url: () => 'http://localhost:8891/bot.html', redirectedFrom: () => null }),
            fetch: async options => { expect(options.maxRedirects).toBe(0); return { status: () => 302, headers: () => ({}), body: async () => Buffer.from('') }; },
            abort: async () => { actions.push('abort'); },
            fulfill: async () => { actions.push('fulfill'); },
        });
        expect(actions).toEqual(['abort']);
    });
    test('rejects shared HTTP before making a request', async () => {
        const actions: string[] = [];
        await routePrivateHttp({
            request: () => ({ url: () => 'http://localhost:8890/bot.html', redirectedFrom: () => null }),
            fetch: async () => { actions.push('fetch'); throw new Error('must not fetch'); },
            abort: async () => { actions.push('abort'); },
            fulfill: async () => { actions.push('fulfill'); },
        });
        expect(actions).toEqual(['abort']);
    });
    test('connects only the private WebSocket endpoint', async () => {
        const actions: string[] = [];
        await routePrivateSocket({ url: () => 'ws://localhost:8891/', close: async () => { actions.push('close'); }, connectToServer: () => { actions.push('connect'); } });
        expect(actions).toEqual(['connect']);
    });
    test.each(['ws://localhost:8890/', 'wss://w1.rs2b2t.com/', 'ws://localhost:43596/'])('never connects rejected WebSocket %s', async url => {
        const actions: string[] = [];
        await routePrivateSocket({ url: () => url, close: async () => { actions.push('close'); }, connectToServer: () => { actions.push('connect'); } });
        expect(actions).toEqual(['close']);
    });
    test('absence blocks the mutation callback', async () => {
        let mutated = false;
        await expect(requirePrivateAccount({ at: Date.now(), engine: privateEngine, candidate: candidateRoot, players: [] }, 'account', async () => { mutated = true; })).rejects.toThrow('before mutation');
        expect(mutated).toBe(false);
    });
    test('allows mutation for the sole fresh attested account', async () => {
        const frame = { at: Date.now(), engine: privateEngine, candidate: candidateRoot, players: [{ username: 'account' }] };
        expect(await requirePrivateAccount(frame, 'account', async () => 'mutated')).toBe('mutated');
    });
    test.each([
        { at: 0, engine: privateEngine, candidate: candidateRoot, players: [{ username: 'account' }] },
        { at: Date.now(), engine: '/shared/engine', candidate: candidateRoot, players: [{ username: 'account' }] },
        { at: Date.now(), engine: privateEngine, candidate: candidateRoot, players: [{ username: 'other' }] },
        { at: Date.now(), engine: privateEngine, candidate: candidateRoot, players: [{ username: 'account' }, { username: 'other' }] },
    ])('rejects stale, shared, or nonexclusive observer account %#', async frame => {
        let mutated = false;
        await expect(requirePrivateAccount(frame, 'account', async () => { mutated = true; })).rejects.toThrow();
        expect(mutated).toBe(false);
    });
    test.each([0, 1, 2])('cleanup attempts every step when step %i throws', async failing => {
        const actions: number[] = [];
        const steps = [0, 1, 2, 3].map(n => async () => { actions.push(n); if (n === failing) throw new Error('injected'); });
        await expect(cleanupPrivate(steps)).rejects.toThrow();
        expect(actions).toEqual([0, 1, 2, 3]);
    });
    test('confirms fresh disconnect independently when closure evidence fails', async () => {
        const root = mkdtempSync(join(tmpdir(), 'private-disconnect-'));
        const at = 1800000000000;
        setSystemTime(at);
        try {
            const server = join(root, 'server.jsonl');
            writeFileSync(server, JSON.stringify({ at, engine: privateEngine, candidate: candidateRoot, players: [] }) + '\n');
            const confirmations: unknown[] = [];
            await expect(cleanupPrivate([
                async () => { throw new Error('closed.json write failed'); },
                async () => { confirmations.push(await confirmPrivateDisconnect(server, 'account')); },
            ])).rejects.toThrow();
            expect(confirmations).toEqual([{ user: 'account', serverAt: at, present: false }]);
        } finally { setSystemTime(); rmSync(root, { recursive: true, force: true }); }
    });
    test('rejects stale disconnect evidence', async () => {
        const root = mkdtempSync(join(tmpdir(), 'private-stale-'));
        try {
            const server = join(root, 'server.jsonl');
            writeFileSync(server, JSON.stringify({ at: 0, engine: privateEngine, candidate: candidateRoot, players: [] }) + '\n');
            await expect(confirmPrivateDisconnect(server, 'account')).rejects.toThrow('fresh private observer required');
        } finally { rmSync(root, { recursive: true, force: true }); }
    });
});
