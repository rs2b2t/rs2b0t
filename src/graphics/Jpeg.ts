/**
 * Browser JPEG decode via canvas. Lazy DOM setup so importing Pix32/ClientAdapter
 * in Node (bun test tools, corpus scripts without happy-dom) does not throw at
 * module load — only decodeJpeg requires document.
 */
let jpegCanvas: HTMLCanvasElement | null = null;
let jpegImg: HTMLImageElement | null = null;
let jpeg2d: CanvasRenderingContext2D | null = null;

function ensureJpegDom(): {
    canvas: HTMLCanvasElement;
    img: HTMLImageElement;
    ctx: CanvasRenderingContext2D;
    } {
    if (jpegCanvas && jpegImg && jpeg2d) {
        return { canvas: jpegCanvas, img: jpegImg, ctx: jpeg2d };
    }
    if (typeof document === 'undefined') {
        throw new Error('decodeJpeg requires a DOM (document). Preload test/setup-dom.ts or run in a browser.');
    }
    jpegCanvas = document.createElement('canvas');
    jpegImg = document.createElement('img');
    jpeg2d = jpegCanvas.getContext('2d', { willReadFrequently: true })!;
    return { canvas: jpegCanvas, img: jpegImg, ctx: jpeg2d };
}

export async function decodeJpeg(data: Uint8Array): Promise<ImageData> {
    const { canvas, img, ctx } = ensureJpegDom();

    if (data[0] !== 0xff) {
        data[0] = 0xff;
    }

    URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(new Blob([data as BlobPart], { type: 'image/jpeg' }));

    await new Promise<void>((resolve): (() => void) => (img.onload = (): void => resolve()));

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const width: number = img.naturalWidth;
    const height: number = img.naturalHeight;
    canvas.width = width;
    canvas.height = height;

    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, width, height);
}
