import { describe, expect, test } from 'bun:test';

import type { PathFinder, NavPoint } from '#/bot/event/webwalk/PathFinder.js';
import { emptyWorldStateData } from '#/bot/event/webwalk/worldStateData.js';
import { SPIRIT_TREE } from '#/bot/event/webwalk/travelCatalog.js';
import { richTransportQuestMap } from '#/bot/event/webwalk/transportQuestReqs.js';
import { fullMapFinder, hasCollisionPack, isolatedLandingFinder } from '../../lib/navCollision.js';

// Why: a fresh account planned Varrock to the gnome village through two Spirit Trees it had never
// unlocked, walked at them, and repathed forever when the Talk-to produced no teleport.

const VARROCK: NavPoint = { x: 3155, z: 3400, level: 0 };
const GNOME_VILLAGE: NavPoint = { x: 2555, z: 3259, level: 0 };

const spiritHops = (finder: PathFinder, state: ReturnType<typeof emptyWorldStateData>): number => {
    const out = finder.findPath(VARROCK, GNOME_VILLAGE, { useTeleportCatalog: false, state });
    return out.ok ? out.hops.filter(h => /spirit tree/i.test(h.locName ?? '')).length : 0;
};

describe('spirit trees are gated on the quest that unlocks them', () => {
    test('the Varrock tree opens when Tree Gnome Village is complete', () => {
        const { varrock, village } = SPIRIT_TREE;
        const finder = isolatedLandingFinder([varrock, village]);
        const route = (status: 'not_started' | 'started' | 'complete') => finder.findPath(varrock, village, {
            useTeleportCatalog: false,
            state: { ...emptyWorldStateData(), quests: { 'Tree Gnome Village': status } }
        });

        expect(route('not_started').ok).toBe(false);
        expect(route('started').ok).toBe(false);
        expect(route('complete')).toMatchObject({ ok: true, hops: [{ locName: 'Spirit Tree' }] });
    });

    test.skipIf(!hasCollisionPack)('an account without Tree Gnome Village is not routed through one', () => {
        const finder = fullMapFinder();
        expect(spiritHops(finder, emptyWorldStateData())).toBe(0);
    });

    test.skipIf(!hasCollisionPack)('an account that has done the quests may use them', () => {
        const finder = fullMapFinder();
        const unlocked = { ...emptyWorldStateData(), quests: richTransportQuestMap() };
        expect(spiritHops(finder, unlocked)).toBeGreaterThan(0);
    });
});
