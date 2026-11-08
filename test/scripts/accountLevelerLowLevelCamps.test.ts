import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Glob } from 'bun';
import { expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';
import { COMBAT_CAMPS, combatPlan } from '#/bot/scripts/AccountLeveler/combat.js';
import { emptyMemory, enabledSkills } from '#/bot/scripts/AccountLeveler/planner.js';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { emptyWorldStateData } from '#/bot/event/webwalk/worldStateData.js';
import { resolveDangerZones } from '#/bot/event/webwalk/data/dangerZones.js';
import type { LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';

const additions = [
    { id: 'lumbridge-swamp-giant-rats', npcIds: [86, 87] },
    { id: 'lumbridge-south-giant-rats', npcIds: [86, 87] },
    { id: 'port-sarim-giant-rats', npcIds: [86, 87] },
    { id: 'varrock-east-giant-rats', npcIds: [86, 87] },
    { id: 'varrock-spiders', npcIds: [61] },
    { id: 'lumbridge-giant-spiders', npcIds: [59, 60] },
    { id: 'edgeville-giant-spiders', npcIds: [59, 60] },
    { id: 'al-kharid-spiders', npcIds: [61] },
    { id: 'falador-dwarves', npcIds: [118, 120, 206] },
    { id: 'ice-mountain-dwarves', npcIds: [118, 120, 206] },
    { id: 'ice-mountain-west-dwarves', npcIds: [118, 120, 206] },
    { id: 'lumbridge-women', npcIds: [4, 5, 6] },
    { id: 'lumbridge-east-women', npcIds: [4, 5, 6] },
    { id: 'port-sarim-women', npcIds: [4, 5, 6] },
    { id: 'falador-women', npcIds: [4, 5, 6] },
    { id: 'varrock-square-women', npcIds: [4, 5, 6] },
    { id: 'varrock-northeast-women', npcIds: [4, 5, 6] },
    { id: 'catherby-women', npcIds: [4, 5, 6] },
    { id: 'yanille-women', npcIds: [4, 5, 6] },
    { id: 'barbarian-women', npcIds: [17] },
    { id: 'varrock-barbarian-woman', npcIds: [17] },
    { id: 'al-kharid-warriors', npcIds: [18] },
    { id: 'falador-highwaymen', npcIds: [180] },
    { id: 'draynor-highwayman', npcIds: [180] },
    { id: 'varrock-unicorns', npcIds: [89] },
    { id: 'edgeville-unicorns', npcIds: [89] },
    { id: 'al-kharid-scorpions', npcIds: [107] },
    { id: 'khazard-gnomes', npcIds: [66, 67, 68] },
];
const snapshot = (level = 40): LevelerSnapshot => ({
    levels: Object.fromEntries(enabledSkills.map(skill => [skill, skill === 'hitpoints' ? Math.max(10, level) : level])),
    stock: { coins: 100000, trout: 100, 'bronze arrow': 87 }, bankReady: true, quests: {}, target: 40, wilderness: true, now: 1000
});
const isolate = (id: string) => ({ ...emptyMemory(), cooldowns: Object.fromEntries(COMBAT_CAMPS.filter(camp => camp.id !== id).map(camp => [camp.id, 2000])) });
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
            configs.set(block[1], { ...configs.get(block[1]), ...values });
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
        state, avoidZones: resolveDangerZones(['white-wolf-mountain'], { includeAutomatic: true, combatLevel: 3, start, destination }), useTeleportCatalog: false
    });
}

function targets(id: string) {
    const camp = COMBAT_CAMPS.find(camp => camp.id === id)!;
    return world!.spawns.filter(spawn => spawn.level === 0 && world!.npcs.get(spawn.id)?.name === camp.target && world!.npcs.get(spawn.id)?.op2 === 'Attack'
        && Math.max(Math.abs(spawn.x - camp.x), Math.abs(spawn.z - camp.z)) <= 12);
}

test.each(additions)('new camp $id is selectable at its stat gates for every combat style', ({ id }) => {
    const camp = COMBAT_CAMPS.find(camp => camp.id === id);
    expect(camp, id).toBeDefined();
    if (!camp) return;
    for (const objective of ['attack', 'ranged', 'magic']) {
        const plan = combatPlan(snapshot(), objective, isolate(id), () => 0)!;
        expect(plan?.id).toBe(id);
        expect(plan?.settings.target).toBe(camp.target);
    }
    const s = snapshot();
    Object.assign(s.levels, { hitpoints: camp.hp, attack: camp.offence, strength: camp.offence, defence: camp.defence });
    expect(combatPlan(s, 'attack', isolate(id), () => 0)?.id).toBe(id);
    for (const skill of ['hitpoints', 'attack', 'strength', 'defence']) {
        const low = { ...s, levels: { ...s.levels, [skill]: s.levels[skill] - 1 } };
        expect(combatPlan(low, 'attack', isolate(id), () => 0)).toBeNull();
    }
});

