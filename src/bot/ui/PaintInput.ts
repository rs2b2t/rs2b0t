import { paintState, toCanvasPoint } from '#/bot/api/hud/paintLogic.js';

export function installPaintInput(canvas: HTMLElement): void {
    const point = (e: MouseEvent): { x: number; y: number } => {
        const rect = canvas.getBoundingClientRect();
        return toCanvasPoint(e.clientX, e.clientY, rect);
    };

    const swallow = (e: Event): void => {
        e.stopImmediatePropagation();
        e.preventDefault();
    };

    for (const type of ['pointerdown', 'mousedown'] as const) {
        canvas.addEventListener(
            type,
            e => {
                const { x, y } = point(e as MouseEvent);
                if ((e as MouseEvent).button === 0 ? paintState.pointerDown(x, y) : paintState.pointerIsInside(x, y)) {
                    swallow(e);
                }
            },
            true
        );
    }

    canvas.addEventListener(
        'pointermove',
        e => {
            const { x, y } = point(e);
            if (paintState.pointerMove(x, y)) {
                swallow(e);
            }
        },
        true
    );

    for (const type of ['mouseup', 'pointerup', 'click', 'dblclick', 'contextmenu', 'wheel'] as const) {
        canvas.addEventListener(
            type,
            e => {
                const { x, y } = point(e as MouseEvent);
                if (paintState.pointerIsInside(x, y)) {
                    swallow(e);
                }
            },
            true
        );
    }
}
