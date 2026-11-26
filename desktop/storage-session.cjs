const fs = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { createHash } = require('node:crypto');
const { profileKeys, savedProfileKey, sharedStorage } = require('./shared-storage.cjs');
const legacyOrigin = 'http://localhost:8081';

function prepareStorage(app, serverUrl) {
    const directory = process.env.B0T_PROFILE_DIR ? resolve(process.env.B0T_PROFILE_DIR) : app.getPath('userData');
    const cacheRoot = process.env.B0T_RUNTIME_DIR ?? tmpdir();
    fs.mkdirSync(cacheRoot, { recursive: true });
    const runtime = fs.mkdtempSync(join(cacheRoot, 'rs2b0t-session-'));
    const storeDir = join(directory, 'Shared Storage');
    const store = sharedStorage(storeDir);
    const legacy = join(directory, 'Local Storage');
    const recover = process.env.B0T_RECOVER_LEGACY_PROFILES === '1';
    const hasLegacy = fs.existsSync(legacy);
    const { initialized, retrySettings, retryProfileOrigin } = hasLegacy ? store.migrationStatus() : {};
    const automaticRetry = initialized && !recover;
    let copied = false;
    if (hasLegacy && (recover || !initialized || retrySettings || retryProfileOrigin)) {
        const destination = join(runtime, 'Local Storage');
        const fingerprint = () => {
            const hash = createHash('sha256');
            for (const name of fs.readdirSync(legacy, { recursive: true }).sort()) {
                const file = join(legacy, name);
                if (fs.statSync(file).isFile()) hash.update(name).update(fs.readFileSync(file));
            }
            return hash.digest('hex');
        };
        for (let attempt = 0; attempt < 5 && !copied; attempt++) {
            try {
                const before = fingerprint();
                fs.rmSync(destination, { recursive: true, force: true });
                fs.cpSync(legacy, destination, { recursive: true });
                copied = fingerprint() === before;
            } catch (error) {
                if (error.code === 'ENOENT') continue;
                if (automaticRetry) break;
                fs.rmSync(runtime, { recursive: true, force: true });
                throw error;
            }
        }
        if (!copied) {
            fs.rmSync(automaticRetry ? destination : runtime, { recursive: true, force: true });
            if (!automaticRetry) throw new Error('Existing saved settings are changing. Close the older app once, then launch again to migrate them.');
        }
    }
    app.setPath('userData', runtime);
    app.setPath('sessionData', runtime);
    let watcher;
    app.on('quit', () => {
        watcher?.close();
        fs.rmSync(runtime, { recursive: true, force: true });
    });
    return {
        async start() {
            const origin = new URL(serverUrl).origin;
            const { BrowserWindow, ipcMain, session, net } = require('electron');
            async function readLegacy(source, deferPanelSettings = false) {
                const migrationUrl = source + '/__rs2b0t_profile_migration__';
                const scheme = new URL(source).protocol.slice(0, -1);
                session.defaultSession.protocol.handle(scheme, request => (request.url === migrationUrl ? new Response('<!doctype html><title>Profile migration</title>') : net.fetch(request, { bypassCustomProtocolHandlers: true })));
                let hidden;
                try {
                    hidden = new BrowserWindow({ show: false });
                    await hidden.loadURL(migrationUrl);
                    const entries = source === legacyOrigin
                        ? 'Object.entries(localStorage).filter(([key]) => key.startsWith("rs2b0t:"))'
                        : `${JSON.stringify(profileKeys)}.map(key => [key, localStorage[key]])`;
                    if (deferPanelSettings) return await hidden.webContents.executeJavaScript(`(() => {
                        const values = Object.fromEntries(${entries});
                        for (const key of Object.keys(localStorage)) {
                            if (!key.startsWith("rs2b0t:") || (!key.includes(":set:") && !key.endsWith(":selectedScript"))) continue;
                            values[key] = localStorage[key];
                            delete localStorage[key];
                        }
                        return values;
                    })()`);
                    return await hidden.webContents.executeJavaScript(`Object.fromEntries(${entries})`);
                } finally {
                    hidden?.destroy();
                    session.defaultSession.protocol.unhandle(scheme);
                }
            }
            if (copied) {
                let readError;
                function failed(error) {
                    readError = error;
                    return null;
                }
                const profileOrigin = automaticRetry ? retryProfileOrigin : origin;
                const readConfigured = profileOrigin && profileOrigin !== legacyOrigin && /^https?:\/\//.test(profileOrigin);
                let fallback;
                if (!initialized || retrySettings) fallback = await readLegacy(legacyOrigin).catch(failed);
                const values = readConfigured ? await readLegacy(profileOrigin, !initialized && fallback === null).catch(failed) : {};
                if (recover && fallback === undefined && !savedProfileKey(values ?? {})) fallback = await readLegacy(legacyOrigin).catch(failed);
                let firstMigration = false;
                if (!automaticRetry || fallback || (retryProfileOrigin && values)) {
                    try {
                        firstMigration = store.seed(values, { fallback, recover, readError, profileOrigin });
                    } catch (error) {
                        if (!automaticRetry) throw error;
                    }
                }
                if ((recover || automaticRetry) && !firstMigration) {
                    // Why: the panel also imports settings from the temporary Chromium copy.
                    await session.defaultSession.clearStorageData({ storages: ['localstorage'] });
                }
            } else if (recover || !store.initialized()) store.seed({}, { recover });
            const clients = new Map();
            const tracked = new WeakSet();
            const valid = frame => frame && !frame.isDestroyed() && !frame.detached && new URL(frame.url).origin === origin;
            function register(event) {
                const contents = event.sender;
                if (!tracked.has(contents)) {
                    const remove = frames => {
                        for (const [frame, owner] of clients) {
                            if (owner === contents && (!frames || frames.has(frame))) clients.delete(frame);
                        }
                    };
                    contents.on('did-start-navigation', details => {
                        if (details.isSameDocument) return;
                        remove(details.isMainFrame ? null : new Set(details.frame?.framesInSubtree ?? []));
                    });
                    contents.once('destroyed', () => remove(null));
                    tracked.add(contents);
                }
                clients.set(event.senderFrame, contents);
            }
            let snapshot = { version: 0, data: store.snapshot() };
            function refresh(sender) {
                const next = store.snapshot();
                if ([...new Set([...Object.keys(snapshot.data), ...Object.keys(next)])].some(key => snapshot.data[key] !== next[key])) {
                    snapshot = { version: snapshot.version + 1, data: next };
                    for (const frame of clients.keys()) {
                        try {
                            if (!valid(frame)) clients.delete(frame);
                            else if (frame !== sender) frame.send('rs2b0t-storage-changed', snapshot);
                        } catch {
                            clients.delete(frame);
                        }
                    }
                }
                return snapshot;
            }
            const methods = new Set(['snapshot', 'getItem', 'keys', 'setItem', 'removeItem', 'compareAndSet']);
            ipcMain.on('rs2b0t-storage', (event, method, ...args) => {
                try {
                    if (!valid(event.senderFrame) || !methods.has(method)) throw new Error('Invalid storage request');
                    register(event);
                    const value = method === 'snapshot' ? undefined : store[method](...args);
                    event.returnValue = { value, snapshot: method === 'getItem' || method === 'keys' ? undefined : refresh(event.senderFrame) };
                } catch (error) {
                    event.returnValue = { error: error.message };
                }
            });
            watcher = fs.watch(storeDir, (_, file) => {
                if (String(file) !== 'storage.json') return;
                refresh();
            });
        }
    };
}

module.exports = { prepareStorage };
