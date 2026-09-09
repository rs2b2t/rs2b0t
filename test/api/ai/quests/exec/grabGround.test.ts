import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

import Tile from '#/bot/geometry/Tile.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { GroundItems } from '#/bot/api/grounditems/GroundItems.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { executeStep } from '#/bot/api/ai/quests/exec/steps.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

const ANCHOR = new Tile(3227, 3300, 0);
const FAR = { x: 3255, z: 3288, level: 0 };

interface TestGroundItem {
    name: string;
    distance(): number;
    interact(action: string): Promise<boolean>;
}

let held: number;
let here: { x: number; z: number; level: number };
let ground: TestGroundItem[];
let walks: number;
let waits: number;
let takes: number;

const restoreExec = stubProps(Execution, {
    delayUntil: async (condition: () => boolean): Promise<boolean> => condition(),
    delayTicks: async (): Promise<void> => {
        waits += 1;
    }
});
const restoreGame = stubProps(Game, {
    tile: () => here
});
const restoreInv = stubProps(Inventory, {
    count: (name: string): number => (name.toLowerCase() === 'egg' ? held : 0)
});
const restoreWalk = stubProps(Traversal, {
    walkResilient: async (): Promise<boolean> => {
        walks += 1;
        here = { x: ANCHOR.x, z: ANCHOR.z, level: ANCHOR.level };
        return true;
    }
});
const restoreGround = stubProps(GroundItems, {
    query: () => {
        let matches = [...ground];
        const chain = {
            name: (...names: string[]) => {
                matches = matches.filter(item => names.includes(item.name));
                return chain;
            },
            within: (distance: number) => {
                matches = matches.filter(item => item.distance() <= distance);
                return chain;
            },
            nearest: () => matches.sort((a, b) => a.distance() - b.distance())[0] ?? null
        };
        return chain as never;
    }
});

afterAll(() => {
    restoreExec();
    restoreGame();
    restoreInv();
    restoreWalk();
    restoreGround();
});

beforeEach(() => {
    held = 0;
    here = { ...FAR };
    ground = [];
    walks = 0;
    waits = 0;
    takes = 0;
});

function eggOnGround(): TestGroundItem {
    return {
        name: 'Egg',
        distance: () => 1,
        interact: async (action: string): Promise<boolean> => {
            expect(action).toBe('Take');
            takes += 1;
            held += 1;
            return true;
        }
    };
}

async function grab(waitIfMissing = false): Promise<boolean> {
    return executeStep(
        { kind: 'grabGround', item: 'Egg', anchor: ANCHOR, waitIfMissing },
        [],
        () => {}
    );
}

describe('grabGround', () => {
    test('Takes a visible egg without walking', async () => {
        here = { x: ANCHOR.x, z: ANCHOR.z, level: 0 };
        ground = [eggOnGround()];
        expect(await grab()).toBe(true);
        expect(takes).toBe(1);
        expect(walks).toBe(0);
        expect(held).toBe(1);
    });

    test('arrival with an empty pen is not success', async () => {
        expect(await grab()).toBe(false);
        expect(walks).toBe(1);
        expect(takes).toBe(0);
        expect(held).toBe(0);
    });

    test('Takes after the walk if the egg is there on re-query', async () => {
        const item = eggOnGround();
        let queries = 0;
        const restoreQuery = stubProps(GroundItems, {
            query: () => {
                queries += 1;
                const matches = queries >= 2 ? [item] : [];
                const chain = {
                    name: () => chain,
                    within: () => chain,
                    nearest: () => matches[0] ?? null
                };
                return chain as never;
            }
        });
        try {
            expect(await grab()).toBe(true);
            expect(walks).toBe(1);
            expect(takes).toBe(1);
            expect(held).toBe(1);
        } finally {
            restoreQuery();
        }
    });

    test('waitIfMissing delays when the pen is still empty', async () => {
        expect(await grab(true)).toBe(false);
        expect(walks).toBe(1);
        expect(waits).toBe(1);
    });
});
