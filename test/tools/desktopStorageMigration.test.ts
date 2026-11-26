import { afterEach, expect, spyOn, test } from 'bun:test';
import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, type CopySyncOptions } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

function fixture(
    origins?: Record<string, Record<string, string>>,
    onLegacyRead?: (origin: string) => void,
    copyLegacy: (src: string, dest: string, options: CopySyncOptions) => void = cpSync
) {
    const dir = mkdtempSync(join(tmpdir(), 'rs2b0t-migration-'));
    directories.push(dir);
    function saveLegacy(values: Record<string, Record<string, string>>) {
        mkdirSync(join(dir, 'Local Storage'), { recursive: true });
        writeFileSync(join(dir, 'Local Storage', 'fixture.json'), JSON.stringify(values));
    }
    if (origins) saveLegacy(origins);
    const storeDir = join(dir, 'Shared Storage');
    const store = sharedStorage(storeDir);

    function olderWrite(key: string, value: string | null) {
        const file = join(storeDir, 'storage.json');
        const state = JSON.parse(readFileSync(file, 'utf8'));
        if (value === null) {
            if (!(key in state.data)) return;
            delete state.data[key];
        } else {
            if (state.data[key] === value) return;
            state.data[key] = value;
        }
        const temporary = join(storeDir, 'older-writer.tmp');
        writeFileSync(temporary, JSON.stringify(state));
        renameSync(temporary, file);
    }

    let rendererStorage: Partial<Record<string, string>> = {};

    async function launch(server: string, recover = false, ready = Promise.resolve()) {
        let runtime = '';
        let startupError: unknown;
        const opened = Promise.withResolvers<void>();
        const app = Object.assign(new EventEmitter(), {
            getPath: () => dir,
            setPath: (_name: string, path: string) => { runtime = path; },
            commandLine: { appendSwitch() {}, getSwitchValue: () => '' },
            whenReady: () => ready,
            quit: () => opened.reject(new Error('app.quit', { cause: startupError }))
        });
        const handlers = new Map<string, (request: { url: string }) => Response>();
        let runtimeOrigins: Record<string, Record<string, string>> | undefined;
        function nativeStorage(origin: string): Record<string, string> {
            const file = join(runtime, 'Local Storage', 'fixture.json');
            if (!existsSync(file)) return {};
            runtimeOrigins ??= JSON.parse(readFileSync(file, 'utf8')) as Record<string, Record<string, string>>;
            return runtimeOrigins[origin] ?? {};
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
                    onLegacyRead?.(this.origin);
                    return runInNewContext(source, { localStorage: nativeStorage(this.origin) });
                } };
                destroy() {}
            }
        };
        const module = { exports: {} };
        const env = { B0T_PROFILE_DIR: dir, B0T_RUNTIME_DIR: dir, B0T_RECOVER_LEGACY_PROFILES: recover ? '1' : undefined };
        const context = {
            module, URL, Response, process: { argv: [`--server=${server}/bot.html?fixture=1`], env },
            require: (name: string) => {
                if (name === 'node:fs') return { ...require(name), cpSync: copyLegacy };
                return name === 'electron' ? electron : require(name);
            }
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
        const roster = JSON.parse(store.getItem(vault) ?? store.getItem(accounts) ?? '[]');
        return Array.isArray(roster) ? roster : [];
    }
    async function openPanel() {
        const panel = await Bun.build({ entrypoints: [join(import.meta.dir, '../../src/bot/panel/desktopStorage.ts')] });
        const native = Object.assign(new Storage(), rendererStorage);
        runInNewContext(await panel.outputs[0].text(), { window: { localStorage: native }, rs2b0tDesktopStorage: { ...store, subscribe() {} } });
    }
    return { launch, openPanel, olderWrite, saveLegacy, store, storeDir, rendererStorage: () => rendererStorage };
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

const emptyRosters: Record<string, string>[] = [{}, { [accounts]: '[]' }, { [vault]: '[]' }];
test.each(emptyRosters)('overlapping first launches recover all profiles when 8081 seeds %j first', async empty => {
    const { launch } = fixture({
        [original]: empty,
        [custom]: { [accounts]: JSON.stringify(profiles) }
    });
    const ready = Promise.withResolvers<void>();
    const pending = launch(custom, false, ready.promise);
    expect(await launch(original)).toEqual([]);
    ready.resolve();
    const first = await pending;
    const second = await launch(custom);
    expect([first.length, second.length]).toEqual([30, 30]);
    expect(first).toEqual(profiles);
    expect(second).toEqual(profiles);
});

