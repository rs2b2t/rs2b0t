import { resolveDock } from '#/bot/paint/paintLogic.js';

const CHAR_W = 7;
const PANEL = resolveDock('chatbox');

export interface Drawn {
    text: string;
    x: number;
    y: number;
}

export interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}

export function recorder(): { ctx: CanvasRenderingContext2D; drawn: Drawn[]; boxes: Box[] } {
    const drawn: Drawn[] = [];
    const boxes: Box[] = [];
    const ctx = {
        font: '',
        textBaseline: '',
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 0,
        lineJoin: '',
        save: () => {},
        restore: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {},
        fillRect(x: number, y: number, w: number, h: number) {
            boxes.push({ x, y, w, h });
        },
        strokeRect(x: number, y: number, w: number, h: number) {
            boxes.push({ x, y, w, h });
        },
        measureText: (t: string) => ({ width: t.length * CHAR_W }),
        fillText(t: string, x: number, y: number) {
            drawn.push({ text: t, x, y });
        }
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn, boxes };
}

export function spills(boxes: Box[]): Box[] {
    return boxes.filter(
        b => b.x < PANEL.x || b.y < PANEL.y || b.x + b.w > PANEL.x + PANEL.w || b.y + b.h > PANEL.y + PANEL.h
    );
}
