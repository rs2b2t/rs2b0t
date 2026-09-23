const { contextBridge, ipcRenderer } = require('electron');
let snapshot = { version: -1, data: {} };
const listeners = new Set();

function accept(next) {
    if (!next || next.version <= snapshot.version) return;
    const previous = snapshot.data;
    snapshot = next;
    const changes = [...new Set([...Object.keys(previous), ...Object.keys(next.data)])]
        .filter(key => previous[key] !== next.data[key]);
    if (listeners.size) queueMicrotask(() => {
        for (const key of changes) {
            for (const callback of listeners) callback(key, previous[key] ?? null, next.data[key] ?? null);
        }
    });
}

function call(method, ...args) {
    const result = ipcRenderer.sendSync('rs2b0t-storage', method, ...args);
    if (method === 'snapshot' && result.error === 'Invalid storage request') return;
    if (result.error) throw new Error(result.error);
    accept(result.snapshot);
    return result.value;
}

ipcRenderer.on('rs2b0t-storage-changed', (_, next, oldValue, newValue) => {
    if (typeof next === 'string') {
        for (const callback of listeners) callback(next, oldValue, newValue);
    } else accept(next);
});
call('snapshot');

contextBridge.exposeInMainWorld('rs2b0tDesktopStorage', {
    getItem: key => snapshot.version >= 0 && key.startsWith('rs2b0t:') && key.includes(':set:') ? snapshot.data[key] ?? null : call('getItem', key),
    setItem: (key, value) => call('setItem', key, value),
    removeItem: key => call('removeItem', key),
    keys: () => call('keys'),
    compareAndSet: (key, expected, value) => call('compareAndSet', key, expected, value),
    subscribe: callback => { listeners.add(callback); }
});