test.each([custom, original])('a pending 8082 launch preserves panel settings when 8081 seeds first and the roster is on %s', async rosterOrigin => {
    const script = 'rs2b0t:fixture:selectedScript';
    const ore = 'rs2b0t:set:Miner:ore';
    const tree = 'rs2b0t:set:Woodcutter:tree';
    const method = 'rs2b0t:set:Fisher:method';
    const rock = 'rs2b0t:fixture:set:Miner:rock';
    const rail = 'rs2b0t:multibox:railHidden';
    const legacy: Record<string, Record<string, string>> = {
        [custom]: { [script]: 'Miner', [ore]: 'Tin', [tree]: 'Oak', [method]: 'Bait', [rock]: 'Copper', [rail]: '1' },
        [original]: { [tree]: 'Willow' }
    };
    legacy[rosterOrigin][accounts] = JSON.stringify(profiles);
    const { launch, openPanel, store } = fixture(legacy);
    const ready = Promise.withResolvers<void>();
    const pending = launch(custom, false, ready.promise);
    await launch(original);
    store.setItem(ore, 'Gold');
    store.setItem(method, 'Fly');
    store.removeItem(method);
    ready.resolve();
    await pending;
    await openPanel();
    expect(await launch(custom)).toEqual(profiles);
    expect(store.getItem(script)).toBe('Miner');
    expect(store.getItem(rock)).toBe('Copper');
    expect(store.getItem(ore)).toBe('Gold');
    expect(store.getItem(tree)).toBe('Willow');
    expect(store.getItem(method)).toBeNull();
    expect(store.getItem(rail)).toBeNull();
});

test('an empty roster saved before the first seed takes precedence over a pending migration', async () => {
    const { launch, store } = fixture({ [custom]: { [accounts]: JSON.stringify(profiles) } });
    const ready = Promise.withResolvers<void>();
    const pending = launch(custom, false, ready.promise);
    store.setItem(vault, '[]');
    await launch(original);
    ready.resolve();
    expect(await pending).toEqual([]);
    expect(store.snapshot()).toEqual({ [vault]: '[]' });
});

test('a failed configured read after another launch seeded settings retries the configured origin', async () => {
    const script = 'rs2b0t:fixture:selectedScript';
    let unreadable = true;
    const { launch, store } = fixture({
        [original]: { [script]: 'Fisher' },
        [custom]: { [accounts]: JSON.stringify(profiles) }
    }, origin => {
        if (origin === custom && unreadable) throw new Error('Unreadable 8082 fixture');
    });
    const ready = Promise.withResolvers<void>();
    const pending = launch(custom, false, ready.promise);
    expect(await launch(original)).toEqual([]);
    ready.resolve();
    expect(await pending).toEqual([]);
    expect(store.getItem(script)).toBe('Fisher');
    unreadable = false;
    expect(await launch(original)).toEqual(profiles);
    expect(await launch(custom)).toEqual(profiles);
});

test.each(['same launch', 'next launch'])('overlapping migrations recover 8082 when 8083 becomes readable on the %s', async when => {
    const other = 'http://localhost:8083';
    const ore = 'rs2b0t:set:Miner:ore';
    const tree = 'rs2b0t:set:Woodcutter:tree';
    const script = 'rs2b0t:fixture:selectedScript';
    const unreadable = new Set([custom, other]);
    const { launch, store } = fixture({
        [custom]: { [accounts]: JSON.stringify(profiles), [ore]: 'Tin' },
        [other]: { [script]: 'Fisher', [tree]: 'Oak' }
    }, origin => {
        if (unreadable.has(origin)) throw new Error('Unreadable fixture');
    });
    const ready = Promise.withResolvers<void>();
    const pending = launch(other, false, ready.promise);
    expect(await launch(custom)).toEqual([]);
    store.removeItem(tree);
    ready.resolve();
    expect(await pending).toEqual([]);
    store.removeItem(ore);
    unreadable.delete(custom);
    if (when === 'same launch') unreadable.delete(other);
    expect(await launch(custom)).toEqual(profiles);
    expect(store.getItem(script)).toEqual(when === 'same launch' ? 'Fisher' : null);
    unreadable.delete(other);
    expect(await launch(custom)).toEqual(profiles);
    expect([script, tree, ore].map(key => store.getItem(key))).toEqual(['Fisher', null, null]);
});

