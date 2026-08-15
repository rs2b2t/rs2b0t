import { describe, expect, test } from 'bun:test';
import { explainUnreachable, gateItemCandidates } from '#/bot/event/webwalk/gateItems.js';
import type { PathResult } from '#/bot/event/webwalk/Navigator.js';
import type { WorldStateData } from '#/bot/event/webwalk/worldStateData.js';

const state = (items: Record<string, number> = {}): WorldStateData => ({
    members: true,
    skills: { magic: 99 },
    quests: {},
    items,
    worn: {},
    freeSlots: 20,
    entranaRestrictedGear: false
});

/**
 * Geometry from the baked pack: the player stands at (3304,3118), the loc
 * is at (3302,3116), and the hop lands at (3304,3114).
 */
const shantayPath = (): PathResult =>
    ({
        ok: true,
        cost: 100,
        expanded: 10,
        waypoints: [
            { x: 3304, z: 3118, level: 0 },
            {
                x: 3304,
                z: 3114,
                level: 0,
                transport: { locName: 'Shantay pass', action: 'Go-through', locX: 3302, locZ: 3116, kind: 'door' }
            }
        ]
    }) as unknown as PathResult;

describe('gateItemCandidates', () => {
    test('includes every item a baked crossing can demand', () => {
        const c = gateItemCandidates();
        expect(c['Shantay pass']).toBeGreaterThanOrEqual(1);
        expect(c['Rope']).toBeGreaterThanOrEqual(1);
        expect(c['Brass key']).toBeGreaterThanOrEqual(1);
    });

    test('coins cover the priciest fare, not the cheapest toll', () => {
        expect(gateItemCandidates()['Coins']).toBeGreaterThanOrEqual(30);
    });
});

describe('explainUnreachable', () => {
    test('names the item that would open the route', async () => {
        const missing = await explainUnreachable(() => Promise.resolve(shantayPath()), state());
        expect(missing).toEqual([{ name: 'Shantay pass', count: 1 }]);
    });

    test('says nothing when the player already holds the gate item', async () => {
        const missing = await explainUnreachable(
            () => Promise.resolve(shantayPath()),
            state({ 'Shantay pass': 1 })
        );
        expect(missing).toEqual([]);
    });

    test('a route that stays unreachable even with the full kit is a real nav gap', async () => {
        const missing = await explainUnreachable(
            () => Promise.resolve({ ok: false, reason: 'unreachable', expanded: 1 } as PathResult),
            state()
        );
        expect(missing).toEqual([]);
    });

    test('probes with every gate item virtualized, not the real inventory', async () => {
        let seen: WorldStateData | null = null;
        await explainUnreachable(s => {
            seen = s;
            return Promise.resolve(shantayPath());
        }, state());
        expect(seen).not.toBeNull();
        expect(seen!.items['Shantay pass']).toBeGreaterThanOrEqual(1);
        expect(seen!.items['Coins']).toBeGreaterThanOrEqual(30);
    });
});
