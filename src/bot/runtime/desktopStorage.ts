export const commitDesktopSettings = Symbol('commitDesktopSettings');
export const beginLegacySettingsCopy = Symbol.for('rs2b0t:beginLegacySettingsCopy');
type ApplySettings = (changes: Record<string, string | null>) => void;

export interface DesktopStorage {
    applySettings?: ApplySettings;
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
    keys(): string[];
    compareAndSet(key: string, expected: string | null, value: string): boolean;
    subscribe(callback: (key: string, oldValue: string | null, newValue: string | null) => void): void;
}

declare global {
    interface Storage {
        [beginLegacySettingsCopy]?(): (restoredKeys: string[]) => void;
        [commitDesktopSettings]?: ApplySettings;
    }
    interface Window {
        rs2b0tDesktopStorage?: DesktopStorage;
    }
}

export function legacyStorageHost(): Window | undefined {
    try {
        const top = globalThis.window?.top;
        if (top && top !== window && top.localStorage[beginLegacySettingsCopy]) return top;
    } catch {
        return undefined;
    }
}

function resolveDesktopStorage(): DesktopStorage | undefined {
    const host = globalThis as { rs2b0tDesktopStorage?: DesktopStorage; parent?: Window };
    const own = host.rs2b0tDesktopStorage;
    if (own?.applySettings) return own;
    const wall = legacyStorageHost();
    if (own && !wall) return own;
    try {
        const parent = wall ?? host.parent;
        const shared = parent?.rs2b0tDesktopStorage;
        if (!shared) return own;
        return {
            ...shared,
            subscribe(callback) {
                const listener = (event: StorageEvent) => {
                    if (event.storageArea === null && event.key?.startsWith('rs2b0t:')) callback(event.key, event.oldValue, event.newValue);
                };
                parent.addEventListener('storage', listener);
                addEventListener('pagehide', () => parent.removeEventListener('storage', listener), { once: true });
            }
        };
    } catch {
        return own;
    }
}

export const desktopStorage = resolveDesktopStorage();

export const setProfileMigrationKey = 'rs2b0t:set-profile-settings-v1';
export const settingsStoragePrefix = 'rs2b0t:set-settings-v1/';

export function isEncodedSettingKey(key: string): boolean {
    return key.startsWith(settingsStoragePrefix) && !key.includes(':', settingsStoragePrefix.length);
}

export function storeKeys(store: Storage): string[] {
    if (desktopStorage && store === globalThis.localStorage) return desktopStorage.keys();
    const keys: string[] = [];
    const length = store.length;
    for (let i = 0; i < length; i++) {
        const key = store.key(i);
        if (key) keys.push(key);
    }
    return keys;
}
