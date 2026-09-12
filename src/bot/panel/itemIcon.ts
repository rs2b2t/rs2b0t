import { reader } from '../adapter/ClientAdapter.js';

/** Encoded icons by id; missing streamed sprites remain retryable. */
const encoded = new Map<number, string>();

/** Item icon data URL, or null until its sprite is available. Raw pixels use 0xRRGGBB with 0 transparent. */
export function itemIconDataUrl(id: number): string | null {
    const hit = encoded.get(id);
    if (hit !== undefined) {
        return hit;
    }
    const sprite = reader.itemIconPixels(id);
    if (!sprite || sprite.width <= 0 || sprite.height <= 0) {
        return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = sprite.width;
    canvas.height = sprite.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return null;
    }
    const image = ctx.createImageData(sprite.width, sprite.height);
    for (let i = 0; i < sprite.data.length; i++) {
        const rgb = sprite.data[i]!;
        image.data[i * 4] = (rgb >> 16) & 0xff;
        image.data[i * 4 + 1] = (rgb >> 8) & 0xff;
        image.data[i * 4 + 2] = rgb & 0xff;
        image.data[i * 4 + 3] = rgb === 0 ? 0 : 0xff;
    }
    ctx.putImageData(image, 0, 0);
    const url = canvas.toDataURL('image/png');
    encoded.set(id, url);
    return url;
}
