import { GlobalRegistrator } from '@happy-dom/global-registrator';

export function mountCanvas(configure: (canvas: HTMLCanvasElement) => void): HTMLCanvasElement {
    GlobalRegistrator.register({ url: 'http://localhost/?box' });
    Object.defineProperty(globalThis, 'BroadcastChannel', { value: undefined });
    const canvas = document.createElement('canvas');
    canvas.id = 'canvas';
    configure(canvas);
    return document.body.appendChild(canvas);
}
