import { expect, test } from 'bun:test';
import type { DesktopStorage } from '#/bot/runtime/desktopStorage.js';

test('frames without preload use parent storage and release listeners when removed', async () => {
    const originalParent = Object.getOwnPropertyDescriptor(globalThis, 'parent');
    const originalBridge = Object.getOwnPropertyDescriptor(globalThis, 'rs2b0tDesktopStorage');
    const parent = new EventTarget();
    const data = new Map<string, string>([['rs2b0t:alice:set:Fisher:fishMethod', 'Lobster']]);
    const shared: DesktopStorage = {
        getItem: key => data.get(key) ?? null,
        setItem: (key, value) => { data.set(key, value); },
        removeItem: key => { data.delete(key); },
        keys: () => [...data.keys()],
        compareAndSet: () => false,
        subscribe: () => { throw new Error('Parent bridge must not retain the frame'); }
    };
    Object.assign(parent, { rs2b0tDesktopStorage: shared });
    Object.defineProperty(globalThis, 'parent', { configurable: true, value: parent });
    Object.defineProperty(globalThis, 'rs2b0tDesktopStorage', { configurable: true, value: undefined });
    try {
        const module = '../../src/bot/runtime/desktopStorage.ts?parent-fixture';
        const { desktopStorage } = await import(module) as { desktopStorage: DesktopStorage };
        expect(desktopStorage.getItem('rs2b0t:alice:set:Fisher:fishMethod')).toBe('Lobster');
        const changes: (string | null)[] = [];
        desktopStorage.subscribe((_, __, value) => changes.push(value));
        parent.dispatchEvent(new StorageEvent('storage', { key: 'rs2b0t:alice:set:Fisher:fishMethod', newValue: 'Shark' }));
        expect(changes).toEqual(['Shark']);
        globalThis.dispatchEvent(new Event('pagehide'));
        parent.dispatchEvent(new StorageEvent('storage', { key: 'rs2b0t:alice:set:Fisher:fishMethod', newValue: 'Lobster' }));
        expect(changes).toEqual(['Shark']);
    } finally {
        if (originalParent) Object.defineProperty(globalThis, 'parent', originalParent);
        else Reflect.deleteProperty(globalThis, 'parent');
        if (originalBridge) Object.defineProperty(globalThis, 'rs2b0tDesktopStorage', originalBridge);
        else Reflect.deleteProperty(globalThis, 'rs2b0tDesktopStorage');
    }
});
