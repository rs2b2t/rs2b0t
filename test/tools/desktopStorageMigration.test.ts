import { afterEach, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

const sessionModule = new URL('../../desktop/storage-session.cjs', import.meta.url);
const require = createRequire(sessionModule);
const { sharedStorage } = require('./shared-storage.cjs');
const accounts = 'rs2b0t:multibox:accounts';
const profiles = Array.from({ length: 30 }, (_, i) => ({ username: `fixture-${i}`, password: 'fixture' }));
const custom = 'http://localhost:8082';
const original = 'http://localhost:8081';
const directories: string[] = [];
afterEach(() => {
    for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(origins: Record<string, Record<string, string>>) {
    const dir = mkdtempSync(join(tmpdir(), 'rs2b0t-migration-'));
    directories.push(dir);
    mkdirSync(join(dir, 'Local Storage'));
    writeFileSync(join(dir, 'Local Storage', 'fixture.json'), JSON.stringify(origins));
    const storeDir = join(dir, 'Shared Storage');
    const store = sharedStorage(storeDir);

    async function launch(server: string) {
        let runtime = '';
        const app = Object.assign(new EventEmitter(), {
            getPath: () => dir,
            setPath: (_name: string, path: string) => { runtime = path; }
        });
        const handlers = new Map<string, (request: { url: string }) => Response>();
        const electron = {
            ipcMain: new EventEmitter(),
            session: { defaultSession: { protocol: {
                handle: (scheme: string, handler: (request: { url: string }) => Response) => handlers.set(scheme, handler),
                unhandle: (scheme: string) => handlers.delete(scheme)
            } } },
            BrowserWindow: class {
                origin = '';
                loadURL(url: string) {
                    const parsed = new URL(url);
                    expect(handlers.get(parsed.protocol.slice(0, -1))?.({ url })).toBeInstanceOf(Response);
                    this.origin = parsed.origin;
                }
                webContents = { executeJavaScript: (source: string) => {
                    const legacy = JSON.parse(readFileSync(join(runtime, 'Local Storage', 'fixture.json'), 'utf8'));
                    return runInNewContext(source, { localStorage: legacy[this.origin] ?? {} });
                } };
                destroy() {}
            }
        };
        const module = { exports: {} as { prepareStorage: (app: unknown, url: string) => { start: () => Promise<void> } } };
        runInNewContext(readFileSync(sessionModule, 'utf8'), {
            module, URL, Response, process: { env: { B0T_PROFILE_DIR: dir, B0T_RUNTIME_DIR: dir } },
            require: (name: string) => name === 'electron' ? electron : require(name)
        });
        try {
            await module.exports.prepareStorage(app, server + '/bot.html?fixture=1').start();
        } finally {
            app.emit('quit');
        }
        expect(handlers.size).toBe(0);
        return JSON.parse(store.getItem(accounts) ?? '[]');
    }
    return { launch, store, storeDir };
}

test.each([
    [custom, custom], [original, original], [original, custom],
    ['https://fixture.invalid', 'https://fixture.invalid']
])('recovers profiles from %s across two launches on %s', async (legacy, server) => {
    const { launch } = fixture({ [legacy]: { [accounts]: JSON.stringify(profiles) } });
    const first = await launch(server);
    const second = await launch(server);
    expect([first.length, second.length]).toEqual([30, 30]);
    expect(first).toEqual(profiles);
    expect(second).toEqual(profiles);
});

test('an old empty migration can recover profiles alongside newer shared settings', async () => {
    const key = 'rs2b0t:setting';
    const { launch, storeDir, store } = fixture({ [custom]: { [accounts]: JSON.stringify(profiles), [key]: 'old' } });
    writeFileSync(join(storeDir, 'storage.json'), JSON.stringify({ initialized: true, data: {} }));
    store.setItem(key, 'new');
    expect(await launch(custom)).toEqual(profiles);
    expect(store.getItem(key)).toBe('new');
    store.removeItem(accounts);
    expect(await launch(custom)).toEqual([]);
});

test.each([accounts, 'rs2b0t:multibox:profiles'])('recovery preserves newer saved profiles when the legacy key is %s', async legacyKey => {
    const { launch, storeDir, store } = fixture({ [custom]: { [legacyKey]: JSON.stringify(profiles) } });
    const current = [{ username: 'current', password: 'fixture' }];
    writeFileSync(join(storeDir, 'storage.json'), JSON.stringify({ initialized: true, data: { [accounts]: JSON.stringify(current) } }));
    expect(await launch(custom)).toEqual(current);
    expect(store.getItem('rs2b0t:multibox:profiles')).toBeNull();
});

test('profiles on the configured origin take precedence over the 8081 fallback', async () => {
    const { launch } = fixture({
        [custom]: { [accounts]: JSON.stringify(profiles) },
        [original]: { [accounts]: JSON.stringify([{ username: 'fallback', password: 'fixture' }]) }
    });
    expect(await launch(custom)).toEqual(profiles);
});
