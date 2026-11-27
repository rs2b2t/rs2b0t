import assert from 'node:assert/strict';
import { mountCanvas } from './mountCanvas.js';

let fullCanvasAllocations = 0;
const messages: string[] = [];
const paints: { image: ImageData; x: number; y: number }[] = [];
const canvas = mountCanvas(canvas => {
    canvas.width = 765;
    canvas.height = 503;
    Object.assign(canvas, {
        getContext: () => ({
            createImageData(width: number, height: number) {
                if (width === canvas.width && height === canvas.height) fullCanvasAllocations++;
                return { width, height, data: new Uint8ClampedArray(width * height * 4) };
            },
            putImageData(image: ImageData, x: number, y: number) {
                paints.push({ image, x, y });
            },
            fillText(text: string) { messages.push(text); },
            fillRect() {},
            strokeRect() {}
        })
    });
});

const { Client } = await import('#/client/shell/Client.js');
const { MapView } = await import('#/client/mapview/MapView.js');
const { default: Pix2D } = await import('#/client/graphics/Pix2D.js');
const { default: Pix3D } = await import('#/client/dash3d/Pix3D.js');
const { default: Pix8 } = await import('#/client/graphics/Pix8.js');

class StartupClient extends Client {
    override async run() {}
}

const starts = Number(process.argv[2] ?? 1);
for (let i = 0; i < starts; i++) {
    const client = new StartupClient(10, false, true);
    assert.equal(Pix3D.scanline[502], 502 * 765);
    await client.drawProgress('Loading...', 0);
    assert.deepEqual(messages.splice(0), ['Loading...']);
    assert.equal(paints.length, 0);

    if (i === 0) {
        const titlebox = new Pix8(1, 1, Int32Array.of(0, 0xff0000));
        titlebox.data[0] = 1;
        Object.assign(client, { imageTitlebox: titlebox });
        await client.mainredraw();
        const title = paints.splice(0).find(({ x, y }) => x === 202 && y === 171);
        assert.ok(title);
        assert.deepEqual([...title.image.data.subarray(0, 4)], [255, 0, 0, 255]);
    }
}
assert.equal(fullCanvasAllocations, 0, `${fullCanvasAllocations} full-canvas allocations across ${starts} client starts`);

class StartupMapView extends MapView {
    override async run() {}
}

canvas.width = 96;
canvas.height = 64;
const view = new StartupMapView();
view.redraw = false;
Pix2D.fillRect(95, 63, 1, 1, 0x00ff00);
await view.mainredraw();
assert.equal(paints.length, 1);
const { image, x, y } = paints[0];
assert.deepEqual([image.width, image.height, x, y], [96, 64, 0, 0]);
assert.deepEqual([...image.data.subarray(-4)], [0, 255, 0, 255]);
