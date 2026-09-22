import { desktopStorage } from '../runtime/desktopStorage.js';

if (desktopStorage) {
    const shared = desktopStorage;
    const native = window.localStorage;
    const isShared = (key: string) => key.startsWith('rs2b0t:');
    const keys = () => [...shared.keys(), ...Object.keys(native).filter(key => !isShared(key))];
    const storage: Storage = {
        get length() {
            return keys().length;
        },
        key: index => keys()[index] ?? null,
        getItem: key => (isShared(key) ? shared.getItem(key) : native.getItem(key)),
        setItem: (key, value) => (isShared(key) ? shared.setItem(key, String(value)) : native.setItem(key, value)),
        removeItem: key => (isShared(key) ? shared.removeItem(key) : native.removeItem(key)),
        clear: () => {
            for (const key of keys()) storage.removeItem(key);
        }
    };
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
        if (key.includes(':set:')) {
            if (newValue === null) sessionStorage.removeItem(key);
            else sessionStorage.setItem(key, newValue);
        }
        window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue }));
    });
}
