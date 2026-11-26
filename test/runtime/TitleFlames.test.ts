import { afterEach, beforeEach, expect, jest, mock, spyOn, test } from 'bun:test';
import BotClient from '#/bot/runtime/BotClient.js';
import { RenderGate } from '#/bot/runtime/RenderGate.js';
import Pix8 from '#/client/graphics/Pix8.js';
import PixMap from '#/client/graphics/PixMap.js';
import { Client } from '#/client/shell/Client.js';
import type TitleFlames from '#/client/shell/TitleFlames.js';

const clock = jest as typeof jest & { advanceTimersByTime(ms: number): void; getTimerCount(): number };

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

test('standalone client keeps its 35 ms title animation', async () => {
    RenderGate.setEnabled(false);
    const { client, putImageData } = titleScreen(Client.prototype);
    await Promise.resolve();
    clock.advanceTimersByTime(70);
    expect(putImageData).toHaveBeenCalledTimes(4);
    client.unloadTitle();
});

test('unloading while title progress is pending leaves no animation timer', async () => {
    const { client } = titleScreen();
    client.unloadTitle();
    await Promise.resolve();
    expect(clock.getTimerCount()).toBe(0);
});
