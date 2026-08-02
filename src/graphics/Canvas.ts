export const canvas: HTMLCanvasElement = document.getElementById('canvas') as HTMLCanvasElement;
// The bot and the test suite import this headlessly, where there is no #canvas element.
// The optional chain keeps the module importable there rather than throwing at load; the
// cast is the assertion that anything actually drawing has a real canvas.
export const canvas2d: CanvasRenderingContext2D = canvas?.getContext('2d', {
    desynchronized: false,
    alpha: false
}) as CanvasRenderingContext2D;

export function saveDataURL(dataURL: string, filename: string) {
    const link = document.createElement('a');
    link.href = dataURL;
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
