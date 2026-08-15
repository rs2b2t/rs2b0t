import { expect, test, describe, beforeEach, afterAll } from 'bun:test';

import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Locs } from '#/bot/api/locs/Locs.js';
import { Npcs } from '#/bot/api/npcs/Npcs.js';
import Tile from '#/bot/geometry/Tile.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

interface WorldTileLike {
    x: number;
    z: number;
    level: number;
}

let current: Tile;
let walkTargets: WorldTileLike[];
let interactOps: string[];
let walkScript: (dest: WorldTileLike) => Tile | false;

const fakeLadder = {
    tile: () => current,
    interact: async (op: string): Promise<boolean> => {
        interactOps.push(op);
        current = new Tile(3105, 3162, 0);
        return true;
    }
};
const locChain = {
    name: () => locChain,
    action: () => locChain,
    where: () => locChain,
    nearest: () => fakeLadder
};
const npcChain = {
    name: () => npcChain,
    nearest: () => null
};

// Why: Bun's mock.module is permanent for the process, so stub the singleton instead.
const restoreGame = stubProps(Game, { tile: () => current });
const restoreExec = stubProps(Execution, {
    delayUntil: async (fn: () => boolean): Promise<boolean> => fn(),
    delayTicks: async (): Promise<void> => {}
});
const restoreTraversal = stubProps(Traversal, {
    walkResilient: async (dest: WorldTileLike): Promise<boolean> => {
        walkTargets.push(dest);
        const landed = walkScript(dest);
        if (landed === false) {
            return false;
        }
        current = landed;
        return true;
    }
});
const restoreLocs = stubProps(Locs, { query: () => locChain as never });
const restoreNpcs = stubProps(Npcs, { query: () => npcChain as never });
afterAll(() => {
    restoreGame();
    restoreExec();
    restoreTraversal();
    restoreLocs();
    restoreNpcs();
});

const { gotoNpc } = await import('#/bot/api/ai/quests/exec/primitives.js');

const HOPS = [
    { stand: new Tile(3105, 3162, 0), locName: 'Ladder', op: 'Climb-down', arrive: new Tile(3104, 9576, 0) },
    { stand: new Tile(3104, 9576, 0), locName: 'Ladder', op: 'Climb-up', arrive: new Tile(3105, 3162, 0) }
];
const SEDRIDOR = {
    npc: 'Sedridor',
    anchor: new Tile(3103, 9572, 0),
    leash: 8,
    prefer: [],
    approach: [new Tile(3108, 9572, 0)]
};

beforeEach(() => {
    walkTargets = [];
    interactOps = [];
});

describe('empty-hop cross-plane fallback (clue talk anchors)', () => {
    test('no supplied hop toward an underground anchor falls back to the baked walk', async () => {
        current = new Tile(2387, 3435, 0);
        walkScript = dest => new Tile(dest.x, dest.z, dest.level);
        const stop = { npc: 'Brimstail', anchor: new Tile(2390, 9810, 0), leash: 8, prefer: [] };
        await gotoNpc(stop, [], () => {});
        expect(walkTargets.some(t => t.x === 2390 && t.z === 9810)).toBe(true);
    });
});

describe('gotoNpc trapped-landing recovery', () => {
    test('approach-leg failure in the basement climbs back up to re-roll the landing', async () => {
        current = new Tile(3107, 9575, 0);
        walkScript = dest => {
            if (dest.x === 3108 && dest.z === 9572) {
                return false;
            }
            return new Tile(dest.x, dest.z, dest.level);
        };

        const ok = await gotoNpc(SEDRIDOR, HOPS, () => {});

        expect(ok).toBe(false);
        expect(interactOps).toEqual(['Climb-up']);
    });

    test('anchor-leg failure in the basement still climbs back up (pre-existing path)', async () => {
        current = new Tile(3108, 9572, 0);
        walkScript = dest => {
            if (dest.x === 3103 && dest.z === 9572) {
                return false;
            }
            return new Tile(dest.x, dest.z, dest.level);
        };

        const ok = await gotoNpc(SEDRIDOR, HOPS, () => {});

        expect(ok).toBe(false);
        expect(interactOps).toEqual(['Climb-up']);
    });

    test('surface approach failure never climbs — recovery is basement-gated', async () => {
        current = new Tile(3210, 3220, 0);
        const surfaceStop = {
            npc: 'Aubury',
            anchor: new Tile(3253, 3402, 0),
            leash: 8,
            prefer: [],
            approach: [new Tile(3230, 3300, 0)]
        };
        walkScript = () => false;

        const ok = await gotoNpc(surfaceStop, HOPS, () => {});

        expect(ok).toBe(false);
        expect(interactOps).toEqual([]);
    });
});
