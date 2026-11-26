import { mock } from 'bun:test';

export function registerSilentAudio(): void {
    mock.module('#/client/3rdparty/audio.js', () => ({
        playWave: async (): Promise<void> => {},
        setWaveVolume: (): void => {}
    }));
    mock.module('#/client/3rdparty/tinymidipcm.js', () => ({
        playMidi: (): void => {},
        setMidiVolume: (): void => {},
        stopMidi: (): void => {}
    }));
}
