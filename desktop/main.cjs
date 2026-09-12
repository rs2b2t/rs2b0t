// Desktop client with background throttling disabled. Hidden browser tabs otherwise stall the 50fps game loop.
// --server=http://host:port or LCB_SERVER overrides the local engine URL; load from the server to keep assets and WebSockets same-origin.
const { app, BrowserWindow, Menu, powerSaveBlocker } = require('electron');

// Why: backgroundThrottling alone doesn't disable Chromium's process-level throttling.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

function serverUrl() {
    const arg = process.argv.find(a => a.startsWith('--server='));
    const base = (arg ? arg.slice('--server='.length) : process.env.LCB_SERVER) || 'http://localhost:8081';
    const trimmed = base.replace(/\/+$/, '');
    // Bare server URLs open the multibox wall; an explicit /bot.html opens a single client.
    return /\.html($|\?)/.test(trimmed) ? trimmed : `${trimmed}/multibox.html`;
}

function createWindow() {
    const win = new BrowserWindow({
        // Leave room for the 765:503 game and 330px panel.
        width: 1480,
        height: 820,
        minWidth: 900,
        minHeight: 560,
        useContentSize: true,
        backgroundColor: '#000000',
        title: 'rs2b0t',
        webPreferences: {
            // Keep timers and animation frames running while hidden or minimized.
            backgroundThrottling: false
        }
    });

    win.loadURL(serverUrl());
    return win;
}

app.whenReady().then(() => {
    // Why: macOS App Nap can suspend the app while bots are running.
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
