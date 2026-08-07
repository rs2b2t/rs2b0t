import { GlobalRegistrator } from '@happy-dom/global-registrator';

// Bun's fetch reads file:// URLs; happy-dom's replacement rejects the scheme
// outright. tinymidipcm.mjs instantiates its wasm from a file:// URL at import
// time, so anything that transitively imports Client.ts — WalkExecutor via
// ClientAdapter, for one — aborts on load once happy-dom is registered. Keep the
// native implementation for file:// and hand everything else to happy-dom.
const nativeFetch = globalThis.fetch;

GlobalRegistrator.register();

// Unit tests inspect iframe structure and orchestration only. Loading their
// bot.html URLs would turn isolated DOM tests into network integration tests
// and produces unhandled ECONNREFUSED errors when no dev server is running.
(
    globalThis.window as unknown as {
        happyDOM: { settings: { navigation: { disableChildFrameNavigation: boolean } } };
    }
).happyDOM.settings.navigation.disableChildFrameNavigation = true;

// Tests legitimately stub fetch (test/config/loginKey.test.ts serves canned login
// modulus responses), and the wasm loads lazily, so whichever stub happens to be
// installed at that moment would otherwise receive the file:// request. Install
// fetch as an accessor instead of a value: every assignment is re-wrapped, so
// file:// always reaches Bun no matter who is mocking, and the mock still sees
// every request it actually cares about.
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
