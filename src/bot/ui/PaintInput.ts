/**
 * Input capture layer for interactive paints. Capture-phase listeners on the
 * game canvas hit-test every pointer event against the paint's published
 * regions (paintState): inside the paint the event is routed to the widgets
 * and SWALLOWED (stopImmediatePropagation + preventDefault) before the
 * client's own level-0 handlers (GameShell `canvas.onmousedown = …`) can see
 * it — no click-through to the world/chatbox under the panel. Outside the
 * paint, events flow to the game untouched. Keyboard is never intercepted.
 */
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

    // Queue clicks from BOTH pointerdown and mousedown: for real input the
    // browser fires pointerdown first and our preventDefault SUPPRESSES the
    // compat mousedown entirely (so a mousedown-only handler never sees real
    // clicks); synthetic/legacy paths may fire only mousedown. PaintState's
    // click queue is a Set, so the double-arrival case dedupes to one click.
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

    // everything else only needs suppressing inside the paint so half of a
    // click pair (down swallowed, up leaking) can't reach the client
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