test('a configured-origin retry recovers panel settings and preserves edits and deletions across the failed read', async () => {
    const script = 'rs2b0t:fixture-0:selectedScript';
    const ore = 'rs2b0t:fixture-0:set:Miner:ore';
    const tree = 'rs2b0t:set:Woodcutter:tree';
    const bait = 'rs2b0t:set:Fisher:bait';
    const method = 'rs2b0t:set:Fisher:method';
    let unreadable = true;
    const { launch, openPanel, store } = fixture({
        [original]: { [tree]: 'Willow', [bait]: 'Worm' },
        [custom]: { [accounts]: JSON.stringify(profiles), [script]: 'Miner', [ore]: 'Tin', [tree]: 'Oak', [bait]: 'Fly', [method]: 'Net' }
    }, origin => {
        if (origin === custom && unreadable) throw new Error('Unreadable 8082 fixture');
    });
    const ready = Promise.withResolvers<void>();
    const pending = launch(custom, false, ready.promise);
    expect(await launch(original)).toEqual([]);
    store.removeItem(bait);
    ready.resolve();
    expect(await pending).toEqual([]);
    store.setItem(tree, 'Yew');
    store.removeItem(method);

    unreadable = false;
    expect(await launch(custom)).toEqual(profiles);
    await openPanel();
    expect([script, ore, tree, bait, method].map(key => store.getItem(key))).toEqual(['Miner', 'Tin', 'Yew', null, null]);
    expect(await launch(custom)).toEqual(profiles);
});

test('a panel opened by an overlapping first launch preserves a deleted setting', async () => {
    const ore = 'rs2b0t:set:Miner:ore';
    const { launch, openPanel, store } = fixture({ [original]: { [ore]: 'Tin' } });
    const ready = Promise.withResolvers<void>();
    const pending = launch(original, false, ready.promise);
    await launch(original);
    expect(store.getItem(ore)).toBe('Tin');
    store.removeItem(ore);
    ready.resolve();
    await pending;
    await openPanel();
    expect(store.getItem(ore)).toBeNull();
});

test.each(['setItem', 'compareAndSet', 'removeItem'])('profile %s after the empty seed takes precedence over a pending migration', async method => {
    const { launch, store } = fixture({ [custom]: { [accounts]: JSON.stringify(profiles) } });
    const ready = Promise.withResolvers<void>();
    const pending = launch(custom, false, ready.promise);
    await launch(original);
    if (method === 'setItem') store.setItem(vault, '[]');
    if (method === 'compareAndSet') expect(store.compareAndSet(accounts, null, '[]')).toBe(true);
    if (method === 'removeItem') store.removeItem(accounts);
    const saved = store.snapshot();
    ready.resolve();
    expect(await pending).toEqual([]);
    expect(store.snapshot()).toEqual(saved);
    expect(await launch(custom)).toEqual([]);
});

test('an old empty migration can recover profiles alongside newer shared settings', async () => {
    const key = 'rs2b0t:setting';
    const { launch, storeDir, store } = fixture({ [custom]: { [accounts]: JSON.stringify(profiles), [key]: 'old' } });
    writeFileSync(join(storeDir, 'storage.json'), JSON.stringify({ initialized: true, data: {} }));
    store.setItem(key, 'new');
    expect(await launch(custom, true)).toEqual(profiles);
    expect(store.getItem(key)).toBe('new');
    store.removeItem(vault);
    expect(await launch(custom)).toEqual([]);
});

test.each([accounts, 'rs2b0t:multibox:profiles'])('recovery preserves newer saved profiles when the legacy key is %s', async legacyKey => {
    const { launch, storeDir, store } = fixture({ [custom]: { [legacyKey]: JSON.stringify(profiles) } });
    const current = [{ username: 'current', password: 'fixture' }];
    writeFileSync(join(storeDir, 'storage.json'), JSON.stringify({ initialized: true, data: { [accounts]: JSON.stringify(current) } }));
    expect(await launch(custom, true)).toEqual(current);
    expect(store.getItem('rs2b0t:multibox:profiles')).toBeNull();
});

