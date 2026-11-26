import { GlobalRegistrator } from '@happy-dom/global-registrator';

// Why: happy-dom's fetch rejects file://, so anything transitively importing Client.ts aborts on tinymidipcm's wasm load. Keep Bun's fetch for file://.
const nativeFetch = globalThis.fetch;

GlobalRegistrator.register();

if (!navigator.locks?.request) {
    const tails = new Map<string, Promise<void>>();
    Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: {
            request<T>(name: string, callback: (lock: Lock) => T) {
                const result = (tails.get(name) ?? Promise.resolve()).then(() => callback({ name, mode: 'exclusive' }));
                tails.set(name, result.then(() => {}, () => {}));
                return result;
            }
        }
    });
}

// Why: loading child-frame bot.html URLs turns DOM tests into network tests and throws ECONNREFUSED with no dev server up.
(
    globalThis.window as unknown as {
        happyDOM: { settings: { navigation: { disableChildFrameNavigation: boolean } } };
    }
).happyDOM.settings.navigation.disableChildFrameNavigation = true;

// Why: tests stub fetch and the wasm loads lazily, so an accessor re-wraps every assignment and file:// reaches Bun whoever is mocking.
const passFileUrlsToBun = (next: typeof fetch): typeof fetch =>
    ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        return url.startsWith('file://') ? nativeFetch(input, init) : next(input, init);
    }) as typeof fetch;

let currentFetch = passFileUrlsToBun(globalThis.fetch);
Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    get: () => currentFetch,
    set: (next: typeof fetch) => {
        currentFetch = passFileUrlsToBun(next);
    }
});

// tinymidipcm.js constructs AudioContext at import time; happy-dom has no Web Audio.
if (typeof globalThis.window !== 'undefined' && !(globalThis.window as { audioContext?: unknown }).audioContext) {
    const param = () => ({
        value: 0,
        setValueAtTime: () => param(),
        linearRampToValueAtTime: () => param(),
        exponentialRampToValueAtTime: () => param(),
        setTargetAtTime: () => param(),
        cancelScheduledValues: () => param()
    });
    const node = () => ({
        gain: param(),
        connect: () => node(),
        disconnect: () => undefined,
        start: () => undefined,
        stop: () => undefined,
        buffer: null
    });
    const silent = {
        createGain: () => node(),
        createBufferSource: () => node(),
        createBuffer: () => ({}),
        createOscillator: () => node(),
        destination: node(),
        sampleRate: 44100,
        currentTime: 0,
        state: 'running',
        resume: async () => undefined
    };
    (globalThis.window as unknown as { audioContext: typeof silent }).audioContext = silent;
}
