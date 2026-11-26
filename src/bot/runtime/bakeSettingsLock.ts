import { desktopStorage } from './desktopStorage.js';

const lockName = 'rs2b0t:map-picker-bake-settings';

export function withBakeSettingsLock(write: () => void, signal?: AbortSignal): void | Promise<void> {
    if (desktopStorage || typeof localStorage === 'undefined') return write();
    if (navigator.locks?.request) return navigator.locks.request<void>(lockName, { signal }, async () => write());
    return withDatabaseLock(write, signal);
}

// Why: on plain HTTP an IndexedDB readwrite transaction can still serialize same-origin writers.
async function withDatabaseLock(write: () => void, signal?: AbortSignal): Promise<void> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open(lockName, 1);
        open.onupgradeneeded = () => open.result.createObjectStore('lock');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => resolve(open.result);
    });
    try {
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('lock', 'readwrite');
            tx.onabort = () => reject(tx.error);
            tx.objectStore('lock').get(0).onsuccess = () => {
                try {
                    signal?.throwIfAborted();
                    write();
                    resolve();
                } catch (err) {
                    reject(err);
                }
            };
        });
    } finally {
        db.close();
    }
}
