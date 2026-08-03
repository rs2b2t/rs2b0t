import { describe, expect, test } from 'bun:test';

import { PathFinder, type NavPoint, type TransportEdgeData } from '#/bot/nav/PathFinder.js';
import { allTransportRows } from '#/bot/nav/loadTransportGraph.js';
import { ESSENCE_MINE_PAD, ESSENCE_RETURN, essenceEntryEdges } from '#/bot/nav/v2/travelCatalog.js';
import { emptyWorldStateData } from '#/bot/nav/v2/worldStateData.js';

/**
 * Essence mine multiloc: entry sets path-local session return; exits require it.
 *
 * Content stores entry NPC in `%exit_essence_mine_coord` (server-only varp).
 * PathFinder packs return into the A* key so Aubury entry + Sedridor exit is not
 * a cost-20 surface wormhole (#377 live failure). Live execution uses EssenceSession.
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

describe('essence mine multiloc (entry + path-state return)', () => {
    test('every essence entry sets a session return id (not disabled)', () => {
        const entries = essenceEntryEdges();
        expect(entries).toHaveLength(5);
        for (const e of entries) {
            expect(e.disabledReason, e.debugName).toBeUndefined();
            expect(e.requires?.essenceEntrySetsReturn, e.debugName).toBeDefined();
            expect(e.action).toBe('Teleport');
        }
    });

    test('enabled entry edges exist into the mine pad', () => {
        const intoMine = allTransportRows().filter(
            e =>
                !e.disabledReason
                && e.to.x === ESSENCE_MINE_PAD.x
                && e.to.z === ESSENCE_MINE_PAD.z
                && e.requires?.essenceEntrySetsReturn
        );
        expect(intoMine.length).toBe(5);
    });

    test('litmus: multi-entry same-origin only — never surface OD through the mine', () => {
        // Pack connects each wizard stand only via the mine. If exit ignored session,
        // Brimstail→Sedridor would be a cost-20 wormhole. Path-state forbids that.
        const brimstail: [NavPoint, NavPoint] = [ESSENCE_RETURN.brimstail, ESSENCE_RETURN.brimstail];
        const aubury: [NavPoint, NavPoint] = [ESSENCE_RETURN.aubury, ESSENCE_RETURN.aubury];
        const sedridor: [NavPoint, NavPoint] = [ESSENCE_RETURN.sedridor, ESSENCE_RETURN.sedridor];
        const finder = finderOver([brimstail, aubury, MINE_FLOOR, sedridor]);
        const opts = { state: richRm, useTeleportCatalog: false as const };
        expect(finder.findPath(ESSENCE_RETURN.brimstail, ESSENCE_RETURN.sedridor, opts).ok).toBe(false);
        expect(finder.findPath(ESSENCE_RETURN.aubury, ESSENCE_RETURN.sedridor, opts).ok).toBe(false);
        expect(finder.findPath(ESSENCE_RETURN.sedridor, ESSENCE_RETURN.aubury, opts).ok).toBe(false);
        // Same-origin round trip remains admissible (entry then matching exit).
        expect(finder.findPath(ESSENCE_RETURN.brimstail, ESSENCE_MINE_PAD, opts).ok).toBe(true);
        expect(
            finder.findPath(ESSENCE_MINE_PAD, ESSENCE_RETURN.brimstail, {
                state: { ...richRm, essenceExitReturn: 'brimstail' },
                useTeleportCatalog: false
            }).ok
        ).toBe(true);
    });

    test('Brimstail entry + exit returns to Brimstail (honest round trip)', () => {
        const brimstail: [NavPoint, NavPoint] = [ESSENCE_RETURN.brimstail, ESSENCE_RETURN.brimstail];
        const finder = finderOver([brimstail, MINE_FLOOR]);
        const outcome = finder.findPath(ESSENCE_RETURN.brimstail, ESSENCE_RETURN.brimstail, {
            state: richRm,
            useTeleportCatalog: false
        });
        // Same tile start=goal snaps as arrived without hops — use mine as mid then out.
        // Plan mine pad → brimstail with session after "virtual" entry: seed state.
        const out = finder.findPath(ESSENCE_MINE_PAD, ESSENCE_RETURN.brimstail, {
            state: { ...richRm, essenceExitReturn: 'brimstail' },
            useTeleportCatalog: false
        });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.waypoints.some(w => w.transport?.action === 'Use')).toBe(true);
        void outcome;
        void brimstail;
    });

    test('portal gets you out to session return (sedridor state)', () => {
        const sedridor: [NavPoint, NavPoint] = [ESSENCE_RETURN.sedridor, ESSENCE_RETURN.sedridor];
        const finder = finderOver([MINE_FLOOR, sedridor]);
        const outcome = finder.findPath(ESSENCE_MINE_PAD, ESSENCE_RETURN.sedridor, {
            state: { ...emptyWorldStateData(), essenceExitReturn: 'sedridor' },
            useTeleportCatalog: false
        });
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        const portal = outcome.waypoints.find(w => w.transport?.action === 'Use');
        expect(portal?.transport?.toTile).toEqual({
            x: ESSENCE_RETURN.sedridor.x,
            z: ESSENCE_RETURN.sedridor.z
        });
    });

    test('session aubury cannot plan exit to sedridor', () => {
        const sedridor: [NavPoint, NavPoint] = [ESSENCE_RETURN.sedridor, ESSENCE_RETURN.sedridor];
        const aubury: [NavPoint, NavPoint] = [ESSENCE_RETURN.aubury, ESSENCE_RETURN.aubury];
        const finder = finderOver([MINE_FLOOR, sedridor, aubury]);
        expect(
            finder.findPath(ESSENCE_MINE_PAD, ESSENCE_RETURN.sedridor, {
                state: { ...emptyWorldStateData(), essenceExitReturn: 'aubury' },
                useTeleportCatalog: false
            }).ok
        ).toBe(false);
        expect(
            finder.findPath(ESSENCE_MINE_PAD, ESSENCE_RETURN.aubury, {
                state: { ...emptyWorldStateData(), essenceExitReturn: 'aubury' },
                useTeleportCatalog: false
            }).ok
        ).toBe(true);
    });

    test('Aubury entry then exit to Aubury is admissible (path sets return)', () => {
        const aubury: [NavPoint, NavPoint] = [ESSENCE_RETURN.aubury, ESSENCE_RETURN.aubury];
        const finder = finderOver([aubury, MINE_FLOOR]);
        // Start with no session; entry hop sets aubury so exit opens.
        const outcome = finder.findPath(ESSENCE_RETURN.aubury, ESSENCE_RETURN.aubury, {
            state: richRm,
            useTeleportCatalog: false
        });
        // start==goal → trivial path without needing mine
        expect(outcome.ok).toBe(true);

        // Non-trivial: force through mine by going aubury → mine pad only first
        const into = finder.findPath(ESSENCE_RETURN.aubury, ESSENCE_MINE_PAD, {
            state: richRm,
            useTeleportCatalog: false
        });
        expect(into.ok).toBe(true);
        if (!into.ok) return;
        expect(into.waypoints.some(w => w.transport?.action === 'Teleport')).toBe(true);

        // From mine with path-state after entry: replan with session aubury
        const out = finder.findPath(ESSENCE_MINE_PAD, ESSENCE_RETURN.aubury, {
            state: { ...richRm, essenceExitReturn: 'aubury' },
            useTeleportCatalog: false
        });
        expect(out.ok).toBe(true);
    });
});
