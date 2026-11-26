import { afterEach, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URL } from 'node:url';
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
        const electron = {
            app,
            Menu: { buildFromTemplate() {}, setApplicationMenu() {} },
            powerSaveBlocker: { start() {} },
            ipcMain: new EventEmitter(),
            session: { defaultSession: { protocol: {
                handle: (scheme: string, handler: (request: { url: string }) => Response) => handlers.set(scheme, handler),
                unhandle: (scheme: string) => handlers.delete(scheme)
            } } },
            BrowserWindow: class {
                constructor(readonly options: { show?: boolean }) {}
                origin = '';
                loadURL(url: string) {
                    if (this.options.show !== false) return opened.resolve();
                    const parsed = new URL(url);
                    expect(handlers.get(parsed.protocol.slice(0, -1))?.({ url })).toBeInstanceOf(Response);
                    this.origin = parsed.origin;
                }
                webContents = { on() {}, executeJavaScript: (source: string) => {
                    const legacy = JSON.parse(readFileSync(join(runtime, 'Local Storage', 'fixture.json'), 'utf8'));
                    return runInNewContext(source, { localStorage: legacy[this.origin] ?? {} });
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
    return { launch, store, storeDir };
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
    const vault = 'rs2b0t:multibox:profiles';
    const current = JSON.stringify({ v: 1, iter: 310000, salt: 'fixture', iv: 'fixture', ct: 'current' });
    const { launch, storeDir, store } = fixture({ [custom]: { [vault]: 'older', [accounts]: JSON.stringify(profiles) } });
    writeFileSync(join(storeDir, 'storage.json'), JSON.stringify({ initialized: true, data: { [vault]: current } }));
    expect(await launch(custom, true)).toEqual([]);
    expect(store.getItem(vault)).toBe(current);
});

test('profiles on the configured origin take precedence over the 8081 fallback', async () => {
    const { launch } = fixture({
        [custom]: { [accounts]: JSON.stringify(profiles) },
        [original]: { [accounts]: JSON.stringify([{ username: 'fallback', password: 'fixture' }]) }
    });
    expect(await launch(custom)).toEqual(profiles);
});
