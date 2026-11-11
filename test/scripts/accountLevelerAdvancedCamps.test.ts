import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';
import { ADVANCED_CAMPS } from '#/bot/scripts/AccountLeveler/advancedCamps.js';
import type { CombatCamp } from '#/bot/scripts/AccountLeveler/combat.js';
import { levelerTravelZones } from '#/bot/scripts/AccountLeveler/travel.js';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { emptyWorldStateData, type WorldStateData } from '#/bot/event/webwalk/worldStateData.js';
import { resolveDangerZones } from '#/bot/event/webwalk/data/dangerZones.js';
import type { NavPoint } from '#/bot/event/webwalk/types.js';
import { hasContentSource, sourceWorld } from '../lib/contentWorld.js';

const expected: Record<string, { npcIds: number[]; maxThreat: number }> = {
    'brimhaven-pirates': { npcIds: [183], maxThreat: 28 },
    'brimhaven-thieves': { npcIds: [8], maxThreat: 28 },
    'falador-west-guards': { npcIds: [9], maxThreat: 28 },
    'edgeville-guards': { npcIds: [9], maxThreat: 28 },
    'varrock-south-guards': { npcIds: [9], maxThreat: 28 },
    'varrock-palace-upper-guards': { npcIds: [9], maxThreat: 28 },
    'ardougne-north-guards': { npcIds: [32], maxThreat: 28 },
    'khazard-west-troopers': { npcIds: [475, 476], maxThreat: 28 },
    'crandor-moss-giants': { npcIds: [112], maxThreat: 42 },
    'canifis-south-ghouls': { npcIds: [1218], maxThreat: 42 },
    'gu-tanoth-ogres': { npcIds: [114, 115], maxThreat: 53 },
    'karamja-lesser-demons': { npcIds: [82], maxThreat: 82 },
    'crandor-lesser-demons': { npcIds: [82], maxThreat: 82 },
    'troll-stronghold-trolls': { npcIds: [1106, 1107, 1108, 1109, 1110, 1111, 1112], maxThreat: 69 },
    'gu-tanoth-city-guards': { npcIds: [862], maxThreat: 83 },
    'lighthouse-dagannoths': { npcIds: [1338, 1339, 1340, 1341, 1342, 1343], maxThreat: 92 },
    'brimhaven-dungeon-moss-giants': { npcIds: [112], maxThreat: 63 },
    'brimhaven-dungeon-fire-giants': { npcIds: [110], maxThreat: 86 }
};
const variants: Record<number, [number, number]> = {
    8: [16, 17], 9: [21, 22], 32: [20, 22], 82: [82, 79], 110: [86, 111], 112: [42, 60],
    114: [53, 60], 115: [53, 60], 183: [23, 20], 475: [19, 22], 476: [19, 22], 862: [83, 80],
    1106: [69, 90], 1107: [69, 90], 1108: [69, 90], 1109: [69, 90], 1110: [69, 90], 1111: [69, 90], 1112: [69, 90],
    1218: [42, 50], 1338: [74, 70], 1339: [74, 70], 1340: [74, 70], 1341: [92, 120], 1342: [92, 120], 1343: [92, 120]
};
const world = hasContentSource ? sourceWorld() : null;
const hasNav = existsSync('out/collision.lcnav.gz');
const finder = hasNav ? new PathFinder(gunzipSync(readFileSync('out/collision.lcnav.gz'))) : null;
if (finder) loadDefaultNavEdges(finder);
const banks = [{ x: 3092, z: 3243, level: 0 }, { x: 3013, z: 3355, level: 0 }, { x: 2612, z: 3092, level: 0 }];
const distance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

function targets(camp: CombatCamp, wandering = false) {
    return world!.spawns.filter(spawn => spawn.level === (camp.level ?? 0)
        && world!.npcs.get(spawn.id)?.name === camp.target
        && distance(spawn, camp) <= (camp.leashRadius ?? 12) + (wandering ? Number(world!.npcs.get(spawn.id)?.wanderrange ?? 5) : 0));
}

