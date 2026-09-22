const { contextBridge, ipcRenderer } = require('electron');

function call(method, ...args) {
    const result = ipcRenderer.sendSync('rs2b0t-storage', method, ...args);
    if (result.error) throw new Error(result.error);
    return result.value;
}

contextBridge.exposeInMainWorld('rs2b0tDesktopStorage', {
    getItem: key => call('getItem', key),
    setItem: (key, value) => call('setItem', key, value),
    removeItem: key => call('removeItem', key),
    keys: () => call('keys'),
    compareAndSet: (key, expected, value) => call('compareAndSet', key, expected, value),
    subscribe: callback => ipcRenderer.on('rs2b0t-storage-changed', (_, key, oldValue, newValue) => callback(key, oldValue, newValue))
});
