import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, statSync, utimesSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { sharedStorage } = require('../../desktop/shared-storage.cjs');

test('shared encrypted vault preserves simultaneous changes from two instances', async () => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, '../fixtures/shared-desktop-vault.ts')], { stdout: 'pipe', stderr: 'pipe' });
    const [code, output, errors] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ code, errors }).toEqual({ code: 0, errors: '' });
    expect(output).toContain('shared vault preserves concurrent account and world edits');
});

test('desktop instances share saved values and preserve concurrent writes to different keys', () => {
    const root = mkdtempSync(join(tmpdir(), 'rs2b0t-shared-test-'));
    try {
        const first = sharedStorage(root);
        const second = sharedStorage(root);
        first.setItem('rs2b0t:account', 'first');
        expect(second.getItem('rs2b0t:account')).toBe('first');
        second.setItem('rs2b0t:settings', 'second');
        expect(first.getItem('rs2b0t:settings')).toBe('second');
        expect(first.keys().sort()).toEqual(['rs2b0t:account', 'rs2b0t:settings']);
        first.removeItem('rs2b0t:account');
        expect(second.getItem('rs2b0t:account')).toBe(null);
        expect(sharedStorage(root).getItem('rs2b0t:settings')).toBe('second');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('unchanged mutations preserve the settings file and compare-and-set results', () => {
    const root = mkdtempSync(join(tmpdir(), 'rs2b0t-shared-test-'));
    try {
        const store = sharedStorage(root);
        const key = 'rs2b0t:fixture:selectedScript';
        store.setItem(key, 'Miner');
        store.seed({});
        expect(sharedStorage(root).initialized()).toBe(true);

        const file = join(root, 'storage.json');
        utimesSync(file, 1234567890, 1234567890);
        const before = statSync(file).mtimeMs;
        store.setItem(key, 'Miner');
        store.removeItem('rs2b0t:missing');
        expect(store.compareAndSet(key, 'stale', 'Fisher')).toBe(false);
        expect(store.compareAndSet(key, 'Miner', 'Miner')).toBe(true);
        store.seed({ 'rs2b0t:missing': 'legacy' });
        expect(statSync(file).mtimeMs).toBe(before);

        expect(store.compareAndSet(key, 'Miner', 'Fisher')).toBe(true);
        expect(sharedStorage(root).snapshot()).toEqual({ [key]: 'Fisher' });
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('legacy migration cannot replace a value saved by a running instance', () => {
    const root = mkdtempSync(join(tmpdir(), 'rs2b0t-shared-test-'));
    try {
        const storage = sharedStorage(root);
        storage.setItem('rs2b0t:account', 'current');
        storage.seed({ 'rs2b0t:account': 'legacy', 'rs2b0t:settings': 'saved', unrelated: 'ignored' });
        expect(storage.getItem('rs2b0t:account')).toBe('current');
        expect(storage.getItem('rs2b0t:settings')).toBe('saved');
        expect(storage.getItem('unrelated')).toBe(null);
        storage.removeItem('rs2b0t:account');
        storage.seed({ 'rs2b0t:account': 'legacy' });
        expect(storage.getItem('rs2b0t:account')).toBe(null);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
