import { afterEach, beforeEach } from 'bun:test';

export function useBakeSettingsLocks(): void {
    const original = Object.getOwnPropertyDescriptor(navigator, 'locks');
    beforeEach(() => {
        const held = new Map<string, Promise<void>>();
        Object.defineProperty(navigator, 'locks', { configurable: true, value: {
            async request(name: string, options: LockOptions, run: () => void | Promise<void>) {
                while (held.has(name)) await held.get(name);
                options.signal?.throwIfAborted();
                const released = Promise.withResolvers<void>();
                held.set(name, released.promise);
                try {
                    await run();
                } finally {
                    held.delete(name);
                    released.resolve();
                }
            }
        } });
    });
    afterEach(() => {
        if (original) Object.defineProperty(navigator, 'locks', original);
        else Reflect.deleteProperty(navigator, 'locks');
    });
}