test('fresh accounts rotate through at least twenty camps and eight ordinary target types without food', () => {
    const s = snapshot(1);
    s.stock = { coins: 100000 };
    const memory = emptyMemory();
    let seed = 812;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const camps = new Set<string>(), mobs = new Set<string>();
    for (let i = 0; i < 600; i++) {
        const plan = combatPlan(s, 'attack', memory, random)!;
        expect(plan.deathWalk).toBe(true);
        expect(plan.food).toBeUndefined();
        camps.add(plan.id);
        mobs.add(String(plan.settings.target));
        memory.recent = [...memory.recent, plan.id].slice(-6);
    }
    expect(camps.size).toBeGreaterThanOrEqual(20);
    expect(mobs.size).toBeGreaterThanOrEqual(8);
});

test('teleporting imps and the three inaccessible starter sites remain excluded', () => {
    expect(COMBAT_CAMPS.some(camp => camp.target === 'Imp')).toBe(false);
    for (const id of ['port-sarim-rats', 'varrock-chickens', 'varrock-rats']) expect(COMBAT_CAMPS.some(camp => camp.id === id)).toBe(false);
});

test.skipIf(!hasSource).each(additions)('source verifies attackable ordinary NPCs and safe nearby spawns at $id', ({ id, npcIds }) => {
    const camp = COMBAT_CAMPS.find(camp => camp.id === id);
    expect(camp, id).toBeDefined();
    if (!camp) return;
    const nearby = targets(id);
    expect(nearby.length, id).toBeGreaterThan(0);
    for (const spawn of nearby) {
        const npc = world!.npcs.get(spawn.id)!;
        expect(npcIds, `${id}:${spawn.id}`).toContain(spawn.id);
        expect(npc.op2, npc.key).toBe('Attack');
        expect(Number(npc.vislevel)).toBeLessThanOrEqual(25);
        expect(world!.attackOverrides.has(npc.key), npc.key).toBe(false);
        if (npc.category) expect(world!.attackOverrides.has(`_${npc.category}`), npc.key).toBe(false);
    }
    if (camp.offence <= 15) {
        const dangerous = world!.spawns.filter(spawn => {
            const npc = world!.npcs.get(spawn.id);
            if (spawn.level !== 0 || !npc?.huntmode || Number(npc.vislevel) < 10) return false;
            return Math.max(Math.abs(spawn.x - camp.x), Math.abs(spawn.z - camp.z)) <= 12 + Number(npc.wanderrange ?? 5) + Number(npc.huntrange ?? 0);
        });
        expect(dangerous.map(spawn => `${world!.npcs.get(spawn.id)?.name}:${spawn.x},${spawn.z}`), id).toEqual([]);
    }
});

test.skipIf(!hasSource || !hasNav).each(additions)('real routes reach $id and its target spawns without restricted doors', ({ id }) => {
    const camp = COMBAT_CAMPS.find(camp => camp.id === id);
    expect(camp, id).toBeDefined();
    if (!camp) return;
    const anchor = { x: camp.x, z: camp.z, level: 0 };
    for (const bank of banks) {
        const path = route(bank, anchor);
        expect(path.ok, `${id} from ${bank.x},${bank.z}`).toBe(true);
        if (path.ok) {
            for (const hop of path.hops) expect([102, 1805, 1541], id).not.toContain(hop.locId);
            if (camp.offence <= 15) expect(path.waypoints.some(point => point.z > 6400), id).toBe(false);
        }
    }
    for (const spawn of targets(id)) {
        const path = route(anchor, spawn);
        expect(path.ok, `${id} target ${spawn.x},${spawn.z}`).toBe(true);
        if (path.ok) {
            expect(path.cost, `${id} target ${spawn.x},${spawn.z}`).toBeLessThanOrEqual(64);
            for (const hop of path.hops) expect([102, 1805, 1541], id).not.toContain(hop.locId);
        }
    }
}, 20000);
