import { beforeEach, expect, test } from 'bun:test';
import { Paint } from '#/bot/paint/Paint.js';
import { cycleOption, paintState } from '#/bot/paint/paintLogic.js';
import { WALK_OPTIONS } from '#/bot/api/map/WalkDestinations.js';

function stubCtx(): CanvasRenderingContext2D {
    return {
        font: '',
        textBaseline: '',
        fillStyle: '',
        strokeStyle: '',
        fillRect: () => {},
        strokeRect: () => {},
        fillText: () => {},
        measureText: (t: string) => ({ width: t.length * 7.2 })
    } as never as CanvasRenderingContext2D;
}

function paintDestination(current: string): string | null {
    const p = Paint.begin(stubCtx(), { dock: 'chatbox' });
    p.title('WalkTo');
    const picked = p.stepper('dest', 'Destination', WALK_OPTIONS, current);
    p.end();
    return picked;
}

let regions: { id: string; x: number; y: number; w: number; h: number }[] = [];

beforeEach(() => {
    paintState.reset();
    const publish = paintState.publishRegions.bind(paintState);
    paintState.publishRegions = (r): void => {
        regions = r.map(x => ({ id: x.id, x: x.x, y: x.y, w: x.w, h: x.h }));
        publish(r);
    };
});

test('cycleOption steps forward and wraps', () => {
    expect(cycleOption(['a', 'b', 'c'], 'a', 1)).toBe('b');
    expect(cycleOption(['a', 'b', 'c'], 'c', 1)).toBe('a');
    expect(cycleOption(['a', 'b', 'c'], 'b', -1)).toBe('a');
    expect(cycleOption(['a', 'b', 'c'], 'a', -1)).toBe('c');
});

test('cycleOption is case-insensitive and handles unknown current', () => {
    expect(cycleOption(['Lumbridge', 'Varrock'], 'varrock', 1)).toBe('Lumbridge');
    expect(cycleOption(['Lumbridge', 'Varrock'], 'Atlantis', 1)).toBe('Varrock');
});

test('WALK_OPTIONS stepper publishes prev/mid/next widgets', () => {
    paintDestination('Lumbridge');
    expect(regions.some(r => r.id === 'step:dest:prev')).toBe(true);
    expect(regions.some(r => r.id === 'step:dest:mid')).toBe(true);
    expect(regions.some(r => r.id === 'step:dest:next')).toBe(true);
});

test('one next click advances a single destination (no overshoot)', () => {
    paintDestination('Lumbridge');
    const next = regions.find(r => r.id === 'step:dest:next')!;
    const cx = next.x + next.w / 2;
    const cy = next.y + next.h / 2;
    expect(paintState.pointerDown(cx, cy)).toBe(true);
    const picked = paintDestination('Lumbridge');
    expect(picked).toBe(WALK_OPTIONS[1]);
    // Second paint without a new click returns null (click already consumed).
    expect(paintDestination('Lumbridge')).toBeNull();
});

test('prev click goes to last option from first', () => {
    paintDestination(WALK_OPTIONS[0]!);
    const prev = regions.find(r => r.id === 'step:dest:prev')!;
    expect(paintState.pointerDown(prev.x + 2, prev.y + 2)).toBe(true);
    expect(paintDestination(WALK_OPTIONS[0]!)).toBe(WALK_OPTIONS[WALK_OPTIONS.length - 1]);
});

test('mid label click does not cycle', () => {
    paintDestination('Varrock');
    const mid = regions.find(r => r.id === 'step:dest:mid')!;
    expect(paintState.pointerDown(mid.x + 2, mid.y + 2)).toBe(true);
    expect(paintDestination('Varrock')).toBeNull();
});
