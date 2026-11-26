import { afterEach, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { ProfileVault } from '#/bot/multibox/ProfileVault.js';

const sessionModule = new URL('../../desktop/storage-session.cjs', import.meta.url);
const require = createRequire(sessionModule);
const { sharedStorage } = require('./shared-storage.cjs');
const vault = 'rs2b0t:multibox:profiles';
const accounts = 'rs2b0t:multibox:accounts';
const profiles = Array.from({ length: 30 }, (_, i) => ({ username: `fixture-${i}`, password: 'fixture' }));
const custom = 'http://localhost:8082';
const original = 'http://localhost:8081';
const directories: string[] = [];
afterEach(() => {
    for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(origins?: Record<string, Record<string, string>>) {
    const dir = mkdtempSync(join(tmpdir(), 'rs2b0t-migration-'));
    directories.push(dir);
    function saveLegacy(values: Record<string, Record<string, string>>) {
        mkdirSync(join(dir, 'Local Storage'), { recursive: true });
        writeFileSync(join(dir, 'Local Storage', 'fixture.json'), JSON.stringify(values));
    }
    if (origins) saveLegacy(origins);
    const storeDir = join(dir, 'Shared Storage');
    const store = sharedStorage(storeDir);

    let rendererStorage: Partial<Record<string, string>> = {};

    async function launch(server: string, recover = false) {
        let runtime = '';
        let startupError: unknown;
        const opened = Promise.withResolvers<void>();
        const app = Object.assign(new EventEmitter(), {
            getPath: () => dir,
            setPath: (_name: string, path: string) => { runtime = path; },
            commandLine: { appendSwitch() {}, getSwitchValue: () => '' },
            whenReady: () => Promise.resolve(),
            quit: () => opened.reject(new Error('app.quit', { cause: startupError }))
        });
        const handlers = new Map<string, (request: { url: string }) => Response>();
        function nativeStorage(origin: string): Record<string, string> {
            const file = join(runtime, 'Local Storage', 'fixture.json');
            return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8'))[origin] ?? {} : {};
        }
        const electron = {
            app,
            Menu: { buildFromTemplate() {}, setApplicationMenu() {} },
            powerSaveBlocker: { start() {} },
            ipcMain: new EventEmitter(),
            session: { defaultSession: { protocol: {
                handle: (scheme: string, handler: (request: { url: string }) => Response) => handlers.set(scheme, handler),
                unhandle: (scheme: string) => handlers.delete(scheme)
            }, clearStorageData: ({ storages }: { storages: string[] }) => {
                if (storages.includes('localstorage')) rmSync(join(runtime, 'Local Storage'), { recursive: true, force: true });
            } } },
            BrowserWindow: class {
                constructor(readonly options: { show?: boolean }) {}
                origin = '';
                loadURL(url: string) {
                    const parsed = new URL(url);
                    if (this.options.show !== false) {
                        rendererStorage = nativeStorage(parsed.origin);
                        return opened.resolve();
                    }
                    expect(handlers.get(parsed.protocol.slice(0, -1))?.({ url })).toBeInstanceOf(Response);
                    this.origin = parsed.origin;
                }
                webContents = { on() {}, executeJavaScript: (source: string) => {
                    return runInNewContext(source, { localStorage: nativeStorage(this.origin) });
                } };
                destroy() {}
            }
        };
        const module = { exports: {} };
        const env = { B0T_PROFILE_DIR: dir, B0T_RUNTIME_DIR: dir, B0T_RECOVER_LEGACY_PROFILES: recover ? '1' : undefined };
        const context = {
            module, URL, Response, process: { argv: [`--server=${server}/bot.html?fixture=1`], env },
            require: (name: string) => name === 'electron' ? electron : require(name)
        };
        runInNewContext(readFileSync(sessionModule, 'utf8'), context);
        try {
            runInNewContext(readFileSync(new URL('./main.cjs', sessionModule), 'utf8'), {
                ...context, __dirname: join(import.meta.dir, '../../desktop'),
                console: { error: (error: unknown) => { startupError = error; } },
                require: (name: string) => name === './storage-session.cjs' ? module.exports : context.require(name)
            });
            await opened.promise;
        } finally {
            app.emit('quit');
        }
        expect(handlers.size).toBe(0);
        return JSON.parse(store.getItem(accounts) ?? '[]');
    }
    return { launch, saveLegacy, store, storeDir, rendererStorage: () => rendererStorage };
}

test('a malformed server URL is logged and quits through the startup error handler', async () => {
    const { launch } = fixture({});
    await expect(launch('malformed')).rejects.toMatchObject({ message: 'app.quit', cause: { code: 'ERR_INVALID_URL' } });
});

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

test.each([custom, original])('an initialized empty store stays empty until recovery is requested on %s', async server => {
    const { launch, storeDir } = fixture({ [server]: { [accounts]: JSON.stringify(profiles) } });
    writeFileSync(join(storeDir, 'storage.json'), JSON.stringify({ initialized: true, data: {} }));
    expect([(await launch(server)).length, (await launch(server)).length]).toEqual([0, 0]);
    expect(await launch(server, true)).toEqual(profiles);
    expect(await launch(server)).toEqual(profiles);
});

test('an old empty migration can recover profiles alongside newer shared settings', async () => {
    const key = 'rs2b0t:setting';
    const { launch, storeDir, store } = fixture({ [custom]: { [accounts]: JSON.stringify(profiles), [key]: 'old' } });
    writeFileSync(join(storeDir, 'storage.json'), JSON.stringify({ initialized: true, data: {} }));
    store.setItem(key, 'new');
    expect(await launch(custom, true)).toEqual(profiles);
    expect(store.getItem(key)).toBe('new');
    store.removeItem(accounts);
    expect(await launch(custom)).toEqual([]);
});

test.each([accounts, 'rs2b0t:multibox:profiles'])('recovery preserves newer saved profiles when the legacy key is %s', async legacyKey => {
    const { launch, storeDir, store } = fixture({ [custom]: { [legacyKey]: JSON.stringify(profiles) } });
    const current = [{ username: 'current', password: 'fixture' }];
    writeFileSync(join(storeDir, 'storage.json'), JSON.stringify({ initialized: true, data: { [accounts]: JSON.stringify(current) } }));
    expect(await launch(custom, true)).toEqual(current);
    expect(store.getItem('rs2b0t:multibox:profiles')).toBeNull();
});

test('explicit recovery leaves an existing vault intact', async () => {
    const current = JSON.stringify({ v: 1, iter: 310000, salt: 'fixture', iv: 'fixture', ct: 'current' });
    const { launch, storeDir, store } = fixture({ [custom]: { [vault]: 'older', [accounts]: JSON.stringify(profiles) } });
    writeFileSync(join(storeDir, 'storage.json'), JSON.stringify({ initialized: true, data: { [vault]: current, [accounts]: '[]' } }));
    expect(await launch(custom, true)).toEqual([]);
    expect(store.snapshot()).toEqual({ [vault]: current, [accounts]: '[]' });
});

test('profiles on the configured origin take precedence over the 8081 fallback', async () => {
    const { launch } = fixture({
        [custom]: { [accounts]: JSON.stringify(profiles) },
        [original]: { [accounts]: JSON.stringify([{ username: 'fallback', password: 'fixture' }]) }
    });
    expect(await launch(custom)).toEqual(profiles);
});

test.each([[accounts, accounts], [vault, accounts], [accounts, vault]])(
    'explicit recovery replaces an empty %s roster with profiles from %s', async (emptyKey, sourceKey) => {
        const saved = JSON.stringify(profiles);
        const { launch, store } = fixture({ [custom]: { [sourceKey]: saved }, [original]: { [accounts]: '[]' } });
        store.seed({ [emptyKey]: '[]' });
        await launch(custom);
        expect(store.snapshot()).toEqual({ [emptyKey]: '[]' });
        await launch(custom, true);
        expect(store.snapshot()).toEqual({ [sourceKey]: saved });
        await launch(custom);
        expect(store.snapshot()).toEqual({ [sourceKey]: saved });
    }
);

test('profile recovery keeps cleared settings out of shared and renderer storage', async () => {
    const setting = 'rs2b0t:set:Miner:ore';
    const selected = 'rs2b0t:fixture:selectedScript';
    const { launch, store, rendererStorage } = fixture({
        [custom]: { [accounts]: JSON.stringify(profiles), [setting]: 'Tin', [selected]: 'Miner' },
        [original]: { 'rs2b0t:fallback': 'old' }
    });
    store.seed({});
    expect(await launch(custom, true)).toEqual(profiles);
    expect({
        shared: store.keys().sort(),
        nativeSetting: rendererStorage()[setting],
        nativeScript: rendererStorage()[selected]
    }).toEqual({ shared: [accounts], nativeSetting: undefined, nativeScript: undefined });
});

test('explicit recovery can use the fallback when the configured origin has only an empty roster', async () => {
    const { launch, store } = fixture({ [custom]: { [vault]: '[]' }, [original]: { [accounts]: JSON.stringify(profiles) } });
    store.seed({ [vault]: '[]' });
    expect(await launch(custom, true)).toEqual(profiles);
    expect(store.getItem(vault)).toBeNull();
});

test('first migration skips an empty configured roster across two launches', async () => {
    const { launch, store } = fixture({ [custom]: { [vault]: '[]' }, [original]: { [accounts]: JSON.stringify(profiles) } });
    const first = await launch(custom);
    const second = await launch(custom);
    expect([first.length, second.length]).toEqual([30, 30]);
    expect(store.snapshot()).toEqual({ [accounts]: JSON.stringify(profiles) });
});

test('a fresh installation keeps a deleted roster empty when legacy storage appears later', async () => {
    const { launch, saveLegacy, store } = fixture();
    await launch(custom);
    store.setItem(accounts, JSON.stringify(profiles));
    store.removeItem(accounts);
    saveLegacy({ [custom]: { [accounts]: JSON.stringify(profiles) } });
    expect(await launch(custom)).toEqual([]);
    expect(await launch(custom, true)).toEqual(profiles);
});

test.each([
    ['truncated JSON', '[{"username":'],
    ['invalid roster', '[{"name":"fixture"}]'],
    ['missing ciphertext', '{"v":1,"iter":310000}'],
    ['invalid vault encoding', '{"v":1,"iter":310000,"salt":"!","iv":"!","ct":"!"}']
])('recovery skips %s and imports the populated fallback', async (_, value) => {
    const { launch, store } = fixture({ [custom]: { [vault]: value }, [original]: { [accounts]: JSON.stringify(profiles) } });
    store.seed({});
    expect((await launch(custom, true)).length).toBe(30);
    expect(store.getItem(vault)).toBeNull();
    expect(await launch(custom)).toEqual(profiles);
});

test('an invalid source on first launch leaves room for explicit recovery later', async () => {
    const { launch, saveLegacy, store } = fixture({ [custom]: { [vault]: '{' } });
    await launch(custom);
    saveLegacy({ [custom]: { [accounts]: JSON.stringify(profiles) } });
    expect(await launch(custom, true)).toEqual(profiles);
    expect(store.getItem(vault)).toBeNull();
});

test('a migrated encrypted vault can be unlocked on the next launch', async () => {
    const { launch, saveLegacy, store } = fixture();
    const source = fixture().store;
    source.setItem(accounts, JSON.stringify(profiles));
    await new ProfileVault(source).setup('fixture');
    const saved = source.getItem(vault);
    saveLegacy({ [custom]: { [vault]: saved }, [original]: { [accounts]: JSON.stringify(profiles) } });
    await launch(custom);
    await launch(custom);
    expect(store.snapshot()).toEqual({ [vault]: saved });
    const reopened = new ProfileVault(store);
    expect(await reopened.unlock('fixture')).toBe(true);
    expect(reopened.list()).toEqual(profiles.map(profile => ({ ...profile, tab: 'Main' })));
});
