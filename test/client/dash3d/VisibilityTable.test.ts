import { afterEach, expect, test } from 'bun:test';
import Pix3D from '#/client/dash3d/Pix3D.js';
import { installVisibilityTableCache } from '#/client/dash3d/VisibilityTable.js';
import type World from '#/client/dash3d/World.js';

let moduleId = 0;
async function loadTile(): Promise<typeof World> {
    return (await import(`../../../src/client/dash3d/World.ts?tile=${++moduleId}`)).default;
}

const previousParent = Object.getOwnPropertyDescriptor(window, 'parent');
afterEach(() => {
    if (previousParent) Object.defineProperty(window, 'parent', previousParent);
    else Reflect.deleteProperty(window, 'parent');
});

function mountWall(): void {
    const wall = Object.create(null);
    installVisibilityTableCache(wall);
    Object.defineProperty(window, 'parent', { configurable: true, value: wall });
}

const distances = Int32Array.from({ length: 9 }, (_, i) => {
    const angle = i * 32 + 143;
    return ((angle * 3 + 600) * Pix3D.sinTable[angle]) >> 16;
});
type Inputs = Parameters<typeof World.resetVisCalc>;
const startup: Inputs = [distances, 500, 800, 512, 334];

test('61 tiles and a reload build one visibility table per wall', async () => {
    Object.defineProperty(window, 'parent', { configurable: true, value: {} });
    const standalone = await loadTile();
    standalone.resetVisCalc(...startup);

    mountWall();
    let builds = 0;
    const tables = new Set<boolean[][][][]>();
    for (let i = 0; i < 62; i++) {
        const tile = await loadTile();
        const fill = tile['fillVisibilityTable'];
        tile['fillVisibilityTable'] = function (...args) {
            builds++;
            fill.call(this, ...args);
        };
        tile.resetVisCalc(distances.slice(), 500, 800, 512, 334);
        tables.add(tile['visBacking']);
    }
    expect(builds).toBe(1);
    expect(tables.size).toBe(1);
    const [shared] = tables;
    expect(shared).toEqual(standalone['visBacking']);

    mountWall();
    const otherTile = await loadTile();
    const scene = new otherTile([[new Int32Array(1)]], 1, 1, 1);
    scene.renderAll(0, 0, 0, 0, 64, 160);
    expect(otherTile['visBackingDirty']?.every(row => row.every(visible => !visible))).toBe(true);
    otherTile.resetVisCalc(...startup);
    scene.renderAll(0, 0, 0, 0, 64, 160);
    expect(otherTile['visBackingDirty'] === otherTile['visBacking'][1][1]).toBe(true);
    expect(otherTile['visBacking'] === shared).toBe(false);
});

test('each viewport, frustum and pitch change preserves the original table', async () => {
    const inputs: Inputs[] = [startup, [distances, 500, 800, 640, 334], [distances, 500, 800, 512, 480], [distances, 250, 800, 512, 334], [distances, 500, 400, 512, 334], [distances.with(8, 0), 500, 800, 512, 334]];
    Object.defineProperty(window, 'parent', {
        configurable: true,
        get() {
            throw new DOMException('Cross-origin parent', 'SecurityError');
        }
    });
    const standalone = await loadTile();
    const expected = inputs.map(args => {
        standalone.resetVisCalc(...args);
        return standalone['visBacking'];
    });

    mountWall();
    const tile = await loadTile();
    const tables = inputs.map((args, i) => {
        tile.resetVisCalc(...args);
        const table = tile['visBacking'];
        expect(table).toEqual(expected[i]);
        return table;
    });
    expect(new Set(tables).size).toBe(inputs.length);
    tile.resetVisCalc(...startup);
    expect(tile['visBacking'] === tables[0]).toBe(true);
    expect(tables[0]).toEqual(expected[0]);
});
