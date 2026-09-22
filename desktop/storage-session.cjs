const fs = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { createHash } = require('node:crypto');
const { sharedStorage } = require('./shared-storage.cjs');

function prepareStorage(app) {
    const directory = process.env.B0T_PROFILE_DIR ? resolve(process.env.B0T_PROFILE_DIR) : app.getPath('userData');
    const cacheRoot = process.env.B0T_RUNTIME_DIR ?? tmpdir();
    fs.mkdirSync(cacheRoot, { recursive: true });
    const runtime = fs.mkdtempSync(join(cacheRoot, 'rs2b0t-session-'));
    const storeDir = join(directory, 'Shared Storage');
    const store = sharedStorage(storeDir);
    const legacy = join(directory, 'Local Storage');
    if (!store.initialized() && fs.existsSync(legacy)) {
        const fingerprint = () => {
            const hash = createHash('sha256');
            for (const name of fs.readdirSync(legacy, { recursive: true }).sort()) {
                const file = join(legacy, name);
                if (fs.statSync(file).isFile()) hash.update(name).update(fs.readFileSync(file));
            }
            return hash.digest('hex');
        };
        let copied = false;
        for (let attempt = 0; attempt < 5 && !copied; attempt++) {
            try {
                const before = fingerprint();
                fs.rmSync(join(runtime, 'Local Storage'), { recursive: true, force: true });
                fs.cpSync(legacy, join(runtime, 'Local Storage'), { recursive: true });
                copied = fingerprint() === before;
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
        }
        if (!copied) {
            fs.rmSync(runtime, { recursive: true, force: true });
            throw new Error('Existing saved settings are changing. Close the older app once, then launch again to migrate them.');
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
        async start(serverUrl) {
            const { BrowserWindow, ipcMain, session, net, webContents } = require('electron');
            if (!store.initialized()) {
                const migrationUrl = 'http://localhost:8081/__rs2b0t_profile_migration__';
                session.defaultSession.protocol.handle('http', request => (request.url === migrationUrl ? new Response('<!doctype html><title>Profile migration</title>') : net.fetch(request, { bypassCustomProtocolHandlers: true })));
                const hidden = new BrowserWindow({ show: false });
                try {
                    await hidden.loadURL(migrationUrl);
                    const entries = await hidden.webContents.executeJavaScript('Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith("rs2b0t:")))');
                    store.seed(entries);
                } finally {
                    hidden.destroy();
                    session.defaultSession.protocol.unhandle('http');
                }
            }
            const origin = new URL(serverUrl).origin;
            const methods = new Set(['getItem', 'keys', 'setItem', 'removeItem', 'compareAndSet']);
            ipcMain.on('rs2b0t-storage', (event, method, ...args) => {
                try {
                    if (new URL(event.senderFrame.url).origin !== origin || !methods.has(method)) throw new Error('Invalid storage request');
                    event.returnValue = { value: store[method](...args) };
                } catch (error) {
                    event.returnValue = { error: error.message };
                }
            });
            let snapshot = store.snapshot();
            watcher = fs.watch(storeDir, (_, file) => {
                if (String(file) !== 'storage.json') return;
                const next = store.snapshot();
                for (const key of new Set([...Object.keys(snapshot), ...Object.keys(next)])) {
                    if (snapshot[key] === next[key]) continue;
                    for (const contents of webContents.getAllWebContents()) {
                        for (const frame of contents.mainFrame.framesInSubtree) {
                            if (frame.url && new URL(frame.url).origin === origin) frame.send('rs2b0t-storage-changed', key, snapshot[key] ?? null, next[key] ?? null);
                        }
                    }
                }
                snapshot = next;
            });
        }
    };
}

module.exports = { prepareStorage };