function campState(camp: CombatCamp): WorldStateData {
    const state = emptyWorldStateData();
    state.skills = { ...camp.skills };
    state.quests = Object.fromEntries((camp.quests ?? []).map(quest => [quest, 'complete']));
    state.items = { Coins: camp.coins ?? 200 };
    state.worn = {};
    for (const supply of camp.supplies ?? []) {
        (supply.equip ? state.worn : state.items)[supply.item] = supply.carry ?? supply.count;
    }
    state.entranaRestrictedGear = true;
    state.canSlashWeb = false;
    return state;
}

function route(camp: CombatCamp, start: NavPoint, destination: NavPoint) {
    return finder!.findPath(start, destination, {
        state: campState(camp),
        avoidZones: resolveDangerZones(levelerTravelZones(destination), { includeAutomatic: true, combatLevel: camp.minCombat ?? 3, start, destination }),
        useTeleportCatalog: false
    });
}

test('every advanced camp has an independent source audit', () => {
    expect(new Set(ADVANCED_CAMPS.map(camp => camp.id))).toEqual(new Set(Object.keys(expected)));
});

test.skipIf(!hasContentSource).each([...ADVANCED_CAMPS])('source verifies ordinary target variants at $id', camp => {
    const spec = expected[camp.id];
    expect(spec, camp.id).toBeDefined();
    expect(targets(camp).length, camp.id).toBeGreaterThan(0);
    for (const spawn of targets(camp, true)) {
        const npc = world!.npcs.get(spawn.id)!;
        expect(spec.npcIds, `${camp.id}:${npc.key}`).toContain(spawn.id);
        expect([Number(npc.vislevel), Number(npc.hitpoints)], npc.key).toEqual(variants[spawn.id]);
        expect(npc.op2, npc.key).toBe('Attack');
        expect(world!.attackOverrides.has(npc.key), npc.key).toBe(false);
        if (npc.category) expect(world!.attackOverrides.has(`_${npc.category}`), npc.key).toBe(false);
    }
});

test.skipIf(!hasContentSource).each([...ADVANCED_CAMPS])('hunting NPCs around $id stay within its threat band without poison', camp => {
    for (const spawn of world!.spawns) {
        const npc = world!.npcs.get(spawn.id)!;
        if (spawn.level !== (camp.level ?? 0) || !npc.huntmode
            || distance(spawn, camp) > (camp.leashRadius ?? 12) + 4 + Number(npc.wanderrange ?? 5) + Number(npc.huntrange ?? 0) + Number(npc.size ?? 1) - 1) continue;
        expect(Number(npc.vislevel), `${camp.id}:${npc.key}@${spawn.x},${spawn.z}`).toBeLessThanOrEqual(expected[camp.id].maxThreat);
        expect(npc.params, `${camp.id}:${npc.key}`).not.toMatch(/poison/);
    }
});

test.skipIf(!hasContentSource || !hasNav).each([...ADVANCED_CAMPS])('declared travel supplies reach $id from three banks and return', camp => {
    const anchor = { x: camp.x, z: camp.z, level: camp.level ?? 0 };
    expect(finder!.walkable(anchor.x, anchor.z, anchor.level), camp.id).toBe(true);
    for (const bank of banks) {
        for (const [start, destination] of [[bank, anchor], [anchor, bank]]) {
            const path = route(camp, start, destination);
            expect(path.ok, `${camp.id}: ${JSON.stringify(start)} -> ${JSON.stringify(destination)}${path.ok ? '' : `: ${path.reason}`}`).toBe(true);
            if (path.ok) for (const hop of path.hops) expect([102, 1805, 1541], camp.id).not.toContain(hop.locId);
        }
    }
}, 30_000);

test.skipIf(!hasContentSource || !hasNav).each([...ADVANCED_CAMPS])('anchor reaches every target spawn in the wander envelope at $id', camp => {
    const anchor = { x: camp.x, z: camp.z, level: camp.level ?? 0 };
    for (const spawn of targets(camp, true)) {
        const path = route(camp, anchor, spawn);
        expect(path.ok, `${camp.id}: ${spawn.id}@${spawn.x},${spawn.z},${spawn.level}${path.ok ? '' : `: ${path.reason}`}`).toBe(true);
        if (path.ok) {
            expect(path.cost, `${camp.id}: ${spawn.x},${spawn.z}`).toBeLessThanOrEqual(64);
            for (const hop of path.hops) expect([102, 1805, 1541], camp.id).not.toContain(hop.locId);
        }
    }
}, 30_000);