test.each<[string, boolean, boolean]>([
    ['ordinary launch', false, true],
    ['explicit recovery', true, true],
    ['explicit recovery without Chromium storage', true, false]
])('%s with empty shared profiles and populated shared accounts', async (_, recover, hasLegacy) => {
    const older = [{ username: 'older', password: 'fixture' }];
    const { launch, storeDir, store } = fixture(hasLegacy ? { [custom]: { [accounts]: JSON.stringify(older) } } : undefined);
    const data = { [vault]: '[]', [accounts]: JSON.stringify(profiles) };
    writeFileSync(join(storeDir, 'storage.json'), JSON.stringify({ initialized: true, data }));

    await launch(custom, recover);
    const expected = recover ? profiles.map(profile => ({ ...profile, tab: 'Main' })) : [];
    const current = new ProfileVault(store);
    await current.setup('fixture');
    expect(current.list()).toEqual(expected);
    await launch(custom);
    const reopened = new ProfileVault(store);
    expect(await reopened.unlock('fixture')).toBe(true);
    expect(reopened.list()).toEqual(expected);
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

test('settings from 8081 keep precedence when the fallback supplies the roster', async () => {
    const script = 'rs2b0t:fixture-0:selectedScript';
    const rail = 'rs2b0t:multibox:railHidden';
    const { launch, store } = fixture({
        [custom]: { [script]: 'Miner' },
        [original]: { [accounts]: JSON.stringify(profiles), [script]: 'Fisher', [rail]: '1' }
    });
    expect(await launch(custom)).toEqual(profiles);
    expect(store.getItem(script)).toBe('Fisher');
    expect(store.getItem(rail)).toBe('1');
});

test('first migration leaves custom-origin settings for the panel and imports only its profiles', async () => {
    const rail = 'rs2b0t:multibox:railHidden';
    const setting = 'rs2b0t:set:Miner:ore';
    const script = 'rs2b0t:fixture:selectedScript';
    const { launch, store, rendererStorage } = fixture({
        [custom]: { [rail]: '1', [setting]: 'Tin', [script]: 'Miner', [accounts]: JSON.stringify(profiles) }
    });
    expect(await launch(custom)).toEqual(profiles);
    expect(rendererStorage()).toMatchObject({ [setting]: 'Tin', [script]: 'Miner' });
    expect(store.keys()).toEqual([accounts]);
    await launch(custom);
    expect(store.getItem(rail)).toBeNull();
});

test('explicit recovery survives a vault setup that already read the empty store', async () => {
    const { launch, store, storeDir } = fixture();
    store.seed({});
    const child = Bun.spawnSync([process.execPath, '--no-env-file', join(import.meta.dir, '../fixtures/desktop-recovery-during-setup.ts'), storeDir, JSON.stringify(profiles)]);
    expect({ code: child.exitCode, errors: child.stderr.toString() }).toEqual({ code: 0, errors: '' });
    await launch(custom);
    const reopened = new ProfileVault(store);
    expect(await reopened.unlock('fixture')).toBe(true);
    expect(reopened.list()).toHaveLength(30);
    expect(reopened.list()).toEqual(profiles.map(profile => ({ ...profile, tab: 'Main' })));
});

test.each([[accounts, accounts], [vault, accounts], [accounts, vault]])(
    'explicit recovery replaces an empty %s roster with profiles from %s', async (emptyKey, sourceKey) => {
        const saved = JSON.stringify(profiles);
        const { launch, store } = fixture({ [custom]: { [sourceKey]: saved }, [original]: { [accounts]: '[]' } });
        store.seed({ [emptyKey]: '[]' });
        await launch(custom);
        expect(store.snapshot()).toEqual({ [emptyKey]: '[]' });
        await launch(custom, true);
        expect(store.snapshot()).toEqual({ [vault]: saved });
        await launch(custom);
        expect(store.snapshot()).toEqual({ [vault]: saved });
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
    }).toEqual({ shared: [vault], nativeSetting: undefined, nativeScript: undefined });
});

test('explicit recovery can use the fallback when the configured origin has only an empty roster', async () => {
    const { launch, store } = fixture({ [custom]: { [vault]: '[]' }, [original]: { [accounts]: JSON.stringify(profiles) } });
    store.seed({ [vault]: '[]' });
    expect(await launch(custom, true)).toEqual(profiles);
    expect(store.getItem(accounts)).toBeNull();
});

test('explicit recovery finishes on the configured origin when 8081 is unreadable', async () => {
    const reads: string[] = [];
    const { launch, storeDir } = fixture({ [custom]: { [accounts]: JSON.stringify(profiles) } }, origin => {
        reads.push(origin);
        if (origin === original) throw new Error('Unreadable 8081 fixture');
    });
    writeFileSync(join(storeDir, 'storage.json'), JSON.stringify({ initialized: true, data: {} }));
    expect(await launch(custom, true)).toEqual(profiles);
    expect(await launch(custom)).toEqual(profiles);
    expect(reads).toEqual([custom]);
});

