import { commitDesktopSettings, desktopStorage, type DesktopStorage, isEncodedSettingKey, setProfileMigrationKey } from '../runtime/desktopStorage.js';

export function installDesktopStorage(shared: DesktopStorage): void {
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
    if (shared.applySettings) {
        const apply = shared.applySettings;
        storage[commitDesktopSettings] = changes => {
            apply(changes);
            if (settings) {
                for (const [key, value] of Object.entries(changes)) {
                    if (value === null) settings.delete(key);
                    else if (needsCache(key)) settings.set(key, value);
                }
            }
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
        if (isSetting(key)) {
            try {
                if (newValue === null) sessionStorage.removeItem(key);
                else sessionStorage.setItem(key, newValue);
            } catch {
                // Why: a failed session mirror must let preload deliver the rest of the durable snapshot.
            }
        }
        window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue }));
    });
}

if (desktopStorage) installDesktopStorage(desktopStorage);
