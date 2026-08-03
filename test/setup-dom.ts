import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();

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
    (globalThis.window as { audioContext: typeof silent }).audioContext = silent;
}
