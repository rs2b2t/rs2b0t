import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Glob } from 'bun';
import { expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';
import { COMBAT_CAMPS } from '#/bot/scripts/AccountLeveler/combat.js';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { emptyWorldStateData } from '#/bot/event/webwalk/worldStateData.js';
import { resolveDangerZones } from '#/bot/event/webwalk/data/dangerZones.js';

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
const content = resolve('../rs2b2t-content');
const hasSource = existsSync(`${content}/pack/npc.pack`);
const hasNav = existsSync('out/collision.lcnav.gz');
type NpcConfig = Record<string, string>;
interface Spawn { id: number; x: number; z: number; level: number }

function sourceWorld() {
    const configs = new Map<string, NpcConfig>();
    for (const file of new Glob('scripts/**/*.npc').scanSync({ cwd: content })) {
        for (const block of readFileSync(`${content}/${file}`, 'utf8').matchAll(/^\[([^\]]+)\]\n(.*?)(?=^\[|$(?![\s\S]))/gms)) {
            const values = Object.fromEntries(block[2].split('\n').filter(line => line.includes('=')).map(line => {
                const index = line.indexOf('=');
                return [line.slice(0, index), line.slice(index + 1)];
            }));
            configs.set(block[1], { ...configs.get(block[1]), ...values, params: block[2].split('\n').filter(line => line.startsWith('param=')).join('\n') });
        }
    }
    const npcs = new Map<number, NpcConfig>();
    for (const line of readFileSync(`${content}/pack/npc.pack`, 'utf8').split('\n')) {
        const [id, key] = line.split('=');
        if (key) npcs.set(Number(id), { ...configs.get(key), key });
    }
    const spawns: Spawn[] = [];
    for (const file of new Glob('maps/*.jm2').scanSync({ cwd: content })) {
        const square = /m(\d+)_(\d+)\.jm2/.exec(file)!;
        const section = readFileSync(`${content}/${file}`, 'utf8').split('==== NPC ====')[1]?.split('====')[0] ?? '';
        for (const match of section.matchAll(/^(\d+) (\d+) (\d+): (\d+)$/gm)) {
            spawns.push({ id: Number(match[4]), x: Number(square[1]) * 64 + Number(match[2]), z: Number(square[2]) * 64 + Number(match[3]), level: Number(match[1]) });
        }
    }
    const attackOverrides = new Set<string>();
    for (const file of new Glob('scripts/**/*.rs2').scanSync({ cwd: content })) {
        for (const match of readFileSync(`${content}/${file}`, 'utf8').matchAll(/\[(?:opnpc2|apnpc2),([^\]]+)\]/g)) attackOverrides.add(match[1]);
    }
    return { npcs, spawns, attackOverrides };
}

const world = hasSource ? sourceWorld() : null;
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

test.skipIf(!hasSource).each(additions)('source verifies ordinary variants and nearby threats at $id', ({ id, npcIds, maxThreat }) => {
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

test.skipIf(!hasSource || !hasNav).each(additions)('real routes reach $id and target spawns without restricted doors', ({ id }) => {
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
