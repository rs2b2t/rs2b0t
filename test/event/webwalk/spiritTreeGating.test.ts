import { loadDefaultFinder } from '../../lib/navigation.js';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'bun:test';

import { PathFinder, type NavPoint } from '#/bot/event/webwalk/PathFinder.js';
import { emptyWorldStateData } from '#/bot/event/webwalk/worldStateData.js';
import { richTransportQuestMap } from '#/bot/event/webwalk/transportQuestReqs.js';

// Why: a fresh account planned Varrock to the gnome village through two Spirit Trees it had never
// unlocked, walked at them, and repathed forever when the Talk-to produced no teleport.

const VARROCK: NavPoint = { x: 3155, z: 3400, level: 0 };
const GNOME_VILLAGE: NavPoint = { x: 2555, z: 3259, level: 0 };

function loadFinder(): PathFinder | null {
    const packPath = path.join(process.cwd(), 'out/collision.lcnav.gz');
    if (!fs.existsSync(packPath)) {
        return null;
    }
    return loadDefaultFinder(packPath);
}

const spiritHops = (finder: PathFinder, state: ReturnType<typeof emptyWorldStateData>): number => {
    const out = finder.findPath(VARROCK, GNOME_VILLAGE, { useTeleportCatalog: false, state });
    return out.ok ? out.hops.filter(h => /spirit tree/i.test(h.locName ?? '')).length : 0;
};

describe('spirit trees are gated on the quest that unlocks them', () => {
    test('an account without Tree Gnome Village is not routed through one', () => {
        const finder = loadFinder();
        if (!finder) {
            return;
        }
        expect(spiritHops(finder, emptyWorldStateData())).toBe(0);
    });

    test('an account that has done the quests may use them', () => {
        const finder = loadFinder();
        if (!finder) {
            return;
        }
        const unlocked = { ...emptyWorldStateData(), quests: richTransportQuestMap() };
        expect(spiritHops(finder, unlocked)).toBeGreaterThan(0);
    });
});
