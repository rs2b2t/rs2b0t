import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
import Packet from '#/client/io/Packet.js';

const entry = new URL('../../fixtures/sound-effects.ts', import.meta.url);
const build = await Bun.build({ entrypoints: [Bun.fileURLToPath(entry)], format: 'cjs' });
const script = new Script(await build.outputs[0].text());

function loadEffects(search: string, math = Math) {
    const module = { exports: {} };
    script.runInNewContext({ module, Math: math, URLSearchParams, location: { search } });
    return module.exports as typeof import('../../fixtures/sound-effects.js');
}

test('61 muted tiles import sound effects without synthesis buffers or table fills', () => {
    const totals = { bytes: 0, random: 0, sine: 0 };
    const math = Object.assign(Object.create(Math), {
        random: () => {
            totals.random++;
            return 0.75;
        },
        sin: (angle: number) => {
            totals.sine++;
            return Math.sin(angle);
        }
    });

    for (let i = 0; i < 61; i++) {
        const { audioEnabled, JagFX, Tone } = loadEffects(`?box=${i}`, math);
        expect(audioEnabled).toBe(false);
        for (const buffer of [JagFX.waveBytes, Tone.buf, Tone.noise, Tone.sine]) {
            totals.bytes += buffer?.byteLength ?? 0;
        }
    }
    expect(totals).toEqual({ bytes: 0, random: 0, sine: 0 });
});

test('a 20 ms sine effect at 440 Hz retains its start delay and WAV samples', () => {
    const { audioEnabled, JagFX } = loadEffects('');
    expect(audioEnabled).toBe(true);
    const pitch = [2, 0, 0, 1, 184, 0, 0, 1, 184, 1, 0, 0, 0, 0];
    const amplitude = [1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 255, 255];
    const harmonic = [100, 64, 0, 0];
    const tone = [...pitch, ...amplitude, 0, 0, 0, ...harmonic, 0, 0, 0, 20, 0, 40, 0];
    const archive = new Uint8Array([0, 1, ...tone, ...new Uint8Array(9), 0, 0, 0, 0, 255, 255]);
    JagFX.init(new Packet(archive));
    expect(JagFX.delays[1]).toBe(2);
    expect(JagFX.generate(0, 1)).toBeNull();
    const wave = JagFX.generate(1, 1)!;
    expect(wave.pos).toBe(485);
    expect(new DataView(wave.data.buffer).getUint32(24, true)).toBe(22050);
    expect(createHash('sha256').update(wave.data.subarray(0, wave.pos)).digest('hex')).toBe('753724dd845d30947be4ee129066bd8cd5ca1a88895659f2a0fb3568f0c2f502');
    expect(JagFX.generate(1, 1)).toBe(wave);
});

test('noise tones reuse the same random lookup table', () => {
    let calls = 0;
    const math = Object.assign(Object.create(Math), { random: () => calls++ % 2 === 0 ? 0.25 : 0.75 });
    const { Tone } = loadEffects('', math);
    const tone = new Tone();
    expect(tone.waveFunc(100, 0, 4)).toBe(-100);
    expect(tone.waveFunc(100, 2607, 4)).toBe(100);
    expect(calls).toBe(32768);
});
