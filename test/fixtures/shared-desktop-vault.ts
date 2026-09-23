import assert from 'node:assert/strict';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

GlobalRegistrator.register();
const directory = mkdtempSync(join(tmpdir(), 'rs2b0t-shared-vault-'));
const require = createRequire(import.meta.url);
const { sharedStorage } = require('../../desktop/shared-storage.cjs');
const store = sharedStorage(directory);
window.rs2b0tDesktopStorage = { ...store, subscribe() {} };
Object.defineProperty(globalThis, 'rs2b0tDesktopStorage', { configurable: true, value: window.rs2b0tDesktopStorage });
await import('../../src/bot/panel/desktopStorage.js');
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: window.localStorage });
const { ProfileVault } = await import('../../src/bot/multibox/ProfileVault.js');
const { SettingsStore } = await import('../../src/bot/runtime/Settings.js');
try {
    SettingsStore.save('Miner', 'ore', 'Tin');
    store.setItem('rs2b0t:set:Miner:ore', 'Iron');
    assert.equal(SettingsStore.saved('Miner', 'ore'), 'Iron');
    assert.ok(Object.keys(localStorage).includes('rs2b0t:set:Miner:ore'));
    const first = new ProfileVault();
    await first.setup('fixture-passphrase');
    const second = new ProfileVault();
    assert.equal(await second.unlock('fixture-passphrase'), true);
    await first.saveTabState(['Mining'], new Map(), 'Mining');
    await second.refresh();
    await second.saveTabState(['Fishing'], new Map(), 'Fishing');
    await first.refresh();
    assert.deepEqual(first.tabState().tabs.sort(), ['Fishing', 'Mining']);
    await first.unlock('fixture-passphrase');
    await first.saveTabState(['Fishing', 'Mining'], new Map(), 'Fishing');
    await second.unlock('fixture-passphrase');
    assert.deepEqual(second.tabState().tabs, ['Fishing', 'Mining']);
    await first.saveTabState(['Fishing'], new Map(), 'Fishing');
    await second.saveTabState(['Fishing', 'Mining', 'Woodcutting'], new Map(), 'Woodcutting');
    await first.refresh();
    assert.deepEqual(first.tabState().tabs, ['Fishing', 'Woodcutting']);
    await Promise.all([first.upsert({ username: 'first', password: 'one', world: 1 }), second.upsert({ username: 'second', password: 'two', world: 2 })]);
    const reopened = new ProfileVault();
    assert.equal(await reopened.unlock('fixture-passphrase'), true);
    assert.deepEqual(
        reopened
            .list()
            .map(p => p.username)
            .sort(),
        ['first', 'second']
    );
    await Promise.all([first.setWorld('first', 2), second.upsert({ username: 'first', password: 'updated' })]);
    await reopened.unlock('fixture-passphrase');
    assert.deepEqual(
        reopened.list().find(p => p.username === 'first'),
        { username: 'first', password: 'updated', world: 2, tab: 'Main' }
    );
    await second.refresh();
    assert.equal(second.list().find(p => p.username === 'first')?.password, 'updated');
    first.reset();
    await second.refresh();
    assert.equal(second.status(), 'empty');
    const results = await Promise.allSettled([first.setup('one'), second.setup('two')]);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    const loser = results[0].status === 'rejected' ? first : second;
    assert.equal(loser.status(), 'locked');
    await assert.rejects(loser.setup('retry'), /locked/);
    console.log('shared vault preserves concurrent account and world edits');
} finally {
    rmSync(directory, { recursive: true, force: true });
    await GlobalRegistrator.unregister();
}
