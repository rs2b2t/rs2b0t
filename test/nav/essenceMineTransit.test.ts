import { describe, expect, test } from 'bun:test';

import { PathFinder, type NavPoint, type TransportEdgeData } from '#/bot/nav/PathFinder.js';
import { allTransportRows } from '#/bot/nav/loadTransportGraph.js';
import { ESSENCE_MINE_PAD, ESSENCE_RETURN, essenceEntryEdges } from '#/bot/nav/v2/travelCatalog.js';
import { emptyWorldStateData } from '#/bot/nav/v2/worldStateData.js';

/**
 * Essence mine multiloc (#388): entry/exit are **blacklisted** from the path graph.
 *
 * Content: entry lands on a random enum pad; exit dest is `%exit_essence_mine_coord`
 * (session), not the portal placement. Scripts own essence transit; nav must not
 * treat the mine as a surface OD wormhole.
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

function finderOver(segments: [NavPoint, NavPoint][]): PathFinder {
    const finder = new PathFinder(packOf(segments));
    finder.addEdges([], allTransportRows() as TransportEdgeData[]);
    return finder;
}

/** Walkable floor of the mine: the arrival pad through to a portal stand. */
const MINE_FLOOR: [NavPoint, NavPoint] = [ESSENCE_MINE_PAD, PORTAL_STAND];

const richRm = {
    ...emptyWorldStateData(),
    quests: {
        'Rune Mysteries Quest': 'complete' as const,
        'rune mysteries quest': 'complete' as const
    }
};

describe('essence mine multiloc (blacklisted from graph — #388)', () => {
    test('every essence entry is blacklisted (catalog kept for audits)', () => {
        const entries = essenceEntryEdges();
        expect(entries).toHaveLength(5);
        for (const e of entries) {
            expect(e.blacklist, e.debugName).toBe(true);
            expect(e.blacklistReason, e.debugName).toMatch(/random|essence_mine/i);
            expect(e.requires?.essenceEntrySetsReturn, e.debugName).toBeDefined();
            expect(e.action).toBe('Teleport');
        }
    });

    test('blacklisted entry edges do not load into the path graph', () => {
        // allTransportRows still lists them for audits; PathFinder skips blacklist.
        const intoMine = allTransportRows().filter(
            e =>
                e.to.x === ESSENCE_MINE_PAD.x
                && e.to.z === ESSENCE_MINE_PAD.z
                && e.requires?.essenceEntrySetsReturn
        );
        expect(intoMine.length).toBe(5);
        expect(intoMine.every(e => e.blacklist === true)).toBe(true);
    });

    test('litmus: mine is not a surface OD wormhole (blacklisted hops)', () => {
        const brimstail: [NavPoint, NavPoint] = [ESSENCE_RETURN.brimstail, ESSENCE_RETURN.brimstail];
        const aubury: [NavPoint, NavPoint] = [ESSENCE_RETURN.aubury, ESSENCE_RETURN.aubury];
        const sedridor: [NavPoint, NavPoint] = [ESSENCE_RETURN.sedridor, ESSENCE_RETURN.sedridor];
        const finder = finderOver([brimstail, aubury, MINE_FLOOR, sedridor]);
        const opts = { state: richRm, useTeleportCatalog: false as const };
        expect(finder.findPath(ESSENCE_RETURN.brimstail, ESSENCE_RETURN.sedridor, opts).ok).toBe(false);
        expect(finder.findPath(ESSENCE_RETURN.aubury, ESSENCE_RETURN.sedridor, opts).ok).toBe(false);
        expect(finder.findPath(ESSENCE_RETURN.sedridor, ESSENCE_RETURN.aubury, opts).ok).toBe(false);
        // Entry blacklisted — cannot plan surface wizard → mine pad either.
        expect(finder.findPath(ESSENCE_RETURN.brimstail, ESSENCE_MINE_PAD, opts).ok).toBe(false);
        expect(
            finder.findPath(ESSENCE_MINE_PAD, ESSENCE_RETURN.brimstail, {
                state: { ...richRm, essenceExitReturn: 'brimstail' },
                useTeleportCatalog: false
            }).ok
        ).toBe(false);
    });

    test('portal exits are blacklisted — cannot plan mine → surface via Use', () => {
        const brimstail: [NavPoint, NavPoint] = [ESSENCE_RETURN.brimstail, ESSENCE_RETURN.brimstail];
        const finder = finderOver([brimstail, MINE_FLOOR]);
        const out = finder.findPath(ESSENCE_MINE_PAD, ESSENCE_RETURN.brimstail, {
            state: { ...richRm, essenceExitReturn: 'brimstail' },
            useTeleportCatalog: false
        });
        expect(out.ok).toBe(false);
    });

    test('portal gets you out is not path-planned (blacklist)', () => {
        const sedridor: [NavPoint, NavPoint] = [ESSENCE_RETURN.sedridor, ESSENCE_RETURN.sedridor];
        const finder = finderOver([MINE_FLOOR, sedridor]);
        const outcome = finder.findPath(ESSENCE_MINE_PAD, ESSENCE_RETURN.sedridor, {
            state: { ...emptyWorldStateData(), essenceExitReturn: 'sedridor' },
            useTeleportCatalog: false
        });
        expect(outcome.ok).toBe(false);
    });

    test('session aubury cannot plan exit to sedridor (still unreachable)', () => {
        const sedridor: [NavPoint, NavPoint] = [ESSENCE_RETURN.sedridor, ESSENCE_RETURN.sedridor];
        const aubury: [NavPoint, NavPoint] = [ESSENCE_RETURN.aubury, ESSENCE_RETURN.aubury];
        const finder = finderOver([MINE_FLOOR, sedridor, aubury]);
        expect(
            finder.findPath(ESSENCE_MINE_PAD, ESSENCE_RETURN.sedridor, {
                state: { ...emptyWorldStateData(), essenceExitReturn: 'aubury' },
                useTeleportCatalog: false
            }).ok
        ).toBe(false);
        // Matching session return is still blacklisted — no portal hop in the graph.
        expect(
            finder.findPath(ESSENCE_MINE_PAD, ESSENCE_RETURN.aubury, {
                state: { ...emptyWorldStateData(), essenceExitReturn: 'aubury' },
                useTeleportCatalog: false
            }).ok
        ).toBe(false);
    });

    test('Aubury → mine pad is not path-planned (entry blacklisted)', () => {
        const aubury: [NavPoint, NavPoint] = [ESSENCE_RETURN.aubury, ESSENCE_RETURN.aubury];
        const finder = finderOver([aubury, MINE_FLOOR]);
        // start==goal trivial
        expect(
            finder.findPath(ESSENCE_RETURN.aubury, ESSENCE_RETURN.aubury, {
                state: richRm,
                useTeleportCatalog: false
            }).ok
        ).toBe(true);

        const into = finder.findPath(ESSENCE_RETURN.aubury, ESSENCE_MINE_PAD, {
            state: richRm,
            useTeleportCatalog: false
        });
        expect(into.ok).toBe(false);

        const out = finder.findPath(ESSENCE_MINE_PAD, ESSENCE_RETURN.aubury, {
            state: { ...richRm, essenceExitReturn: 'aubury' },
            useTeleportCatalog: false
        });
        expect(out.ok).toBe(false);
    });
});
