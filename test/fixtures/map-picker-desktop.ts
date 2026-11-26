import '../setup-dom.js';
import type { DesktopStorage } from '#/bot/runtime/desktopStorage.js';

const data = new Map<string, string>();
Reflect.set(globalThis, 'rs2b0tDesktopStorage', {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key),
    keys: () => [...data.keys()],
    compareAndSet(key, expected, value) {
        if (localStorage.getItem(key) !== expected) return false;
        localStorage.setItem(key, value);
        return true;
    },
    subscribe: () => {}
} satisfies DesktopStorage);
await import('#/bot/panel/desktopStorage.js');
