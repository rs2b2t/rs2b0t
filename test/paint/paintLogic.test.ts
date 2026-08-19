import { beforeEach, describe, expect, test } from 'bun:test';
import {
    PaintState,
    WHEEL_ROWS,
    cellWidths,
    clipText,
    gridRows,
    hitRegion,
    listScroll,
    paintCols,
    resolveDock,
    toCanvasPoint,
    wrapText,
    type Region
} from '#/bot/paint/paintLogic.js';

describe('toCanvasPoint', () => {
    test('maps CSS pixels to 765x503 logical space via the bounding rect', () => {
        const rect = { left: 100, top: 50, width: 1530, height: 1006 };
        expect(toCanvasPoint(1630, 553, rect)).toEqual({ x: 765, y: 251.5 });
        expect(toCanvasPoint(100, 50, rect)).toEqual({ x: 0, y: 0 });
    });
});

describe('resolveDock', () => {
    test('chatbox dock covers the chat area; topleft matches the legacy box', () => {
        const chat = resolveDock('chatbox');
        expect(chat.y).toBeGreaterThan(330);
        expect(chat.x + chat.w).toBeLessThanOrEqual(520);
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
        expect(state.pointerDown(15, 15)).toBe(true);
        expect(state.consumeClick('b1')).toBe(true);
        expect(state.consumeClick('b1')).toBe(false);
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

describe('paintCols', () => {
    test('counts whole monospace characters that fit inside the padding', () => {
        expect(paintCols(506, 8, 7)).toBe(70);
        expect(paintCols(100, 8, 7)).toBe(12);
    });

    test('a panel narrower than its padding fits nothing', () => {
        expect(paintCols(10, 8, 7)).toBe(0);
        expect(paintCols(506, 8, 0)).toBe(0);
    });
});

describe('wrapText', () => {
    test('packs whole words up to the column count', () => {
        expect(wrapText('the quick brown fox jumps', 11)).toEqual(['the quick', 'brown fox', 'jumps']);
    });

    test('indents continuation lines so a wrapped reason reads as one entry', () => {
        expect(wrapText('needs 56 agility and 50 quest points', 14, 2)).toEqual([
            'needs 56',
            '  agility and',
            '  50 quest',
            '  points'
        ]);
    });

    test('hard-splits a word longer than the line', () => {
        expect(wrapText('supercalifragilistic', 8)).toEqual(['supercal', 'ifragili', 'stic']);
    });

    test('collapses runs of whitespace and drops empty text', () => {
        expect(wrapText('  a   b  ', 10)).toEqual(['a b']);
        expect(wrapText('   ', 10)).toEqual([]);
        expect(wrapText('anything', 0)).toEqual([]);
    });
});

describe('clipText', () => {
    test('text that fits is untouched', () => {
        expect(clipText('idle', 10)).toBe('idle');
    });

    test('overlong text ends in an ellipsis inside the column count', () => {
        expect(clipText('abcdefghij', 5)).toBe('abcd…');
        expect(clipText('abcdefghij', 5).length).toBe(5);
    });

    test('leading spaces survive, so padded list columns stay aligned', () => {
        expect(clipText('   7  Green dragonhide', 40)).toBe('   7  Green dragonhide');
    });

    test('no columns means nothing to draw', () => {
        expect(clipText('abc', 0)).toBe('');
    });
});

describe('cellWidths', () => {
    test('splits the total evenly when every cell weighs the same', () => {
        expect(cellWidths(300, [1, 1, 1])).toEqual([100, 100, 100]);
    });

    test('a heavier cell takes proportionally more room', () => {
        expect(cellWidths(300, [2, 1])).toEqual([200, 100]);
    });

    test('no cells take no room', () => {
        expect(cellWidths(300, [])).toEqual([]);
    });
});

describe('gridRows', () => {
    test('a queue laid two across needs half as many rows, rounded up', () => {
        expect(gridRows(61, 2)).toBe(31);
        expect(gridRows(60, 2)).toBe(30);
    });

    test('one column is a plain list', () => {
        expect(gridRows(7, 1)).toBe(7);
    });

    test('an empty grid has no rows', () => {
        expect(gridRows(0, 2)).toBe(0);
        expect(gridRows(7, 0)).toBe(0);
    });
});

describe('listScroll', () => {
    const state = (offset: number, manual: boolean, focus: number) => ({ offset, manual, focus });

    test('a wheel notch moves several rows and hands the list to the user', () => {
        expect(listScroll(60, 6, state(0, false, -1), 1, -1)).toEqual({ offset: WHEEL_ROWS, manual: true, focus: -1 });
    });

    test('scrolling stops at both ends', () => {
        expect(listScroll(60, 6, state(0, true, -1), -1, -1).offset).toBe(0);
        expect(listScroll(60, 6, state(54, true, -1), 1, -1).offset).toBe(54);
    });

    test('a list shorter than its window never scrolls', () => {
        expect(listScroll(4, 6, state(0, false, -1), 1, -1).offset).toBe(0);
    });

    test('follows the focus row while the user has not scrolled', () => {
        expect(listScroll(60, 6, state(0, false, 20), 0, 20).offset).toBe(15);
        expect(listScroll(60, 6, state(30, false, 20), 0, 20).offset).toBe(20);
    });

    test('a focus row already on screen leaves the offset alone', () => {
        expect(listScroll(60, 6, state(18, false, 20), 0, 20).offset).toBe(18);
    });

    test('once scrolled, the list stops following', () => {
        expect(listScroll(60, 6, state(0, true, 20), 0, 20).offset).toBe(0);
    });

    test('a new focus row re-attaches the list the user scrolled away from', () => {
        expect(listScroll(60, 6, state(0, true, 20), 0, 40)).toEqual({ offset: 35, manual: false, focus: 40 });
    });
});
