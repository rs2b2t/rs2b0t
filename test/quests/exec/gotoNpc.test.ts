import { expect, test, describe, mock, beforeEach } from 'bun:test';

import Tile from '#/bot/api/Tile.js';

// gotoNpc control-flow tests over mocked I/O singletons. The scenario is the
// 2026-07-12 21:49 live freeze: the tower ladder dropped the player on a
// live-scene pocket tile (3107,9575) the baked pack thinks reaches the
// corridor mouth (3108,9572) — every walk attempt made 0 clicks — and the
// approach-waypoint leg's failure must fall through to the trapped-landing
// recovery (climb back up so the caller re-descends), not return false and
// leave the bot re-walking from the pocket forever.

interface WorldTileLike {
    x: number;
    z: number;
    level: number;
}

let current: Tile; // what Game.tile() reports
let walkTargets: WorldTileLike[]; // every walkResilient dest, in order
let interactOps: string[]; // every loc interact issued (the ladder)
// per-test walk behaviour: return false to fail the leg, or a tile to land on
let walkScript: (dest: WorldTileLike) => Tile | false;

const fakeLadder = {
    tile: () => current,
    interact: async (op: string): Promise<boolean> => {
        interactOps.push(op);
        current = new Tile(3105, 3162, 0); // the scripted surface landing
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
    nearest: () => null // NPC never in leash range — walk legs decide everything
};

mock.module('#/bot/api/Game.js', () => ({ Game: { tile: () => current } }));
mock.module('#/bot/api/Execution.js', () => ({
    Execution: {
        delayUntil: async (fn: () => boolean): Promise<boolean> => fn(),
        delayTicks: async (): Promise<void> => {}
    }
}));
mock.module('#/bot/api/Traversal.js', () => ({
    Traversal: {
        walkResilient: async (dest: WorldTileLike): Promise<boolean> => {
            walkTargets.push(dest);
            const landed = walkScript(dest);
            if (landed === false) {
                return false;
            }
            current = landed;
            return true;
        }
    }
}));
mock.module('#/bot/api/queries/Locs.js', () => ({ Locs: { query: () => locChain } }));
mock.module('#/bot/api/queries/Npcs.js', () => ({ Npcs: { query: () => npcChain } }));

const { gotoNpc } = await import('#/bot/quests/exec/primitives.js');

// The RuneMysteries tower hops, verbatim.
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
        // Live 2026-07-20 loop: ClueExecutor talk steps pass hops=[] and Brimstail's
        // anchor is in the gnome cave — crossHops failed "no hop" forever even
        // though the baked graph carries the Hollowed-rock edge (cost 91).
        current = new Tile(2387, 3435, 0); // surface tile the live bot looped on
        walkScript = dest => new Tile(dest.x, dest.z, dest.level); // baked walk succeeds
        const stop = { npc: 'Brimstail', anchor: new Tile(2390, 9810, 0), leash: 8, prefer: [] };
        await gotoNpc(stop, [], () => {});
        // must TRY the anchor via the baked graph, not fail hop-less without walking
        expect(walkTargets.some(t => t.x === 2390 && t.z === 9810)).toBe(true);
    });
});

describe('gotoNpc trapped-landing recovery', () => {
    test('approach-leg failure in the basement climbs back up to re-roll the landing', async () => {
        current = new Tile(3107, 9575, 0); // the live pocket tile
        walkScript = dest => {
            if (dest.x === 3108 && dest.z === 9572) {
                return false; // corridor mouth unreachable — 0-click freeze
            }
            return new Tile(dest.x, dest.z, dest.level); // recovery walk to the ladder succeeds
        };

        const ok = await gotoNpc(SEDRIDOR, HOPS, () => {});

        expect(ok).toBe(false); // caller re-decides and re-descends
        expect(interactOps).toEqual(['Climb-up']); // the recovery actually fired
    });

    test('anchor-leg failure in the basement still climbs back up (pre-existing path)', async () => {
        current = new Tile(3108, 9572, 0); // at the corridor mouth already
        walkScript = dest => {
            if (dest.x === 3103 && dest.z === 9572) {
                return false; // anchor leg fails
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
        walkScript = () => false; // every leg fails

        const ok = await gotoNpc(surfaceStop, HOPS, () => {});

        expect(ok).toBe(false);
        expect(interactOps).toEqual([]);
    });
});
