import { describe, expect, test } from 'bun:test';
import { segmentPack } from '../../lib/syntheticCollisionPack.js';

import { PathFinder, type NavPoint, type TransportEdgeData } from '#/bot/event/webwalk/PathFinder.js';
import { allTransportRows } from '#/bot/event/webwalk/loadTransportGraph.js';
import { ESSENCE_MINE_PAD, ESSENCE_RETURN, essenceEntryEdges } from '#/bot/event/webwalk/travelCatalog.js';
import { emptyWorldStateData } from '#/bot/event/webwalk/worldStateData.js';

// Why: scripts own the wizard teleport, so entry is blacklisted (random over 22 pads) rather than modelled in the nav graph.
// Exit stays on the graph behind `essenceExitReturn`, landing on the entry wizard's return stand ±2 (`map_findsquare` r=2).

const PORTAL_STAND = { x: 2932, z: 4816, level: 0 } as const;

function finderOver(segments: [NavPoint, NavPoint][]): PathFinder {
    const finder = new PathFinder(segmentPack(segments));
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

describe('essence mine multiloc (entry blacklist #388, exit path-state #377)', () => {
    test('every essence entry is blacklisted (catalog kept for audits)', () => {
        const entries = essenceEntryEdges();
        expect(entries).toHaveLength(5);
        for (const e of entries) {
            expect(e.blacklist, e.debugName).toBe(true);
            expect(e.blacklistReason, e.debugName).toMatch(/random|22 pads|essence_mine/i);
            expect(e.requires?.essenceEntrySetsReturn, e.debugName).toBeDefined();
            expect(e.action).toBe('Teleport');
        }
    });

    test('entry edges stay in the catalog but do not enter the graph', () => {
        const intoMine = allTransportRows().filter(
            e =>
                e.to.x === ESSENCE_MINE_PAD.x
                && e.to.z === ESSENCE_MINE_PAD.z
                && e.requires?.essenceEntrySetsReturn
        );
        expect(intoMine.length).toBe(5);
        expect(intoMine.every(e => e.blacklist === true)).toBe(true);
    });

    test('litmus: never surface OD through the mine (entry blacklisted)', () => {
        const brimstail: [NavPoint, NavPoint] = [ESSENCE_RETURN.brimstail, ESSENCE_RETURN.brimstail];
        const aubury: [NavPoint, NavPoint] = [ESSENCE_RETURN.aubury, ESSENCE_RETURN.aubury];
        const sedridor: [NavPoint, NavPoint] = [ESSENCE_RETURN.sedridor, ESSENCE_RETURN.sedridor];
        const finder = finderOver([brimstail, aubury, MINE_FLOOR, sedridor]);
        const opts = { state: richRm, useTeleportCatalog: false as const };
        expect(finder.findPath(ESSENCE_RETURN.brimstail, ESSENCE_RETURN.sedridor, opts).ok).toBe(false);
        expect(finder.findPath(ESSENCE_RETURN.aubury, ESSENCE_RETURN.sedridor, opts).ok).toBe(false);
        expect(finder.findPath(ESSENCE_RETURN.sedridor, ESSENCE_RETURN.aubury, opts).ok).toBe(false);
        // Surface wizard → mine pad requires blacklisted entry.
        expect(finder.findPath(ESSENCE_RETURN.brimstail, ESSENCE_MINE_PAD, opts).ok).toBe(false);
    });

    test('exit with session return remains planable (#377 path-state)', () => {
        const brimstail: [NavPoint, NavPoint] = [ESSENCE_RETURN.brimstail, ESSENCE_RETURN.brimstail];
        const finder = finderOver([brimstail, MINE_FLOOR]);
        const out = finder.findPath(ESSENCE_MINE_PAD, ESSENCE_RETURN.brimstail, {
            state: { ...richRm, essenceExitReturn: 'brimstail' },
            useTeleportCatalog: false
        });
        expect(out.ok).toBe(true);
        if (!out.ok) {
            return;
        }
        expect(out.waypoints.some(w => w.transport?.action === 'Use')).toBe(true);
    });

    test('portal gets you out to session return (sedridor state)', () => {
        const sedridor: [NavPoint, NavPoint] = [ESSENCE_RETURN.sedridor, ESSENCE_RETURN.sedridor];
        const finder = finderOver([MINE_FLOOR, sedridor]);
        const outcome = finder.findPath(ESSENCE_MINE_PAD, ESSENCE_RETURN.sedridor, {
            state: { ...emptyWorldStateData(), essenceExitReturn: 'sedridor' },
            useTeleportCatalog: false
        });
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) {
            return;
        }
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

    test('Aubury → mine pad is not path-planned (entry blacklisted)', () => {
        const aubury: [NavPoint, NavPoint] = [ESSENCE_RETURN.aubury, ESSENCE_RETURN.aubury];
        const finder = finderOver([aubury, MINE_FLOOR]);
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

        // Exit still works once a script (or state seed) has put the session return.
        const out = finder.findPath(ESSENCE_MINE_PAD, ESSENCE_RETURN.aubury, {
            state: { ...richRm, essenceExitReturn: 'aubury' },
            useTeleportCatalog: false
        });
        expect(out.ok).toBe(true);
    });
});
