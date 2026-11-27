import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Client as GameClient } from '#/client/shell/Client.js';
import { mountCanvas } from './mountCanvas.js';

const digest = createHash('sha256');
let allocations = 0;
let bytes = 0;
let draws = 0;
mountCanvas(canvas => {
    Object.assign(canvas, {
        getContext: () => ({
            createImageData(width: number, height: number) {
                const data = new Uint8ClampedArray(width * height * 4);
                allocations++;
                bytes += data.byteLength;
                return { width, height, data };
            },
            putImageData(image: ImageData, x: number, y: number) {
                digest.update(JSON.stringify([image.width, image.height, x, y]));
                digest.update(image.data);
                draws++;
            }
        })
    });
});

const { Client } = await import('#/client/shell/Client.js');
const { default: Pix2D } = await import('#/client/graphics/Pix2D.js');

const surfaces = [
    ['areaGame', 4, 4], ['areaChat', 17, 357], ['areaMap', 550, 4], ['areaSide', 553, 205],
    ['areaBackbase1', 0, 453], ['areaBackbase2', 496, 466], ['areaBackhmid1', 516, 160]
] as const;
const count = Number(process.argv[2] ?? 2);
const clients: GameClient[] = [];

function draw(client: GameClient, surface: number, seed: number) {
    const [name, x, y] = surfaces[surface];
    const map = client[name]!;
    for (let i = 0; i < map.data.length; i++) map.data[i] = (seed + i * 0x12345) & 0xffffff;
    map.draw(x, y);
}

const start = performance.now();
for (let i = 0; i < count; i++) {
    const client: GameClient = Object.create(Client.prototype);
    client['prepareGame']();
    assert.equal(Pix2D.pixels, client['areaBackhmid1']!.data);
    clients.push(client);
    draw(client, 0, i);
}
for (let s = 1; s < surfaces.length; s++) draw(clients[0], s, s);
const initial = { allocations, bytes, ms: performance.now() - start };

for (let pass = 1; pass <= 2; pass++) {
    for (const [i, client] of clients.entries()) {
        for (let s = 0; s < surfaces.length; s++) draw(client, s, pass * 0x654321 + i + s);
    }
    assert.equal(allocations, count * surfaces.length);
}
console.log(JSON.stringify({ initial, allocations, bytes, draws, sha256: digest.digest('hex') }));
