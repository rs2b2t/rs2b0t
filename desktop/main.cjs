// LCBuddy2 desktop shell: runs the bot client as a standalone window with
// background throttling DISABLED — the whole reason this exists. A browser
// tab clamps setTimeout to ~1/s when hidden, stalling the 50fps game loop
// and starving the bot (then replaying everything at 2-5x on refocus). Here
// the loop keeps full speed minimized, hidden, or occluded.
//
// Server: --server=http://host:port (or LCB_SERVER env). Defaults to the
// local dev engine. The page is loaded FROM the server so the client's
// same-origin WebSocket + asset fetches work unchanged.
const { app, BrowserWindow, Menu, powerSaveBlocker } = require('electron');

// Belt & braces with webPreferences.backgroundThrottling below — these kill
// Chromium's process-level background throttling/occlusion detection.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

function serverUrl() {
    const arg = process.argv.find(a => a.startsWith('--server='));
    const base = (arg ? arg.slice('--server='.length) : process.env.LCB_SERVER) || 'http://localhost:8081';
    const trimmed = base.replace(/\/+$/, '');
    // The multibox wall is the primary client: it hosts each bot as a /bot.html
    // iframe, and a single bot is just a focused 1-cell wall. Default a bare
    // host URL to the wall; pass an explicit …/bot.html to open one raw client.
    return /\.html($|\?)/.test(trimmed) ? trimmed : `${trimmed}/multibox.html`;
}

function createWindow() {
    const win = new BrowserWindow({
        // wide enough that the game (765:503 + a 330px panel) scales up to
        // roughly fill the height instead of sitting in black margins
        width: 1480,
        height: 820,
        minWidth: 900,
        minHeight: 560,
        useContentSize: true,
        backgroundColor: '#000000',
        title: 'rs2b0t',
        webPreferences: {
            // THE flag: keep timers/rAF at full rate while hidden/minimized
            backgroundThrottling: false
            // no preload/nodeIntegration: the page is plain trusted web
            // content served by your own engine
        }
    });

    win.loadURL(serverUrl());
    return win;
}

app.whenReady().then(() => {
    // keep the app from being suspended (macOS App Nap etc.) while bots run
    powerSaveBlocker.start('prevent-app-suspension');

    Menu.setApplicationMenu(
        Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }])
    );

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => app.quit());
