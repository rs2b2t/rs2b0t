import { expect, spyOn, test } from 'bun:test';
import { EventTarget as DomEventTarget, PropertySymbol } from 'happy-dom';
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
    const before = resources();
    try {
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
            expect(await result).toEqual(action === 'Confirm' ? tile : null);
            expect(resources()).toEqual(before);
        }
    } finally {
        document.querySelector<HTMLButtonElement>('.rs2b0t-walkmap-cancel')?.click();
        frame.mockRestore();
        Object.defineProperty(globalThis, 'fetch', originalFetch);
        sessionStorage.clear();
        localStorage.clear();
    }
});
