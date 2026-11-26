// Desktop client with background throttling disabled. Hidden browser tabs otherwise stall the 50fps game loop.
// --server=http://host:port or LCB_SERVER overrides the local engine URL; load from the server to keep assets and WebSockets same-origin.
const { app, BrowserWindow, Menu, powerSaveBlocker } = require('electron');
const { join } = require('node:path');
const { prepareStorage } = require('./storage-session.cjs');
const storage = prepareStorage(app, serverUrl());
let starting = true;
let loginCoordinator;

// Why: backgroundThrottling alone doesn't disable Chromium's process-level throttling.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

const features = new Set(app.commandLine.getSwitchValue('enable-features').split(',').filter(Boolean));
features.add('V8CppGCEnableLargerCage');
app.commandLine.appendSwitch('enable-features', [...features].join(','));

function serverUrl() {
    const arg = process.argv.find(a => a.startsWith('--server='));
    const base = (arg ? arg.slice('--server='.length) : process.env.LCB_SERVER) || 'http://localhost:8081';
    const trimmed = base.replace(/\/+$/, '');
    // Bare server URLs open the multibox wall; an explicit /bot.html opens a single client.
    return /\.html($|\?)/.test(trimmed) ? trimmed : `${trimmed}/multibox.html`;
}

function createWindow(index, count) {
    const title = count > 1 ? `rs2b0t (${index}/${count})` : 'rs2b0t';
    const win = new BrowserWindow({
        // Leave room for the 765:503 game and 330px panel.
        width: 1480,
        height: 820,
        minWidth: 900,
        minHeight: 560,
        useContentSize: true,
        backgroundColor: '#000000',
        title,
        webPreferences: {
            additionalArguments: count > 1 ? [`--multibox-parallelism=${Math.max(1, Math.floor(4 / count) + (index <= 4 % count ? 1 : 0))}`] : [],
            preload: join(__dirname, 'preload.cjs'),
            nodeIntegrationInSubFrames: true,
            contextIsolation: true,
            sandbox: true,
            // Keep timers and animation frames running while hidden or minimized.
            backgroundThrottling: false
        }
    });

    if (count > 1) win.on('page-title-updated', event => event.preventDefault());
    win.webContents.on('render-process-gone', (_event, details) => {
        console.error(`[${title}] wall renderer exited: ${details.reason} (status ${details.exitCode})`);
    });
    if (loginCoordinator) loginCoordinator.attach(win.webContents, new URL(serverUrl()).origin);
    win.loadURL(serverUrl());
    return win;
}

app.whenReady()
    .then(async () => {
        await storage.start();
        // Why: macOS App Nap can suspend the app while bots are running.
        powerSaveBlocker.start('prevent-app-suspension');

        Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]));

        const count = Number(process.env.B0T_WALL_COUNT ?? 1);
        if (!Number.isSafeInteger(count) || count < 1) throw new Error('Invalid B0T_WALL_COUNT');
        if (count > 1) loginCoordinator = new (require('./wall-logins.cjs').WallLogins)();
        for (let index = 1; index <= count; index++) createWindow(index, count);
        starting = false;

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow(1, count);
            }
        });
    })
    .catch(error => {
        console.error(error);
        app.quit();
    });

app.on('window-all-closed', () => {
    if (!starting) app.quit();
});