test.each<[string, boolean]>([['ordinary startup', false], ['explicit recovery', true]])(
    'first migration during %s keeps the 8081 script selection', async (_, recover) => {
        const script = 'rs2b0t:fixture-0:selectedScript';
        const { launch, store } = fixture({
            [custom]: { [accounts]: JSON.stringify(profiles) },
            [original]: { [script]: 'Fisher' }
        });
        expect(await launch(custom, recover)).toEqual(profiles);
        expect(await launch(custom)).toEqual(profiles);
        expect(store.getItem(script)).toBe('Fisher');
    }
);

test('an unreadable configured origin still opens the 8081 roster', async () => {
    let unreadable = true;
    const configured = [{ username: 'custom', password: 'fixture' }];
    const { launch, store } = fixture({
        [original]: { [accounts]: JSON.stringify(profiles) },
        [custom]: { [accounts]: JSON.stringify(configured) }
    }, origin => {
        if (origin === custom && unreadable) throw new Error('Unreadable 8082 fixture');
    });
    expect(await launch(custom)).toEqual(profiles);
    unreadable = false;
    expect(await launch(custom)).toEqual(profiles);
    store.removeItem(accounts);
    expect(await launch(custom)).toEqual([]);
    expect(await launch(custom, true)).toEqual(configured);
});

test.each(['retry', 'save', 'reset'])('8081 settings open while the configured roster is unreadable, then honor %s', async action => {
    const script = 'rs2b0t:fixture:selectedScript';
    let unreadable = true;
    const { launch, store } = fixture({
        [custom]: { [accounts]: JSON.stringify(profiles) },
        [original]: { [script]: 'Fisher' }
    }, origin => {
        if (origin === custom && unreadable) throw new Error('Unreadable 8082 fixture');
    });
    expect(await launch(custom)).toEqual([]);
    expect(store.getItem(script)).toBe('Fisher');
    expect(await launch(custom)).toEqual([]);
    const newer = [{ username: 'newer', password: 'fixture' }];
    if (action === 'save') store.setItem(accounts, JSON.stringify(newer));
    if (action === 'reset') store.removeItem(vault);
    unreadable = false;
    const expected = action === 'save' ? newer : action === 'reset' ? [] : profiles;
    expect(await launch(original)).toEqual(expected);
    expect(await launch(custom)).toEqual(expected);
});

test('a pending retry from an older desktop recovers its origin and preserves deleted settings', async () => {
    const script = 'rs2b0t:fixture:selectedScript';
    const ore = 'rs2b0t:set:Miner:ore';
    const { launch, store, storeDir } = fixture({ [custom]: { [accounts]: JSON.stringify(profiles), [script]: 'Miner', [ore]: 'Tin' } });
    const marker = { [vault]: null, [accounts]: null };
    writeFileSync(join(storeDir, 'storage.json'), JSON.stringify({
        initialized: true, data: marker, seededWithoutProfiles: marker, retryProfileOrigin: custom, deletedDuringProfileRetry: [ore]
    }) + '\n');
    expect(await launch(original)).toEqual(profiles);
    expect(await launch(original)).toEqual(profiles);
    expect([store.getItem(script), store.getItem(ore)]).toEqual(['Miner', null]);
});

test('an older pending retry without profile markers requires explicit recovery', async () => {
    const { launch, storeDir } = fixture({ [custom]: { [accounts]: JSON.stringify(profiles) } });
    writeFileSync(join(storeDir, 'storage.json'), JSON.stringify({
        initialized: true, data: {}, seededWithoutProfiles: true, retryProfileOrigin: custom
    }));
    expect(await launch(custom)).toEqual([]);
    expect(await launch(custom, true)).toEqual(profiles);
});

test.each(['before', 'during'])('an older desktop reset %s a configured-origin retry stays empty across launches', async when => {
    const script = 'rs2b0t:fixture:selectedScript';
    let unreadable = true;
    const { launch, olderWrite } = fixture({
        [original]: { [script]: 'Miner' },
        [custom]: { [accounts]: JSON.stringify(profiles) }
    }, origin => {
        if (origin === custom && unreadable) throw new Error('Unreadable 8082 fixture');
    });
    expect(await launch(custom)).toEqual([]);

    unreadable = false;
    const ready = Promise.withResolvers<void>();
    const pending = when === 'during' ? launch(custom, false, ready.promise) : undefined;
    olderWrite(vault, JSON.stringify([{ username: 'newer', password: 'fixture' }]));
    olderWrite(vault, null);
    olderWrite(accounts, null);
    olderWrite(script, null);
    ready.resolve();
    if (pending) expect(await pending).toEqual([]);
    expect(await launch(custom)).toEqual([]);
    expect(await launch(custom)).toEqual([]);
    expect(await launch(custom, true)).toEqual(profiles);
});

