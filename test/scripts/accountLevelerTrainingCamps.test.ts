import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';
import { COMBAT_CAMPS } from '#/bot/scripts/AccountLeveler/combat.js';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { emptyWorldStateData } from '#/bot/event/webwalk/worldStateData.js';
import { resolveDangerZones } from '#/bot/event/webwalk/data/dangerZones.js';
import { hasContentSource, sourceWorld } from '../lib/contentWorld.js';

const additions = [
    { id: 'varrock-west-guards', npcIds: [9], maxThreat: 28 },
    { id: 'varrock-east-guards', npcIds: [9], maxThreat: 28 },
    { id: 'falador-north-guards', npcIds: [9], maxThreat: 28 },
    { id: 'falador-south-guards', npcIds: [9], maxThreat: 28 },
    { id: 'lumbridge-bears', npcIds: [105], maxThreat: 28 },
    { id: 'varrock-east-bears', npcIds: [106], maxThreat: 28 },
    { id: 'ice-mountain-bears', npcIds: [106], maxThreat: 28 },
    { id: 'varrock-sewer-zombies', npcIds: [73], maxThreat: 28 },
    { id: 'edgeville-dungeon-skeletons', npcIds: [91], maxThreat: 28 },
    { id: 'rimmington-hobgoblins', npcIds: [122], maxThreat: 28 },
    { id: 'yanille-giants', npcIds: [117], maxThreat: 28 },
    { id: 'varrock-warrior-women', npcIds: [15], maxThreat: 28 },
    { id: 'burthorpe-guards', npcIds: [1076, 1077], maxThreat: 37 },
    { id: 'varrock-palace-guards', npcIds: [9], maxThreat: 28 },
    { id: 'edgeville-dungeon-giants', npcIds: [117], maxThreat: 28 },
    { id: 'wilderness-east-giants', npcIds: [117], maxThreat: 28 },
    { id: 'ardougne-moss-giants', npcIds: [112], maxThreat: 42 },
    { id: 'wilderness-hobgoblins', npcIds: [122], maxThreat: 28 },
];
const hasNav = existsSync('out/collision.lcnav.gz');
const world = hasContentSource ? sourceWorld() : null;
const finder = hasNav ? new PathFinder(gunzipSync(readFileSync('out/collision.lcnav.gz'))) : null;
if (finder) loadDefaultNavEdges(finder);
const state = { ...emptyWorldStateData(), members: true, skills: { agility: 1 }, items: { Coins: 200 }, entranaRestrictedGear: true, canSlashWeb: false };
const banks = [{ x: 3092, z: 3243, level: 0 }, { x: 3013, z: 3355, level: 0 }, { x: 3185, z: 3436, level: 0 }];

function route(start: { x: number; z: number; level: number }, destination: { x: number; z: number; level: number }) {
    return finder!.findPath(start, destination, {
        state, avoidZones: resolveDangerZones(['white-wolf-mountain'], { includeAutomatic: true, combatLevel: 25, start, destination }), useTeleportCatalog: false
    });
}

function targets(id: string, wandering = false) {
    const camp = COMBAT_CAMPS.find(camp => camp.id === id)!;
    return world!.spawns.filter(spawn => spawn.level === 0 && world!.npcs.get(spawn.id)?.name === camp.target && world!.npcs.get(spawn.id)?.op2 === 'Attack'
        && Math.max(Math.abs(spawn.x - camp.x), Math.abs(spawn.z - camp.z)) <= 12 + (wandering ? Number(world!.npcs.get(spawn.id)?.wanderrange ?? 5) : 0));
}

test.each(additions)('training camp $id is registered', ({ id }) => {
    expect(COMBAT_CAMPS.find(camp => camp.id === id), id).toBeDefined();
});

const variants: Record<number, [number, number]> = {
    9: [21, 22], 15: [24, 20], 73: [13, 22], 91: [21, 24], 105: [21, 27], 106: [19, 25],
    112: [42, 60], 117: [28, 35], 122: [28, 29], 1076: [37, 40], 1077: [37, 40]
};

test.skipIf(!hasContentSource).each(additions)('source verifies ordinary variants and nearby threats at $id', ({ id, npcIds, maxThreat }) => {
    const camp = COMBAT_CAMPS.find(camp => camp.id === id);
    expect(camp, id).toBeDefined();
    if (!camp) return;
    expect(targets(id).length, id).toBeGreaterThan(0);
    for (const spawn of targets(id, true)) {
        const npc = world!.npcs.get(spawn.id)!;
        expect(npcIds, `${id}:${spawn.id}`).toContain(spawn.id);
        expect([Number(npc.vislevel), Number(npc.hitpoints)], npc.key).toEqual(variants[spawn.id]);
        expect(npc.op2, npc.key).toBe('Attack');
        expect(world!.attackOverrides.has(npc.key), npc.key).toBe(false);
        if (npc.category) expect(world!.attackOverrides.has(`_${npc.category}`), npc.key).toBe(false);
    }
    for (const spawn of world!.spawns) {
        const npc = world!.npcs.get(spawn.id)!;
        if (spawn.level !== 0 || !npc.huntmode || Math.max(Math.abs(spawn.x - camp.x), Math.abs(spawn.z - camp.z)) > 12 + Number(npc.wanderrange ?? 5) + Number(npc.huntrange ?? 0)) continue;
        expect(Number(npc.vislevel), `${id}:${npc.key}`).toBeLessThanOrEqual(maxThreat);
        expect(npc.params, `${id}:${npc.key}`).not.toMatch(/poison/);
    }
});

test.skipIf(!hasContentSource || !hasNav).each(additions)('real routes reach $id and target spawns without restricted doors', ({ id }) => {
    const camp = COMBAT_CAMPS.find(camp => camp.id === id);
    expect(camp, id).toBeDefined();
    if (!camp) return;
    const anchor = { x: camp.x, z: camp.z, level: 0 };
    for (const bank of banks) {
        const path = route(bank, anchor);
        expect(path.ok, `${id} from ${bank.x},${bank.z}`).toBe(true);
        if (path.ok) for (const hop of path.hops) expect([102, 1805, 1541], id).not.toContain(hop.locId);
    }
    for (const spawn of targets(id, true)) {
        const path = route(anchor, spawn);
        expect(path.ok, `${id} target ${spawn.x},${spawn.z}`).toBe(true);
        if (path.ok) {
            expect(path.cost, `${id} target ${spawn.x},${spawn.z}`).toBeLessThanOrEqual(64);
            for (const hop of path.hops) expect([102, 1805, 1541], id).not.toContain(hop.locId);
        }
    }
}, 20000);
