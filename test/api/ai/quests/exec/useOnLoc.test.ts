import { afterAll, beforeEach, expect, test } from 'bun:test';

import { Execution } from '#/bot/api/execution/Execution.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Locs } from '#/bot/api/locs/Locs.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { useOnLoc } from '#/bot/api/ai/quests/exec/prompts.js';
import Tile from '#/bot/geometry/Tile.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

interface FakeLoc {
    id: number;
    name: string;
}

const SPINDLE = 'Clock spindle';
const STAND = new Tile(2569, 3243, 0);

// Why: all four Clock Tower spindles render "Clock spindle" and stand within three tiles, so the decoy is always the nearer match.
const SCENE: FakeLoc[] = [
    { id: 28, name: SPINDLE },
    { id: 29, name: SPINDLE },
    { id: 26, name: SPINDLE }
];

let used: FakeLoc | null;

function chain(locs: FakeLoc[]): unknown {
    const self = {
        name: (...names: string[]) => chain(locs.filter(l => names.includes(l.name))),
        within: () => self,
        where: (pred: (l: FakeLoc) => boolean) => chain(locs.filter(pred)),
        nearest: () => locs[0] ?? null
    };
    return self;
}

const restore = [
    stubProps(Execution, {
        delayTicks: async (): Promise<void> => {},
        delayUntil: async (fn: () => boolean): Promise<boolean> => fn()
    }),
    stubProps(Traversal, { walkResilient: async (): Promise<boolean> => true }),
    stubProps(Locs, { query: () => chain(SCENE) as never }),
    stubProps(Inventory, {
        items: () =>
            [
                {
                    id: 23,
                    count: 1,
                    useOn: async (target: FakeLoc): Promise<boolean> => {
                        used = target;
                        return true;
                    }
                }
            ] as never
    })
];
afterAll(() => { for (const undo of restore) { undo(); } });

beforeEach(() => { used = null; });

test('uses the item on the spindle with the named loc id, not the nearest same-named decoy', async () => {
    const ok = await useOnLoc(23, { name: SPINDLE, near: STAND, id: 29 }, [], () => used !== null, () => {});

    expect(ok).toBe(true);
    expect(used?.id).toBe(29);
});

test('falls back to the nearest match when no loc id is given', async () => {
    const ok = await useOnLoc(23, { name: SPINDLE, near: STAND }, [], () => used !== null, () => {});

    expect(ok).toBe(true);
    expect(used?.id).toBe(28);
});