test.each([original, custom])('a deferred read from %s preserves a setting cleared by an older desktop', async deferred => {
    const script = 'rs2b0t:fixture:selectedScript';
    let unreadable = true;
    const { launch, olderWrite, openPanel, store } = fixture({
        [original]: deferred === original ? { [script]: 'Fisher' } : { 'rs2b0t:setting': 'fixture' },
        [custom]: { [accounts]: JSON.stringify(profiles), [script]: 'Miner' }
    }, origin => {
        if (origin === deferred && unreadable) throw new Error('Unreadable fixture');
    });
    expect(await launch(custom)).toEqual(deferred === original ? profiles : []);
    unreadable = false;
    const ready = Promise.withResolvers<void>();
    const pending = launch(custom, false, ready.promise);
    olderWrite(script, 'edited');
    olderWrite(script, null);
    store.setItem('rs2b0t:other', 'newer');
    expect(store.getItem(script)).toBeNull();
    ready.resolve();
    expect(await pending).toEqual(profiles);
    await openPanel();
    expect(store.getItem(script)).toBeNull();
    expect(await launch(custom)).toEqual(profiles);
    expect(store.getItem(script)).toBeNull();
});

test('the panel preserves 8081 setting precedence across a failed read and genuine edits', async () => {
    const script = 'rs2b0t:fixture:selectedScript';
    const ore = 'rs2b0t:set:Miner:ore';
    const tree = 'rs2b0t:set:Woodcutter:tree';
    const method = 'rs2b0t:set:Fisher:method';
    let unreadable = true;
    const { launch, openPanel, store } = fixture({
        [custom]: { [accounts]: JSON.stringify(profiles), [script]: 'Miner', [ore]: 'Tin', [tree]: 'Oak', [method]: 'Bait' },
        [original]: { [script]: 'Fisher', [ore]: 'Gold', [method]: 'Fly' }
    }, origin => {
        if (origin === original && unreadable) throw new Error('Unreadable 8081 fixture');
    });
    expect(await launch(custom)).toEqual(profiles);
    store.removeItem(method);
    await openPanel();
    store.setItem(ore, 'Tin');
    unreadable = false;
    expect(await launch(custom)).toEqual(profiles);
    expect(store.getItem(script)).toBe('Fisher');
    expect(store.getItem(ore)).toBe('Tin');
    expect(store.getItem(tree)).toBe('Oak');
    expect(store.getItem(method)).toBeNull();
});

test('an unreadable 8081 opens the configured roster and retries missing settings on relaunch', async () => {
    const script = 'rs2b0t:fixture-0:selectedScript';
    const edited = 'rs2b0t:set:Miner:ore';
    const removed = 'rs2b0t:set:Fisher:method';
    let unreadable = true;
    const { launch, store, storeDir, rendererStorage } = fixture({
        [custom]: { [accounts]: JSON.stringify(profiles), [removed]: 'Fly fishing' },
        [original]: { [accounts]: JSON.stringify(profiles), [script]: 'Fisher', [edited]: 'Tin', [removed]: 'Bait' }
    }, origin => {
        if (origin === original && unreadable) throw new Error('Unreadable 8081 fixture');
    });
    expect(await launch(custom)).toEqual(profiles);
    store.setItem(edited, 'Gold');
    store.removeItem(removed);
    const fs: typeof import('node:fs') = require('node:fs');
    const write = fs.writeFileSync;
    const inStore = (file: Parameters<typeof write>[0]) => typeof file === 'string' && dirname(file) === storeDir;
    const writes = spyOn(fs, 'writeFileSync').mockImplementation((file, ...args) => {
        if (inStore(file)) throw Object.assign(new Error('Fixture disk full'), { code: 'ENOSPC' });
        write(file, ...args);
    });
    try {
        expect(await launch(custom)).toEqual(profiles);
        expect(writes.mock.calls.some(([file]) => inStore(file))).toBe(false);
        expect(rendererStorage()).toEqual({});
        unreadable = false;
        expect(await launch(custom)).toEqual(profiles);
        expect(writes.mock.calls.some(([file]) => inStore(file))).toBe(true);
        expect(store.getItem(script)).toBeNull();
        expect(rendererStorage()).toEqual({});
    } finally {
        writes.mockRestore();
    }
    store.removeItem(accounts);
    expect(await launch(custom)).toEqual([]);
    expect(store.getItem(script)).toBe('Fisher');
    expect(store.getItem(edited)).toBe('Gold');
    expect(store.getItem(removed)).toBeNull();
    expect(rendererStorage()[removed]).toBeUndefined();
    store.removeItem(script);
    expect(await launch(custom)).toEqual([]);
    expect(store.getItem(script)).toBeNull();
});

