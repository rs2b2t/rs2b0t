import { describe, expect, test } from 'bun:test';

import { PathFinder, type NavPoint, type TransportEdgeData } from '#/bot/nav/PathFinder.js';
import { allTransportRows } from '#/bot/nav/loadTransportGraph.js';
import { ESSENCE_MINE_PAD, ESSENCE_RETURN, essenceEntryEdges } from '#/bot/nav/v2/travelCatalog.js';

/**
 * The essence mine is exit-only in the graph.
 *
 * essence_mine.rs2 stores the entry NPC in %exit_essence_mine_coord and the exit
 * portal telejumps back to it, so entering by one NPC and leaving by the portal
 * returns you to that same NPC. transports.json bakes the portal exit as a fixed
 * Sedridor landing, which is only true for a Sedridor entry. Chain the two and
 * A* believes it has a cost-20 wormhole from any of five wizards to the Wizards'
 * Tower basement; live, the bot teleports in, walks back out to Brimstail, and
 * re-plans the same teleport forever.
 */

const DX = [0, 1, 0, -1, 1, 1, -1, -1] as const;
const DZ = [1, 0, -1, 0, 1, -1, -1, 1] as const;

function key(x: number, z: number): string {
    return `${x}|${z}`;
}

/** A pack holding the listed segments, walked out tile by tile and joined to neighbours. */
function packOf(segments: [NavPoint, NavPoint][]): Uint8Array {
    const tiles = new Set<string>();
    for (const [from, to] of segments) {
        let { x, z } = from;
        tiles.add(key(x, z));
        while (x !== to.x || z !== to.z) {
            x += Math.sign(to.x - x);
            z += Math.sign(to.z - z);
            tiles.add(key(x, z));
        }
    }
    const bySquare = new Map<string, [number, number][]>();
    for (const tile of tiles) {
        const [x, z] = tile.split('|').map(Number);
        const squareKey = key(x >> 6, z >> 6);
        const square = bySquare.get(squareKey) ?? [];
        square.push([x, z]);
        bySquare.set(squareKey, square);
    }

    const perSquare = 3 + 4096 + 512;
    const bytes = new Uint8Array(10 + bySquare.size * perSquare);
    bytes.set([0x4c, 0x43, 0x4e, 0x56, 1, 1]);
    new DataView(bytes.buffer).setUint16(8, bySquare.size, true);

    let pos = 10;
    for (const [squareKey, squareTiles] of bySquare) {
        const [mx, mz] = squareKey.split('|').map(Number);
        bytes[pos++] = mx;
        bytes[pos++] = mz;
        bytes[pos++] = 1;
        const exits = bytes.subarray(pos, pos + 4096);
        pos += 4096;
        const walk = bytes.subarray(pos, pos + 512);
        pos += 512;

        for (const [x, z] of squareTiles) {
            const index = (x & 63) * 64 + (z & 63);
            walk[index >> 3] |= 1 << (index & 7);
            for (let direction = 0; direction < DX.length; direction++) {
                if (tiles.has(key(x + DX[direction], z + DZ[direction]))) {
                    exits[index] |= 1 << direction;
                }
            }
        }
    }
    return bytes;
}

const PORTAL_STAND = { x: 2932, z: 4816, level: 0 } as const;
const SEDRIDOR_BASEMENT = { x: 3107, z: 9571, level: 0 } as const;

function finderOver(segments: [NavPoint, NavPoint][]): PathFinder {
    const finder = new PathFinder(packOf(segments));
    finder.addEdges([], allTransportRows() as TransportEdgeData[]);
    return finder;
}

/** Walkable floor of the mine: the arrival pad through to a portal stand. */
const MINE_FLOOR: [NavPoint, NavPoint] = [ESSENCE_MINE_PAD, PORTAL_STAND];

describe('essence mine is exit-only', () => {
    test('every essence entry is disabled with a recorded reason', () => {
        const entries = essenceEntryEdges();
        expect(entries).toHaveLength(5);
        for (const e of entries) {
            expect(e.disabledReason, e.debugName).toBeDefined();
        }
    });

    test('no enabled edge teleports into the mine', () => {
        const intoMine = allTransportRows().filter(
            e => !e.disabledReason && e.to.x === ESSENCE_MINE_PAD.x && e.to.z === ESSENCE_MINE_PAD.z
        );
        expect(intoMine).toEqual([]);
    });

    test('Brimstail is not a wormhole to the Wizards Tower basement', () => {
        const brimstail: [NavPoint, NavPoint] = [ESSENCE_RETURN.brimstail, ESSENCE_RETURN.brimstail];
        const sedridor: [NavPoint, NavPoint] = [SEDRIDOR_BASEMENT, SEDRIDOR_BASEMENT];
        const finder = finderOver([brimstail, MINE_FLOOR, sedridor]);
        expect(finder.findPath(ESSENCE_RETURN.brimstail, SEDRIDOR_BASEMENT).ok).toBe(false);
    });

    test('but the portal still gets you out once you are inside', () => {
        const sedridor: [NavPoint, NavPoint] = [SEDRIDOR_BASEMENT, SEDRIDOR_BASEMENT];
        const finder = finderOver([MINE_FLOOR, sedridor]);
        expect(finder.findPath(ESSENCE_MINE_PAD, SEDRIDOR_BASEMENT).ok).toBe(true);
    });
});
