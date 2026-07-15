import { beforeEach, describe, expect, test } from 'bun:test';
import { PaintState, hitRegion, resolveDock, toCanvasPoint, type Region } from '#/bot/api/hud/paintLogic.js';

describe('toCanvasPoint', () => {
    test('maps CSS pixels to 765x503 logical space via the bounding rect', () => {
        const rect = { left: 100, top: 50, width: 1530, height: 1006 }; // 2x scale
        expect(toCanvasPoint(1630, 553, rect)).toEqual({ x: 765, y: 251.5 });
        expect(toCanvasPoint(100, 50, rect)).toEqual({ x: 0, y: 0 });
    });
});

describe('resolveDock', () => {
    test('chatbox dock covers the chat area; topleft matches the legacy box', () => {
        const chat = resolveDock('chatbox');
        expect(chat.y).toBeGreaterThan(330); // below the viewport
        expect(chat.x + chat.w).toBeLessThanOrEqual(520); // left of the sidebar tabs
        const top = resolveDock('topleft');
        expect(top).toMatchObject({ x: 6, y: 6 });
    });

    test('explicit rect passes through', () => {
        expect(resolveDock({ x: 1, y: 2, w: 3, h: 4 })).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    });
});

describe('hitRegion', () => {
    const regions: Region[] = [
        { id: 'panel', x: 10, y: 340, w: 500, h: 150, kind: 'panel' },
        { id: 'btn', x: 20, y: 350, w: 60, h: 16, kind: 'widget' }
    ];

    test('innermost (widget) region wins over the panel backdrop', () => {
        expect(hitRegion(regions, 25, 355)?.id).toBe('btn');
        expect(hitRegion(regions, 200, 400)?.id).toBe('panel');
        expect(hitRegion(regions, 5, 5)).toBeNull();
    });
});

describe('PaintState', () => {
    let state: PaintState;
    beforeEach(() => {
        state = new PaintState();
    });

    test('click inside a widget region queues for that widget; next-frame consume', () => {
        state.publishRegions([
            { id: 'panel', x: 0, y: 0, w: 100, h: 100, kind: 'panel' },
            { id: 'b1', x: 10, y: 10, w: 20, h: 10, kind: 'widget' }
        ]);
        expect(state.pointerDown(15, 15)).toBe(true); // swallowed
        expect(state.consumeClick('b1')).toBe(true);
        expect(state.consumeClick('b1')).toBe(false); // consumed once
    });

    test('click on the panel backdrop swallows but queues nothing', () => {
        state.publishRegions([{ id: 'panel', x: 0, y: 0, w: 100, h: 100, kind: 'panel' }]);
        expect(state.pointerDown(50, 50)).toBe(true);
        expect(state.consumeClick('panel')).toBe(false);
    });

    test('click outside every region is not swallowed', () => {
        state.publishRegions([{ id: 'panel', x: 0, y: 0, w: 100, h: 100, kind: 'panel' }]);
        expect(state.pointerDown(200, 200)).toBe(false);
    });

    test('hover tracks the pointer and only swallows moves inside regions', () => {
        state.publishRegions([{ id: 'panel', x: 0, y: 0, w: 100, h: 100, kind: 'panel' }]);
        expect(state.pointerMove(50, 50)).toBe(true);
        expect(state.isHovered({ x: 40, y: 40, w: 20, h: 20 })).toBe(true);
        expect(state.pointerMove(300, 300)).toBe(false);
        expect(state.isHovered({ x: 40, y: 40, w: 20, h: 20 })).toBe(false);
    });

    test('widget kv store persists across frames (tabs, collapse)', () => {
        expect(state.get('tabs:main', 'Overview')).toBe('Overview');
        state.set('tabs:main', 'Loot');
        expect(state.get('tabs:main', 'Overview')).toBe('Loot');
        state.reset();
        expect(state.get('tabs:main', 'Overview')).toBe('Overview');
    });

    test('reset clears regions so a stopped bot swallows nothing', () => {
        state.publishRegions([{ id: 'panel', x: 0, y: 0, w: 100, h: 100, kind: 'panel' }]);
        state.reset();
        expect(state.pointerDown(50, 50)).toBe(false);
    });
});
