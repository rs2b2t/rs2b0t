import '../setup-dom.js';
import type { DesktopStorage } from '../../src/bot/runtime/desktopStorage.js';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const peer = process.argv[2];
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
        await restore('73');
    } else {
        await vault.setup('fixture');
        store.setItem(standalone, '61');
        let beforeWinner: string | null = null;
        bridge.restoreProfiles = (...args) => {
            assert.equal(store.restoreProfiles(...args), true);
            beforeWinner = store.getItem(key);
            const winner = Bun.spawnSync([process.execPath, import.meta.path, directory]);
            assert.equal(winner.exitCode, 0, winner.stderr.toString());
            assert.equal(store.getItem(key), '73');
            return true;
        };
        await assert.rejects(restore('42'), /changed/);
        const reopened = sharedStorage(directory);
        assert.equal(reopened.getItem(key), '73');
        assert.equal(reopened.getItem(standalone), '61');
        assert.equal(beforeWinner, '42');
    }
} finally {
    if (!peer) rmSync(directory, { recursive: true, force: true });
}
