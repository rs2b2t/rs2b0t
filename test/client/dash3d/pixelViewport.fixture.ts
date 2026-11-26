import type Pix3D from '#/client/dash3d/Pix3D.js';
import Pix2D from '#/client/graphics/Pix2D.js';

export function withPixelViewport(renderer: typeof Pix3D, width: number, height: number, draw: (pixels: Int32Array) => void): void {
    const previous2D = { ...Pix2D };
    const pixels = new Int32Array(width * height);
    try {
        Pix2D.setPixels(pixels, width, height);
        renderer.setRenderClipping();
        draw(pixels);
    } finally {
        Object.assign(Pix2D, previous2D);
    }
}
