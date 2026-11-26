import '../setup-dom.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import type { DesktopStorage } from '#/bot/runtime/desktopStorage.js';

const users = Array.from({ length: Number(process.argv[2]) }, (_, i) => `user${i}`);
const expected: Record<string, Record<string, string>> = {};
const data: Record<string, string> = {};
const untouched: Record<string, string> = {};
for (const user of users) {
    expected[user] = {};
    for (let i = 0; i < 16; i++) {
        const suffix = i === 0 ? 'selectedScript' : `set:Test:${i}`;
        const key = `rs2b0t:${user}:${suffix}`;
        const value = `${user}-${i}`;
        expected[user][suffix] = value;
        data[key] = value;
        if (user !== 'user0' && user !== 'user1') untouched[key] = value;
    }
}

let keyReads = 0;
let syncReads = 0;
let version = 0;
let receiveSnapshot!: (event: null, snapshot: { version: number; data: Record<string, string> }) => void;
runInNewContext(readFileSync(new URL('../../desktop/preload.cjs', import.meta.url), 'utf8'), {
    queueMicrotask,
    require: () => ({
        contextBridge: {
            exposeInMainWorld(name: string, api: DesktopStorage) {
                Reflect.set(globalThis, name, { ...api, keys() { keyReads++; return api.keys(); } });
            }
        },
        ipcRenderer: {
            on(_: string, listener: typeof receiveSnapshot) { receiveSnapshot = listener; },
            sendSync(_: string, method: string, key: string, value: string) {
                if (method === 'getItem') {
                    syncReads++;
                    return { value: data[key] ?? null };
                }
                if (method === 'removeItem') delete data[key];
                else if (method === 'setItem') data[key] = value;
                else assert.equal(method, 'snapshot');
                return { snapshot: { version: version++, data: { ...data } } };
            }
        }
    })
});
if (process.argv.includes('--migrate')) {
    localStorage.setItem('rs2b0t:set-profile-settings-v1', '1');
    localStorage.setItem('rs2b0t:set:set:Global:runEnergyMin', '42');
}
await import('../../src/bot/panel/desktopStorage.js');
if (process.argv.includes('--settings')) {
    const { SettingsStore } = await import('../../src/bot/runtime/Settings.js');
    const browser = Reflect.get(window, 'happyDOM') as { setURL(url: string): void };
    browser.setURL('http://localhost/bot.html?box=set');
    sessionStorage.clear();
    const threshold = SettingsStore.globalBag().num('runEnergyMin');
    const report = { threshold, syncReads, keyReads };
    if (process.argv.includes('--migrate')) {
        assert.equal(data['rs2b0t:set:set:Global:runEnergyMin'], '42');
        assert.equal(data['rs2b0t:set-profile-settings-v1'], '1');
    }
    const { boxKey } = await import('../../src/bot/runtime/box.js');
    const key = boxKey('set:Global:runEnergyMin', 'set');
    data[key] = '73';
    receiveSnapshot(null, { version: version++, data: { ...data } });
    await Promise.resolve();
    assert.equal(SettingsStore.globalBag().num('runEnergyMin'), 73);
    const reads = syncReads;
    assert.equal(SettingsStore.globalBag().num('runEnergyMin'), 73);
    assert.equal(syncReads, reads);
    SettingsStore.save('Global', 'runEnergyMin', '65');
    assert.equal(SettingsStore.globalBag().num('runEnergyMin'), 65);
    SettingsStore.clear('Global', 'runEnergyMin');
    assert.equal(SettingsStore.globalBag().num('runEnergyMin'), 20);
    console.log(JSON.stringify(report));
    process.exit(0);
}
const { collectBoxStorage, applyBoxStorage } = await import('../../src/bot/multibox/ProfileTransfer.js');

sessionStorage.setItem('rs2b0t:user1:selectedScript', 'stale');
sessionStorage.setItem('rs2b0t:user1:set:Test:1', 'override');
sessionStorage.setItem('rs2b0t:user10:set:Test:only', 'session only');
expected.user1['set:Test:1'] = 'override';
expected.user10['set:Test:only'] = 'session only';
assert.deepEqual(collectBoxStorage(users), expected);
const exportReads = keyReads;

keyReads = 0;
applyBoxStorage({ user0: { imported: 'new' } }, ['user1']);
assert.deepEqual(data, { ...untouched, 'rs2b0t:user0:imported': 'new' });
assert.equal(sessionStorage.length, 2);
assert.equal(sessionStorage.getItem('rs2b0t:user0:imported'), 'new');
assert.equal(sessionStorage.getItem('rs2b0t:user10:set:Test:only'), 'session only');
console.log(JSON.stringify({ exportReads, importReads: keyReads }));
