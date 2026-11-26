import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'fflate';
import { sourceWorld, hasContentSource, contentRoot } from '../lib/contentWorld.js';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { emptyWorldStateData } from '#/bot/event/webwalk/worldStateData.js';
import { levelerTravelZones } from '#/bot/scripts/AccountLeveler/travel.js';
import { resolveDangerZones } from '#/bot/event/webwalk/data/dangerZones.js';

const camp = { x: 2861, z: 9841, level: 0 };
const bank = { x: 3013, z: 3355, level: 0 };

test.skipIf(!hasContentSource)('hard farm has ordinary hellhound spawns and a hard clue drop table', () => {
    const world = sourceWorld();
    const targets = world.spawns.filter(spawn => spawn.level === 0 && Math.max(Math.abs(spawn.x - camp.x), Math.abs(spawn.z - camp.z)) <= 8 && world.npcs.get(spawn.id)?.name === 'Hellhound');
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every(spawn => spawn.id === 49)).toBe(true);
    expect(world.attackOverrides.has('hellhound')).toBe(false);
    expect(readFileSync(`${contentRoot}/scripts/drop tables/scripts/hellhound.rs2`, 'utf8')).toContain('~trail_hardcluedrop(64, npc_coord)');
});

test.skipIf(!existsSync('out/collision.lcnav.gz'))('hard farm route works with the declared key and shield without Wilderness', () => {
    const finder = new PathFinder(gunzipSync(readFileSync('out/collision.lcnav.gz')));
    loadDefaultNavEdges(finder);
    const state = emptyWorldStateData();
    state.skills = { attack: 60, strength: 60, defence: 60, hitpoints: 60, prayer: 43, agility: 1 };
    state.items = { 'Dusty key': 1, Coins: 1000 };
    state.worn = { 'Dragon dagger': 1, 'Dragonfire shield': 1 };
    state.entranaRestrictedGear = true;
    for (const [start, destination] of [[bank, camp], [camp, bank]]) {
        const result = finder.findPath(start, destination, { state, useTeleportCatalog: false,
            avoidZones: resolveDangerZones(levelerTravelZones(destination, false), { includeAutomatic: true, combatLevel: 76, start, destination }) });
        expect(result.ok).toBe(true);
    }
});
