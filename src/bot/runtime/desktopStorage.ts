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

export const desktopStorage = (globalThis as { rs2b0tDesktopStorage?: DesktopStorage }).rs2b0tDesktopStorage;

