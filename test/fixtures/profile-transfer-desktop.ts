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
let version = 0;
runInNewContext(readFileSync(new URL('../../desktop/preload.cjs', import.meta.url), 'utf8'), {
    queueMicrotask,
    require: () => ({
        contextBridge: {
            exposeInMainWorld(name: string, api: DesktopStorage) {
                Reflect.set(globalThis, name, { ...api, keys() { keyReads++; return api.keys(); } });
            }
        },
        ipcRenderer: {
            on() {},
            sendSync(_: string, method: string, key: string, value: string) {
                if (method === 'getItem') return { value: data[key] ?? null };
                if (method === 'removeItem') delete data[key];
                else if (method === 'setItem') data[key] = value;
                else assert.equal(method, 'snapshot');
                return { snapshot: { version: version++, data: { ...data } } };
            }
        }
    })
});
await import('../../src/bot/panel/desktopStorage.js');
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