test.each(['ENOENT', 'EACCES'])('a settings retry opens the roster after %s during copy and imports settings on relaunch', async code => {
    const script = 'rs2b0t:fixture-0:selectedScript';
    let failCopy = false;
    let unreadable = true;
    const { launch, store, rendererStorage } = fixture({
        [custom]: { [accounts]: JSON.stringify(profiles) },
        [original]: { [script]: 'Fisher' }
    }, origin => {
        if (origin === original && unreadable) throw new Error('Unreadable 8081 fixture');
    }, (src, dest, options) => {
        if (!failCopy) return cpSync(src, dest, options);
        mkdirSync(dest);
        writeFileSync(join(dest, 'fixture.json'), JSON.stringify({ [custom]: { [script]: 'partial' } }));
        throw Object.assign(new Error('Interrupted fixture copy'), { code });
    });

    expect(await launch(custom)).toEqual(profiles);
    unreadable = false;
    failCopy = true;
    expect(await launch(custom)).toEqual(profiles);
    expect(rendererStorage()).toEqual({});
    expect(store.getItem(script)).toBeNull();
    failCopy = false;
    expect(await launch(custom)).toEqual(profiles);
    expect(store.getItem(script)).toBe('Fisher');
});

test('explicit recovery removes the partial runtime after a copy error and can retry', async () => {
    let failedRuntime = '';
    const { launch, storeDir } = fixture({ [custom]: { [accounts]: JSON.stringify(profiles) } }, undefined, (src, dest, options) => {
        if (failedRuntime) return cpSync(src, dest, options);
        mkdirSync(dest);
        cpSync(join(src, 'fixture.json'), join(dest, 'fixture.json'));
        failedRuntime = dirname(dest);
        throw Object.assign(new Error('Fixture disk full'), { code: 'ENOSPC' });
    });
    writeFileSync(join(storeDir, 'storage.json'), JSON.stringify({ initialized: true, data: {} }));

    await expect(launch(custom, true)).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(existsSync(failedRuntime)).toBe(false);
    expect(await launch(custom)).toEqual([]);
    expect(await launch(custom, true)).toEqual(profiles);
});

test('an empty readable fallback opens the chooser and retries the configured origin', async () => {
    let unreadable = true;
    const { launch, store } = fixture({ [custom]: { [accounts]: JSON.stringify(profiles) } }, origin => {
        if (origin === custom && unreadable) throw new Error('Unreadable 8082 fixture');
    });
    expect(await launch(custom)).toEqual([]);
    expect(store.initialized()).toBe(true);
    unreadable = false;
    expect(await launch(original)).toEqual(profiles);
    expect(await launch(custom)).toEqual(profiles);
});

test('an empty configured roster and unreadable 8081 leave first migration pending', async () => {
    let unreadable = true;
    const { launch, store } = fixture({ [custom]: { [accounts]: '[]' }, [original]: { [accounts]: JSON.stringify(profiles) } }, origin => {
        if (origin === original && unreadable) throw new Error('Unreadable 8081 fixture');
    });
    await expect(launch(custom)).rejects.toMatchObject({ message: 'app.quit', cause: { message: 'Unreadable 8081 fixture' } });
    expect(store.initialized()).toBe(false);
    unreadable = false;
    expect(await launch(custom)).toEqual(profiles);
    expect(await launch(custom)).toEqual(profiles);
});

test('two failed origin reads leave the first migration retryable', async () => {
    let unreadable = true;
    const { launch, store } = fixture({ [custom]: { [accounts]: JSON.stringify(profiles) } }, () => {
        if (unreadable) throw new Error('Unreadable fixture');
    });
    await expect(launch(custom)).rejects.toMatchObject({ cause: { message: 'Unreadable fixture' } });
    expect(store.initialized()).toBe(false);
    unreadable = false;
    expect(await launch(custom)).toEqual(profiles);
    expect(await launch(custom)).toEqual(profiles);
});

