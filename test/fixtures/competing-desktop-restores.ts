import '../setup-dom.js';
import type { DesktopStorage } from '../../src/bot/runtime/desktopStorage.js';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [scenario = 'restore', peer] = process.argv.slice(2);
const directory = peer ?? mkdtempSync(join(tmpdir(), 'vault-restore-'));
const { sharedStorage } = createRequire(import.meta.url)('../../desktop/shared-storage.cjs');
const store = sharedStorage(directory);
const standalone = 'rs2b0t:set:Global:runEnergyMin';
const bridge: DesktopStorage = { ...store, subscribe() {} };
Object.defineProperty(globalThis, 'rs2b0tDesktopStorage', { value: bridge });
await import('../../src/bot/panel/desktopStorage.js');
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: window.localStorage });
const { ProfileVault } = await import('../../src/bot/multibox/ProfileVault.js');
const vault = new ProfileVault();
const suffix = 'set:Global:runEnergyMin';
const key = 'rs2b0t:set:set%3AGlobal%3ArunEnergyMin';
const restore = (value: string) => vault.replaceAll({ profiles: [{ username: 'set', password: '' }], tabs: [], activeTab: 'Main' }, {
    set: { [suffix]: value }
});

try {
    if (peer) {
        assert.ok(await vault.unlock('fixture'));
        if (scenario === 'restore') await restore('73');
        else await vault.setWorld('set', 3);
    } else {
        await vault.setup('fixture');
        await vault.upsert({ username: 'previous', password: '' });
        store.setItem(standalone, '61');
        let beforeWinner: string | null = null;
        const runPeer = () => {
            const other = Bun.spawnSync([process.execPath, import.meta.path, scenario, directory]);
            assert.equal(other.exitCode, 0, other.stderr.toString());
        };
        bridge.restoreProfiles = (...args) => {
            assert.equal(store.restoreProfiles(...args), true);
            beforeWinner = store.getItem(key);
            if (scenario !== 'edit-during-cleanup') runPeer();
            return true;
        };
        if (scenario === 'edit-during-cleanup') {
            bridge.compareAndSet = (...args) => {
                bridge.compareAndSet = store.compareAndSet;
                runPeer();
                return store.compareAndSet(...args);
            };
        }
        if (scenario === 'restore') {
            await assert.rejects(restore('42'), /changed/);
        } else {
            await restore('42');
            assert.equal(vault.list()[0].world, 3);
            const fresh = new ProfileVault();
            assert.ok(await fresh.unlock('fixture'));
            assert.equal(fresh.list()[0].world, 3);
            assert.equal(store.getItem(key), '42');
            const previous = 'rs2b0t:previous:selectedScript';
            store.setItem(previous, 'Miner');
            bridge.restoreProfiles = store.restoreProfiles;
            await fresh.replaceAll(fresh.snapshot(), { set: { [suffix]: '42' } });
            assert.equal(store.getItem(previous), 'Miner');
        }
        const reopened = sharedStorage(directory);
        assert.equal(reopened.getItem(key), scenario === 'restore' ? '73' : '42');
        assert.equal(reopened.getItem(standalone), '61');
        assert.equal(beforeWinner, '42');
    }
} finally {
    if (!peer) rmSync(directory, { recursive: true, force: true });
}
