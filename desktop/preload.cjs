const { contextBridge, ipcRenderer } = require('electron');
let snapshot = { version: -1, data: {} };
const listeners = new Set();

function accept(next) {
    if (!next || next.version <= snapshot.version) return;
    const previous = snapshot.data;
    const events = [];
    if (next.changes) {
        if (snapshot.version < 0 || next.version !== snapshot.version + 1) return call('snapshot');
        for (const [key, value] of Object.entries(next.changes)) {
            if (listeners.size) events.push([key, previous[key] ?? null, value]);
            if (value === null) delete previous[key];
            else previous[key] = value;
        }
        for (const key of next.append ?? []) {
            const value = previous[key];
            delete previous[key];
            previous[key] = value;
        }
        snapshot.version = next.version;
    } else {
        if (listeners.size) {
            for (const key of new Set([...Object.keys(previous), ...Object.keys(next.data)])) {
                if (previous[key] !== next.data[key]) events.push([key, previous[key] ?? null, next.data[key] ?? null]);
            }
        }
        snapshot = next;
    }
    if (events.length) queueMicrotask(() => {
        for (const event of events) {
            for (const callback of listeners) callback(...event);
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
    keys: () => snapshot.version >= 0 ? Object.keys(snapshot.data) : call('keys'),
    compareAndSet: (key, expected, value) => call('compareAndSet', key, expected, value),
    subscribe: callback => { listeners.add(callback); }
});

const parallelism = typeof process !== 'undefined' && process.isMainFrame && process.argv.find(arg => arg.startsWith('--multibox-parallelism='));
if (parallelism) {
    let nextId = 0;
    contextBridge.exposeInMainWorld('rs2b0tLoginCoordinator', {
        parallelism: Number(parallelism.split('=')[1]),
        claimProfile: name => ipcRenderer.sendSync('rs2b0t-login', 0, 'claimProfile', name) === true,
        releaseProfile: name => ipcRenderer.sendSync('rs2b0t-login', 0, 'releaseProfile', name),
        register() {
            const id = ++nextId;
            let waiting = false;
            const call = (action, delay) => ipcRenderer.sendSync('rs2b0t-login', id, action, delay);
            return {
                requestPermit() { waiting = !call('requestPermit'); return !waiting; },
                queueStatus() { return waiting ? call('queueStatus') : null; },
                leaveQueue() { if (waiting) call('leaveQueue'); waiting = false; },
                holdFor: delay => call('holdFor', delay)
            };
        }
    });
}