test('first migration skips an empty configured roster across two launches', async () => {
    const { launch, store } = fixture({ [custom]: { [vault]: '[]' }, [original]: { [accounts]: JSON.stringify(profiles) } });
    const first = await launch(custom);
    const second = await launch(custom);
    expect([first.length, second.length]).toEqual([30, 30]);
    expect(store.snapshot()).toEqual({ [accounts]: JSON.stringify(profiles) });
});

test.each<[string, boolean]>([
    ['automatic migration keeps the empty roster', false],
    ['explicit recovery restores the older accounts', true]
])('with both profile keys on one origin, %s after vault setup and reopen', async (_, recover) => {
    const { launch, store } = fixture({ [custom]: { [vault]: '[]', [accounts]: JSON.stringify(profiles) } });
    expect(await launch(custom)).toEqual([]);
    if (recover) await launch(custom, true);
    await new ProfileVault(store).setup('fixture');
    await launch(custom);
    const reopened = new ProfileVault(store);
    expect(await reopened.unlock('fixture')).toBe(true);
    expect(reopened.list()).toEqual(recover ? profiles.map(profile => ({ ...profile, tab: 'Main' })) : []);
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
    ['invalid salt encoding', '{"v":1,"iter":310000,"salt":"!","iv":"AAAAAAAAAAAAAAAA","ct":"AAAAAAAAAAAAAAAAAAAAAAAA"}']
])('recovery skips %s and imports the populated fallback', async (_, value) => {
    const { launch, store } = fixture({ [custom]: { [vault]: value }, [original]: { [accounts]: JSON.stringify(profiles) } });
    store.seed({});
    expect((await launch(custom, true)).length).toBe(30);
    expect(store.getItem(accounts)).toBeNull();
    expect(await launch(custom)).toEqual(profiles);
});

test('an invalid source on first launch leaves room for explicit recovery later', async () => {
    const { launch, saveLegacy, store } = fixture({ [custom]: { [vault]: '{' } });
    await launch(custom);
    saveLegacy({ [custom]: { [accounts]: JSON.stringify(profiles) } });
    expect(await launch(custom, true)).toEqual(profiles);
    expect(store.getItem(accounts)).toBeNull();
});

test.each<[string, boolean]>([
    ['first migration', false], ['explicit recovery', true]
])('%s copies only the encrypted vault from a mixed source', async (_, recover) => {
    const { launch, saveLegacy, store } = fixture();
    const source = fixture().store;
    const current = [{ username: 'vault-only', password: 'fixture' }];
    source.setItem(accounts, JSON.stringify(current));
    await new ProfileVault(source).setup('fixture');
    const saved = source.getItem(vault);
    saveLegacy({
        [custom]: { [vault]: saved, [accounts]: JSON.stringify(profiles) },
        [original]: { [accounts]: JSON.stringify(profiles) }
    });
    if (recover) store.seed({});
    await launch(custom, recover);
    await launch(custom);
    const reopened = new ProfileVault(store);
    expect(await reopened.unlock('fixture')).toBe(true);
    expect(reopened.list()).toEqual([{ ...current[0], tab: 'Main' }]);
    expect(store.getItem(accounts)).toBeNull();
});

test.each<[string, boolean, number]>([
    ['first migration', false, 12],
    ['explicit recovery', true, 16]
])('a fallback vault with a 32-byte salt unlocks after %s and relaunch', async (_, recover, ivLength) => {
    const salt = randomBytes(32);
    const iv = randomBytes(ivLength);
    const iter = 310000;
    const cipher = createCipheriv('aes-256-gcm', pbkdf2Sync('fixture', salt, iter, 32, 'sha256'), iv);
    const ct = Buffer.concat([cipher.update(JSON.stringify(profiles)), cipher.final(), cipher.getAuthTag()]);
    const saved = JSON.stringify({ v: 1, kdf: 'PBKDF2-SHA256', iter, salt: salt.toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64') });
    const { launch, store } = fixture({ [original]: { [vault]: saved } });
    if (recover) store.seed({});
    await launch(custom, recover);
    await launch(custom);
    const reopened = new ProfileVault(store);
    expect(await reopened.unlock('fixture')).toBe(true);
    expect(reopened.list()).toEqual(profiles.map(profile => ({ ...profile, tab: 'Main' })));
});
