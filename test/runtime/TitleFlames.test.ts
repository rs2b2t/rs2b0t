import { afterEach, beforeEach, expect, jest, mock, spyOn, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import BotClient from '#/bot/runtime/BotClient.js';
import { RenderGate, RenderGateController } from '#/bot/runtime/RenderGate.js';
import Pix8 from '#/client/graphics/Pix8.js';
import PixMap from '#/client/graphics/PixMap.js';
import { Client } from '#/client/shell/Client.js';
import TitleFlames from '#/client/shell/TitleFlames.js';

const clock = jest as typeof jest & { advanceTimersByTime(ms: number): void; advanceTimersToNextTimer(): void; getTimerCount(): number };

function titleScreen(prototype: Client = BotClient.prototype) {
    const putImageData = mock(() => {});
    const context = {
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData
    } as unknown as CanvasRenderingContext2D;
    const client = Object.assign(Object.create(prototype), {
        title: {},
        searchParams: new URLSearchParams(),
        imageRunes: [],
        imageTitle0: new PixMap(128, 265, context),
        imageTitle1: new PixMap(128, 265, context),
        drawProgress: async () => {}
    }) as { loadTitleImages(): void; unloadTitle(): void; titleFlames: TitleFlames | null };
    client.loadTitleImages();
    return { client, putImageData };
}

const originalGate = { ...RenderGate };

beforeEach(() => {
    jest.useFakeTimers();
    spyOn(PixMap.prototype, 'setPixels').mockImplementation(() => {});
    spyOn(Pix8, 'depack').mockReturnValue(new Pix8(1, 1, new Int32Array(1)));
});

afterEach(() => {
    Object.assign(RenderGate, originalGate);
    mock.restore();
    jest.useRealTimers();
});

test.each(['hidden', 'renderer off'])('%s pauses flame updates and canvas writes until focus returns', async state => {
    const { client, putImageData } = titleScreen();
    await Promise.resolve();
    clock.advanceTimersByTime(35);
    expect(putImageData).toHaveBeenCalledTimes(2);
    const flames = client.titleFlames!;
    const cooling = flames.coolingCycle;
    putImageData.mockClear();

    if (state === 'hidden') RenderGate.setMode('hidden');
    else RenderGate.setEnabled(false);
    expect(clock.getTimerCount()).toBe(0);
    clock.advanceTimersByTime(1000);
    expect(putImageData).toHaveBeenCalledTimes(0);
    expect(flames.coolingCycle).toBe(cooling);

    RenderGate.setMode('focused');
    RenderGate.setEnabled(true);
    clock.advanceTimersByTime(35);
    expect(putImageData).toHaveBeenCalledTimes(2);

    client.unloadTitle();
    expect(clock.getTimerCount()).toBe(0);
    clock.advanceTimersByTime(1000);
    expect(putImageData).toHaveBeenCalledTimes(2);
});

test.each([30, 61])('a %i-slot title wall wakes only on draw ticks', size => {
    let callbacks = 0;
    let draws = 0;
    RenderGate.backgroundIntervalMs = 1000;
    for (let slot = 0; slot < size; slot++) {
        RenderGate.setMode(slot === 0 ? 'focused' : 'background');
        const flames = new TitleFlames([]);
        const start = performance.now();
        const timestamps: number[] = [];
        flames.renderFlames = () => timestamps.push(performance.now() - start);
        BotClient.prototype['startTitleFlames'](flames);
        let finished = false;
        setTimeout(() => { finished = true; }, 60_000);
        while (!finished) {
            clock.advanceTimersToNextTimer();
            if (!finished) callbacks++;
        }
        flames.close();
        const expected = [];
        for (let ms = 35; ms <= 60_000; ms += slot === 0 ? 35 : 1015) expected.push(ms);
        expect(timestamps).toEqual(expected);
        draws += timestamps.length;
    }
    expect({ callbacks, draws }).toEqual({ callbacks: draws, draws: 1714 + (size - 1) * 60 });
});

test('unloading a parked title detaches it from the gate', async () => {
    RenderGate.setEnabled(false);
    const { client, putImageData } = titleScreen();
    await Promise.resolve();
    expect(client.titleFlames?.active).toBe(true);
    expect(clock.getTimerCount()).toBe(0);
    client.unloadTitle();
    RenderGate.setEnabled(true);
    expect(clock.getTimerCount()).toBe(0);
    clock.advanceTimersByTime(70);
    expect(putImageData).toHaveBeenCalledTimes(0);
});

test('background flames follow the configured draw interval', async () => {
    const { client, putImageData } = titleScreen();
    await Promise.resolve();
    clock.advanceTimersByTime(35);
    expect(putImageData).toHaveBeenCalledTimes(2);
    RenderGate.backgroundIntervalMs = 350;
    RenderGate.setMode('background');
    clock.advanceTimersByTime(349);
    expect(putImageData).toHaveBeenCalledTimes(2);
    RenderGate.markDrawn(performance.now());
    clock.advanceTimersByTime(1);
    expect(putImageData).toHaveBeenCalledTimes(4);
    client.unloadTitle();
});

test('rail interval and focus changes use the original flame tick phase', async () => {
    RenderGate.setMode('background');
    RenderGate.backgroundIntervalMs = 1000;
    const { client, putImageData } = titleScreen();
    await Promise.resolve();
    clock.advanceTimersByTime(236);
    expect(putImageData).toHaveBeenCalledTimes(2);
    RenderGate.backgroundIntervalMs = 120;
    clock.advanceTimersByTime(8);
    expect(putImageData).toHaveBeenCalledTimes(2);
    clock.advanceTimersByTime(1);
    expect(putImageData).toHaveBeenCalledTimes(4);
    RenderGate.backgroundIntervalMs = 1000;
    clock.advanceTimersByTime(200);
    expect(putImageData).toHaveBeenCalledTimes(4);
    RenderGate.setMode('focused');
    clock.advanceTimersByTime(10);
    expect(putImageData).toHaveBeenCalledTimes(6);
    client.unloadTitle();
    RenderGate.setMode('hidden');
    RenderGate.setMode('focused');
    expect(clock.getTimerCount()).toBe(0);
});

test('standalone client keeps its 35 ms title animation', async () => {
    RenderGate.setEnabled(false);
    const { client, putImageData } = titleScreen(Client.prototype);
    await Promise.resolve();
    clock.advanceTimersByTime(70);
    expect(putImageData).toHaveBeenCalledTimes(4);
    client.unloadTitle();
});

test('a rail switch queued before a due flame tick preserves that draw', () => {
    const flames = new TitleFlames([]);
    const start = performance.now();
    const draws: number[] = [];
    flames.renderFlames = () => draws.push(performance.now() - start);
    setTimeout(() => {
        RenderGate.backgroundIntervalMs = 1000;
        RenderGate.setMode('background');
    }, 35);
    BotClient.prototype['startTitleFlames'](flames);
    clock.advanceTimersByTime(2099);
    flames.close();
    expect(draws).toEqual([35, 1050, 2065]);
});

test('unparking after a hidden tick waits for the next rail tick', () => {
    const gate = new RenderGateController();
    gate.setMode('hidden');
    gate.backgroundIntervalMs = 1000;
    const flames = new TitleFlames([]);
    const start = performance.now();
    const draws: number[] = [];
    flames.renderFlames = () => draws.push(performance.now() - start);
    flames.start(gate);
    clock.advanceTimersByTime(35);
    gate.setMode('background');
    clock.advanceTimersByTime(1050);
    flames.close();
    expect(draws).toEqual([70, 1085]);
});

test('a late focused callback resumes on the original tick grid', () => {
    const start = Date.now();
    let lateness = 0;
    spyOn(performance, 'now').mockImplementation(() => Date.now() - start + lateness);
    const flames = new TitleFlames([]);
    const draws: number[] = [];
    flames.renderFlames = () => draws.push(performance.now());
    flames.start(new RenderGateController());
    lateness = 48;
    clock.advanceTimersByTime(140 - lateness);
    flames.close();
    expect(draws).toEqual([83, 105, 140]);
});

test('unloading while title progress is pending leaves no animation timer', async () => {
    const { client } = titleScreen();
    client.unloadTitle();
    await Promise.resolve();
    expect(clock.getTimerCount()).toBe(0);
});

test('byte grids preserve title panels and intensities through cooling-map rollover', () => {
    const fixture = join(import.meta.dir, 'fixtures/titleFlames.ts');
    const source = join(import.meta.dir, '../../src/client/shell/TitleFlames.ts');
    const result = JSON.parse(execFileSync(process.execPath, ['--no-env-file', '--no-install', fixture, source, '1', '130'], { encoding: 'utf8' }));
    expect(result.coolingCycle).toBe(512);
    expect(result.draws).toBe(260);
    expect(result.panels).toBe('56abddfe147d02237fb74da3019b27808b97b875f3822d939aa00e0873439e93');
    expect(result.grids).toBe('b840131fcd9e9083b96fcff7ae3f171cfa10c900248a7bd5931d1cfc365655d6');
    expect(result.bytes).toBe(128 * 1024);
});
