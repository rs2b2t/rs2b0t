export interface DesktopStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
    keys(): string[];
    compareAndSet(key: string, expected: string | null, value: string): boolean;
    subscribe(callback: (key: string, oldValue: string | null, newValue: string | null) => void): void;
}

declare global {
    interface Window {
        rs2b0tDesktopStorage?: DesktopStorage;
    }
}

function resolveDesktopStorage(): DesktopStorage | undefined {
    const host = globalThis as { rs2b0tDesktopStorage?: DesktopStorage; parent?: Window };
    if (host.rs2b0tDesktopStorage) return host.rs2b0tDesktopStorage;
    try {
        const parent = host.parent;
        const shared = parent?.rs2b0tDesktopStorage;
        if (!shared) return undefined;
        return {
            ...shared,
            subscribe(callback) {
                const listener = (event: StorageEvent) => {
                    if (event.key?.startsWith('rs2b0t:')) callback(event.key, event.oldValue, event.newValue);
                };
                parent.addEventListener('storage', listener);
                addEventListener('pagehide', () => parent.removeEventListener('storage', listener), { once: true });
            }
        };
    } catch {
        return undefined;
    }
}

export const desktopStorage = resolveDesktopStorage();
