import { expect, jest, spyOn, test } from 'bun:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { EventTarget as DomEventTarget, PropertySymbol, Window } from 'happy-dom';
import { regenerateBasemap } from '#/bot/panel/basemapRegen.js';
import { WorldMapPicker } from '#/bot/panel/WorldMapPicker.js';

function resources() {
    if (!(document instanceof DomEventTarget)) throw new Error('Expected a synthetic document');
    const { bubbling, capturing } = document[PropertySymbol.listeners];
    return {
        backdrops: document.querySelectorAll('.rs2b0t-modal-backdrop').length,
        keydowns: (bubbling.get('keydown')?.length ?? 0) + (capturing.get('keydown')?.length ?? 0),
        pickers: document.querySelectorAll('.rs2b0t-walkmap-overlay').length
    };
}

function pressEscape(): void {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

function packWithWalkableOrigin(): Uint8Array<ArrayBuffer> {
    const pack = new Uint8Array(13 + 4096 + 512);
    pack.set([0x4c, 0x43, 0x4e, 0x56, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    pack[13 + 4096] = 1;
    return pack;
}

function selectCentre(picker: HTMLElement): void {
    const canvas = picker.querySelector('canvas')!;
    const point = { clientX: canvas.width / 2, clientY: canvas.height / 2 };
    canvas.dispatchEvent(new PointerEvent('pointerdown', point));
    canvas.dispatchEvent(new PointerEvent('pointerup', point));
    canvas.dispatchEvent(new MouseEvent('click', point));
}

test.each(['Cancel', 'Escape', 'Confirm'])('%s releases picker settings after each visit', async action => {
    const tile = { x: 0, z: 0, level: 0 };
    const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch')!;
    Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        value: async (url: URL) => url.pathname.endsWith('/collision.lcnav.gz')
            ? new Response(packWithWalkableOrigin())
            : new Response(null, { status: 404 })
    });
    const frame = spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1);
    const sharedDOM = { window, document };
    const pickerWindow = new Window();
    Object.assign(globalThis, { window: pickerWindow, document: pickerWindow.document });
    try {
        const before = resources();
        for (let i = 0; i < 5; i++) {
            const result = WorldMapPicker.open(tile);
            await new Promise<void>(resolve => setImmediate(resolve));
            const picker = document.querySelector<HTMLElement>('.rs2b0t-walkmap-overlay')!;
            if (action === 'Confirm') {
                picker.querySelector<HTMLButtonElement>('.rs2b0t-walkmap-settings')!.click();
                const settings = document.querySelector<HTMLElement>('.rs2b0t-modal-backdrop:last-child')!;
                expect(settings.style.display).toBe('flex');
                pressEscape();
                expect(settings.style.display).toBe('none');
                expect(picker.isConnected).toBe(true);
                selectCentre(picker);
                const confirm = picker.querySelector<HTMLButtonElement>('.rs2b0t-walkmap-confirm')!;
                expect(confirm.disabled).toBe(false);
                confirm.click();
            } else if (action === 'Escape') {
                pressEscape();
            } else {
                picker.querySelector<HTMLButtonElement>('.rs2b0t-walkmap-cancel')!.click();
            }
            expect(resources()).toEqual(before);
            expect(await result).toEqual(action === 'Confirm' ? tile : null);
        }
    } finally {
        document.querySelector<HTMLButtonElement>('.rs2b0t-walkmap-cancel')?.click();
        frame.mockRestore();
        Object.defineProperty(globalThis, 'fetch', originalFetch);
        sessionStorage.clear();
        localStorage.clear();
        Object.assign(globalThis, sharedDOM);
        await pickerWindow.happyDOM.close();
    }
});

test.each(['response', 'body'])('Rebuild recovers when the worldmap %s stalls', async stage => {
    const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch')!;
    const held = Promise.withResolvers<never>();
    let signal: AbortSignal | null | undefined;
    let requests = 0;
    Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        value: async (url: string | URL, init?: RequestInit) => {
            if (!String(url).endsWith('/worldmap.jag')) return new Response(null, { status: 404 });
            requests++;
            if (requests === 1) await new Promise(resolve => setTimeout(resolve, 60_000));
            if (requests !== 2) return new Response(null, { status: 404 });
            signal = init?.signal;
            return stage === 'response' ? held.promise : { ok: true, arrayBuffer: () => held.promise };
        }
    });
    const frame = spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1);
    const originalUrl = location.href;
    const dom = (window as unknown as Window).happyDOM;
    const clock = jest as typeof jest & { advanceTimersByTime(ms: number): void };
    try {
        dom.setURL('https://picker.test/map/');
        jest.useFakeTimers();
        void WorldMapPicker.open();
        const rebuild = document.querySelector<HTMLButtonElement>('.rs2b0t-walkmap-rebuild')!;
        rebuild.click();
        document.querySelector<HTMLButtonElement>('.rs2b0t-confirm-yes')?.click();
        await nextTurn();
        expect(requests).toBe(1);
        const retry = regenerateBasemap().catch((err: Error) => err.message);
        expect(rebuild.disabled).toBe(true);
        clock.advanceTimersByTime(60_000);
        await nextTurn();
        expect(requests).toBe(2);
        clock.advanceTimersByTime(59_999);
        await nextTurn();
        expect(rebuild.disabled).toBe(true);
        clock.advanceTimersByTime(1);
        await nextTurn();
        expect(rebuild.disabled).toBe(false);
        expect(document.querySelector('.rs2b0t-walkmap-status')?.textContent).toMatch(/rebuild failed: .*timed out/);
        expect(signal?.aborted).toBe(true);
        expect(Bun.peek(retry)).toContain('HTTP 404');
    } finally {
        held.reject(new Error('end of test'));
        await nextTurn();
        document.querySelector<HTMLButtonElement>('.rs2b0t-walkmap-cancel')?.click();
        frame.mockRestore();
        jest.useRealTimers();
        dom.setURL(originalUrl);
        Object.defineProperty(globalThis, 'fetch', fetchDescriptor);
    }
});
