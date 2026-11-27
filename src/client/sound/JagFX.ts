import Packet from '#/client/io/Packet.js';

import { SAMPLE_RATE, millisecondsToSamples } from '#/client/sound/SampleRate.js';
import Tone from '#/client/sound/Tone.js';

import { TypedArray1d } from '#/client/util/Arrays.js';

export default class JagFX {
    static synth: (JagFX | null)[] = new TypedArray1d(1000, null);
    static delays: Int32Array = new Int32Array(1000);

    static waveBytes?: Uint8Array;
    static waveBuffer?: Packet;

    tones: (Tone | null)[] = new TypedArray1d(10, null);
    loopBegin: number = 0;
    loopEnd: number = 0;

    static init(buf: Packet): void {
        while (true) {
            const id = buf.g2();
            if (id === 65535) {
                break;
            }

            this.synth[id] = new JagFX();
            this.synth[id].load(buf);
            this.delays[id] = this.synth[id].optimiseStart();
        }
    }

    static generate(id: number, loopCount: number): Packet | null {
        const sound = this.synth[id];
        if (sound === null) {
            return null;
        }

        return sound.getWave(loopCount);
    }

    load(dat: Packet): void {
        for (let tone = 0; tone < 10; tone++) {
            if (dat.g1() !== 0) {
                dat.pos--;

                this.tones[tone] = new Tone();
                this.tones[tone]!.load(dat);
            }
        }

        this.loopBegin = dat.g2();
        this.loopEnd = dat.g2();
    }

    optimiseStart(): number {
        let start = 9999999;
        for (let i = 0; i < 10; i++) {
            const tone = this.tones[i];
            if (tone !== null && ((tone.start / 20) | 0) < start) {
                start = (tone.start / 20) | 0;
            }
        }

        if (this.loopBegin < this.loopEnd && ((this.loopBegin / 20) | 0) < start) {
            start = (this.loopBegin / 20) | 0;
        }

        if (start === 9999999 || start === 0) {
            return 0;
        }

        for (let i = 0; i < 10; i++) {
            const tone = this.tones[i];
            if (tone !== null) {
                tone.start -= start * 20;
            }
        }

        if (this.loopBegin < this.loopEnd) {
            this.loopBegin -= start * 20;
            this.loopEnd -= start * 20;
        }

        return start;
    }

    getWave(loopCount: number): Packet {
        const waveBytes = JagFX.waveBytes ??= new Uint8Array(SAMPLE_RATE * 20);
        const waveBuffer = JagFX.waveBuffer ??= new Packet(waveBytes);
        const length = this.makeSound(loopCount, waveBytes);
        waveBuffer.pos = 0;
        waveBuffer.p4(0x52494646);
        waveBuffer.ip4(length + 36);
        waveBuffer.p4(0x57415645);
        waveBuffer.p4(0x666d7420);
        waveBuffer.ip4(16);
        waveBuffer.ip2(1);
        waveBuffer.ip2(1);
        waveBuffer.ip4(SAMPLE_RATE);
        waveBuffer.ip4(SAMPLE_RATE);
        waveBuffer.ip2(1);
        waveBuffer.ip2(8);
        waveBuffer.p4(0x64617461);
        waveBuffer.ip4(length);
        waveBuffer.pos += length;
        return waveBuffer;
    }

    private makeSound(loopCount: number, waveBytes: Uint8Array): number {
        let duration = 0;
        for (let i = 0; i < 10; i++) {
            const tone = this.tones[i];
            if (tone !== null && tone.length + tone.start > duration) {
                duration = tone.length + tone.start;
            }
        }

        if (duration === 0) {
            return 0;
        }

        let sampleCount = millisecondsToSamples(duration);
        let loopStart = millisecondsToSamples(this.loopBegin);
        let loopStop = millisecondsToSamples(this.loopEnd);

        if (loopStart < 0 || loopStop < 0 || loopStop > sampleCount || loopStart >= loopStop) {
            loopCount = 0;
        }

        let totalSampleCount = sampleCount + (loopStop - loopStart) * (loopCount - 1);
        for (let sample = 44; sample < totalSampleCount + 44; sample++) {
            waveBytes[sample] = -128;
        }

        for (let i = 0; i < 10; i++) {
            const tone = this.tones[i];
            if (tone !== null) {
                const toneSampleCount = millisecondsToSamples(tone.length);
                const start = millisecondsToSamples(tone.start);
                const samples = tone.generate(toneSampleCount, tone.length);

                for (let sample = 0; sample < toneSampleCount; sample++) {
                    waveBytes[sample + start + 44] += ((samples[sample] >> 8) << 24) >> 24;
                }
            }
        }

        if (loopCount > 1) {
            loopStart += 44;
            loopStop += 44;
            sampleCount += 44;
            totalSampleCount += 44;

            const endOffset = totalSampleCount - sampleCount;
            for (let sample = sampleCount - 1; sample >= loopStop; sample--) {
                waveBytes[sample + endOffset] = waveBytes[sample];
            }

            for (let loop = 1; loop < loopCount; loop++) {
                const offset = (loopStop - loopStart) * loop;

                for (let sample = loopStart; sample < loopStop; sample++) {
                    waveBytes[sample + offset] = waveBytes[sample];
                }
            }

            totalSampleCount -= 44;
        }

        return totalSampleCount;
    }
}
