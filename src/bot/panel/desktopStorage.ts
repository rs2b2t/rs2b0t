import { beginLegacySettingsCopy, commitDesktopSettings, desktopStorage, type DesktopStorage, isEncodedSettingKey, legacyCopyStorage, legacyStorageHost, setProfileMigrationKey } from '../runtime/desktopStorage.js';

function dispatchChange(key: string, oldValue: string | null, newValue: string | null): void {
    window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue }));
}

export function installDesktopStorage(shared: DesktopStorage): void {
    const wall = !shared.applySettings && legacyStorageHost();
    if (wall) {
        Object.defineProperty(window, 'localStorage', { value: wall.localStorage });
        shared.subscribe(dispatchChange);
        return;
    }
    const native = window.localStorage;
    const isShared = (key: string) => key.startsWith('rs2b0t:');
    const needsCache = (key: string) => isEncodedSettingKey(key) || key === setProfileMigrationKey;
    const isSetting = (key: string) => key.includes(':set:') || needsCache(key);
    for (const key of Object.keys(native)) {
        if (!isShared(key) || (!isSetting(key) && !key.endsWith(':selectedScript'))) continue;
        const value = native.getItem(key);
        if (value !== null && shared.getItem(key) === null) shared.setItem(key, value);
        native.removeItem(key);
    }
    const keys = () => [...shared.keys(), ...Object.keys(native).filter(key => !isShared(key))];
    let settings: Map<string, string | null | undefined> | undefined;
    function readShared(key: string): string | null {
        if (!needsCache(key)) return shared.getItem(key);
        settings ??= new Map(shared.keys().filter(needsCache).map(k => [k, undefined]));
        if (!settings.has(key)) return null;
        const cached = settings.get(key);
        if (cached !== undefined) return cached;
        const value = shared.getItem(key);
        settings.set(key, value);
        return value;
    }
    const storage: Storage = {
        get length() {
            return keys().length;
        },
        key: index => keys()[index] ?? null,
        getItem: key => (isShared(key) ? readShared(key) : native.getItem(key)),
        setItem(key, value) {
            if (!isShared(key)) return native.setItem(key, value);
            shared.setItem(key, String(value));
            if (needsCache(key)) settings?.set(key, String(value));
        },
        removeItem(key) {
            if (!isShared(key)) return native.removeItem(key);
            shared.removeItem(key);
            settings?.delete(key);
        },
        clear: () => {
            for (const key of keys()) storage.removeItem(key);
        }
    };
    let rolledBack: Set<string> | undefined;
    if (shared.applySettings) {
        const apply = shared.applySettings;
        storage[commitDesktopSettings] = changes => {
            if (apply(changes, true) === false) {
                settings = undefined;
                return false;
            }
            if (settings) {
                for (const [key, value] of Object.entries(changes)) {
                    if (value === null) settings.delete(key);
                    else if (needsCache(key)) settings.set(key, value);
                }
            }
        };
    } else {
        storage[legacyCopyStorage] = {
            read: key => (shared.getItemFresh ?? shared.getItem)(key),
            swap(key, expected, value) {
                try {
                    if (value !== null) return shared.compareAndSet(key, expected, value);
                    if (expected === null || !shared.compareAndSet(key, expected, expected)) return false;
                    return shared.removeItem(key, expected) !== false;
                } finally {
                    settings = undefined;
                }
            }
        };
        storage[beginLegacySettingsCopy] = () => {
            let keys: Set<string> | undefined;
            // Why: preload queues each write's mirror between these two microtasks.
            queueMicrotask(() => { rolledBack = keys; });
            return restoredKeys => {
                keys = new Set(restoredKeys);
                queueMicrotask(() => { rolledBack = undefined; });
            };
        };
    }
    Object.defineProperty(window, 'localStorage', {
        value: new Proxy(storage, {
            ownKeys: keys,
            getOwnPropertyDescriptor: (_, key) => typeof key === 'string' && keys().includes(key) ? { configurable: true, enumerable: true, value: storage.getItem(key) } : undefined,
            get: (target, key, receiver) => typeof key === 'string' && !(key in target) ? storage.getItem(key) : Reflect.get(target, key, receiver),
            set: (_, key, value) => { storage.setItem(String(key), String(value)); return true; },
            deleteProperty: (_, key) => { storage.removeItem(String(key)); return true; }
        })
    });
    shared.subscribe((key, oldValue, newValue) => {
        if (settings && needsCache(key)) {
            if (newValue === null) settings.delete(key);
            else settings.set(key, undefined);
        }
        if (isSetting(key) && !rolledBack?.has(key)) {
            try {
                if (newValue === null) sessionStorage.removeItem(key);
                else sessionStorage.setItem(key, newValue);
            } catch {
                // Why: a failed session mirror must let preload deliver the rest of the durable snapshot.
            }
        }
        dispatchChange(key, oldValue, newValue);
    });
}

if (desktopStorage) installDesktopStorage(desktopStorage);
