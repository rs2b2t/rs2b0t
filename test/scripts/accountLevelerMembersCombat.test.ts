import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'fflate';
import { expect, test } from 'bun:test';
import { COMBAT_CAMPS, combatPlan } from '#/bot/scripts/AccountLeveler/combat.js';
import { emptyMemory, enabledSkills, planNext } from '#/bot/scripts/AccountLeveler/planner.js';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { emptyWorldStateData } from '#/bot/event/webwalk/worldStateData.js';
import { resolveDangerZones } from '#/bot/event/webwalk/data/dangerZones.js';
import type { LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';

const members = [
    ['seers-men', [1, 2, 3]], ['seers-women', [4, 5, 6]], ['catherby-men', [1, 2, 3]],
    ['ardougne-men', [24]], ['ardougne-cows', [81]], ['ardougne-monks', [281]],
    ['ardougne-guards', [32]], ['ardougne-goblins', [100, 101]], ['khazard-troopers', [475, 476]],
    ['yanille-men', [1, 3]], ['yanille-cows', [81]], ['yanille-soldiers', [35]], ['taverley-surface-druids', [14]]
] as const;
const starters = [
    ['rimmington-rats', [47]], ['port-sarim-goblins', [100]],
    ['draynor-goblins', [100]], ['lumbridge-west-chickens', [41]]
] as const;
const snapshot = (level = 40): LevelerSnapshot => ({
    levels: Object.fromEntries(enabledSkills.map(skill => [skill, skill === 'hitpoints' ? Math.max(10, level) : level])),
    stock: { coins: 100000, trout: 100, 'bronze arrow': 87 }, bankReady: true, quests: {}, target: 40, wilderness: true, now: 1000
});
const isolate = (id: string) => ({ ...emptyMemory(), cooldowns: Object.fromEntries(COMBAT_CAMPS.filter(camp => camp.id !== id).map(camp => [camp.id, 2000])) });

test.each([1, 10])('melee level %i starts varied death walks without fishing or cooking', level => {
    const s = snapshot(level);
    s.stock = { coins: 100000 };
    let seed = level;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const selected = new Set<string>();
    for (let i = 0; i < 200; i++) {
        const decision = planNext(s, { ...emptyMemory(), objective: 'attack' }, random);
        expect(decision.kind).toBe('activity');
        if (decision.kind !== 'activity') continue;
        expect(decision.queue.map(plan => plan.script)).toEqual(['AutoFighter']);
        expect(decision.plan.deathWalk).toBe(true);
        expect(decision.plan.label).toContain('(death walk)');
        expect(decision.plan.food).toBeUndefined();
        expect(decision.plan.settings.foodWithdraw).toBe(0);
        expect(decision.plan.settings.panicHp).toBe(0);
        selected.add(decision.plan.id);
    }
    expect(selected.size).toBeGreaterThanOrEqual(9);
    for (const [id] of starters) expect(selected.has(id), id).toBe(true);
    expect(new Set([...selected].map(id => COMBAT_CAMPS.find(camp => camp.id === id)!.region)).size).toBeGreaterThanOrEqual(6);
});

test('banked food does not become a mandatory restock requirement for death walking', () => {
    const s = snapshot(1);
    const plan = combatPlan(s, 'attack', isolate('lumbridge-chickens'), () => 0)!;
    expect(plan.deathWalk).toBe(true);
    expect(plan.needs.some(need => ['Trout', 'Shrimps'].includes(need.item))).toBe(false);
    expect(plan.settings.foodWithdraw).toBe(0);
});

test('owned melee equipment can train locally without coins and cannot select an unfunded western trip', () => {
    const s = snapshot(1);
    s.stock = { 'iron scimitar': 1, 'iron chainbody': 1, 'iron platelegs': 1 };
    const next = planNext(s, { ...emptyMemory(), objective: 'attack' }, () => 0);
    expect(next.kind).toBe('activity');
    if (next.kind === 'activity') {
        expect(next.plan.script).toBe('AutoFighter');
        expect(next.plan.needs.some(need => need.item === 'Coins')).toBe(false);
    }
    s.levels = snapshot().levels;
    expect(combatPlan(s, 'attack', isolate('seers-men'), () => 0)).toBeNull();
});

test('death walking applies only below combat 15 and never to western, dangerous or ranged camps', () => {
    const s = snapshot(20);
    expect(combatPlan(s, 'attack', isolate('lumbridge-chickens'), () => 0)?.deathWalk).not.toBe(true);
    s.levels = snapshot(1).levels;
    const early = combatPlan(s, 'attack', isolate('lumbridge-chickens'), () => 0)!;
    expect(early.deathWalk).toBe(true);
    expect(combatPlan(s, 'attack', isolate('ardougne-farmer'), () => 0)).toBeNull();
    for (const [id, objective] of [['lumbridge-chickens', 'ranged'], ['lumbridge-chickens', 'magic']] as const) {
        const plan = combatPlan(s, objective, isolate(id), () => 0)!;
        expect(plan.deathWalk).not.toBe(true);
        expect(plan.food).toBeDefined();
        expect(plan.settings.foodWithdraw).toBe(12);
    }
    s.levels.hitpoints = 30;
    expect(combatPlan(s, 'attack', isolate('taverley-druids'), () => 0)).toBeNull();
});

test('each members camp is selectable without quests and travel carries fares', () => {
    for (const [id] of members) {
        const plan = combatPlan(snapshot(), 'attack', isolate(id), () => 0);
        expect(plan?.id, id).toBe(id);
        expect(plan?.settings.target).not.toBe('Rock crab');
        if (plan) expect(plan.needs).toContainEqual({ item: 'Coins', count: 200, carry: 200 });
    }
});

test('east-side combat carries return fares after training in members regions', () => {
    const plan = combatPlan(snapshot(), 'attack', isolate('lumbridge-chickens'), () => 0)!;
    expect(plan.needs).toContainEqual({ item: 'Coins', count: 200, carry: 200 });
});

test('members camps independently require hitpoints, offence and defence', () => {
    for (const [id] of members) {
        const camp = COMBAT_CAMPS.find(camp => camp.id === id);
        expect(camp, id).toBeDefined();
        if (!camp) continue;
        for (const [skill, level] of [['hitpoints', camp.hp], ['attack', camp.offence], ['strength', camp.offence], ['defence', camp.defence]] as const) {
            const s = snapshot();
            s.levels[skill] = level - 1;
            expect(combatPlan(s, 'attack', isolate(id), () => 0), `${id}:${skill}`).toBeNull();
        }
        const fragile = snapshot(1);
        fragile.levels.attack = 40;
        expect(combatPlan(fragile, 'attack', isolate(id), () => 0), id).toBeNull();
    }
});

test('region selection prefers regions outside the production six-session history', () => {
    const s = snapshot(20);
    s.levels.hitpoints = 30;
    s.levels.prayer = 1;
    const memory = emptyMemory();
    for (let i = 0; i < 20; i++) {
        const plan = combatPlan(s, 'attack', memory, () => 0)!;
        const region = COMBAT_CAMPS.find(camp => camp.id === plan.id)!.region;
        expect(memory.recent.map(id => COMBAT_CAMPS.find(camp => camp.id === id)!.region)).not.toContain(region);
        memory.recent = [...memory.recent, plan.id].slice(-6);
    }
});

test('seeded sessions rotate stronger members and free-world camps with the production history limit', () => {
    let seed = 731;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const memory = emptyMemory();
    const visited = new Set<string>();
    for (let i = 0; i < 400; i++) {
        const plan = combatPlan(snapshot(), 'attack', memory, random)!;
        visited.add(plan.id);
        memory.recent = [...memory.recent, plan.id].slice(-6);
    }
    for (const id of ['yanille-giants', 'rimmington-hobgoblins', 'burthorpe-guards', 'edgeville-dungeon-giants']) expect(visited.has(id), id).toBe(true);
    expect(visited.has('seers-men')).toBe(false);
});

test('random selection retires starter camps while skipping recent or cooling stronger camps', () => {
    const selected = new Set<string>();
    for (let region = 0; region < 100; region++) for (let camp = 0; camp < COMBAT_CAMPS.length; camp++) {
        let calls = 0;
        selected.add(combatPlan(snapshot(), 'attack', emptyMemory(), () => calls++ === 0 ? region / 100 : camp / COMBAT_CAMPS.length)!.id);
    }
    expect(selected.size).toBeGreaterThanOrEqual(5);
    for (const id of ['lumbridge-chickens', 'seers-men', 'rimmington-rats']) expect(selected.has(id)).toBe(false);
    const memory = emptyMemory();
    memory.recent = ['yanille-giants', 'rimmington-hobgoblins', 'burthorpe-guards'];
    memory.cooldowns['edgeville-dungeon-giants'] = 2000;
    for (let i = 0; i < 100; i++) {
        const plan = combatPlan(snapshot(), 'attack', memory, () => i / 100)!;
        expect([...memory.recent, 'edgeville-dungeon-giants']).not.toContain(plan.id);
    }
});

test.each(['#199', 'Air talisman', 'Cow hide'])('region rotation keeps %s production on matching camps', resource => {
    for (let i = 0; i < 100; i++) {
        const plan = combatPlan(snapshot(), 'crafting', emptyMemory(), () => i / 100, resource)!;
        const camp = COMBAT_CAMPS.find(camp => camp.id === plan.id)!;
        expect(resource === '#199' ? camp.herbs : resource === 'Air talisman' ? camp.talisman : camp.target === 'Cow').toBe(true);
        expect(plan.output?.item).toBe(resource);
    }
});

test.each(['attack', 'ranged', 'magic'])('members %s camps keep the same exact equipment and ammunition manifest', objective => {
    const baseline = combatPlan(snapshot(), objective, isolate('lumbridge-chickens'), () => 0)!;
    for (const [id] of members) {
        const plan = combatPlan(snapshot(), objective, isolate(id), () => 0);
        expect(plan?.needs.filter(need => need.item !== 'Coins'), id).toEqual(baseline.needs.filter(need => need.item !== 'Coins'));
        expect(plan?.settings.combatStyle).toBe(baseline.settings.combatStyle);
        expect(plan?.settings.ammoWithdraw).toBe(baseline.settings.ammoWithdraw);
        expect(plan?.settings.runesWithdraw).toBe(baseline.settings.runesWithdraw);
    }
});

const content = resolve('../rs2b2t-content');
test('starter selection excludes prison cells and quest-gated guild and house targets', () => {
    expect(COMBAT_CAMPS.map(camp => camp.id)).not.toContain('port-sarim-rats');
    expect(COMBAT_CAMPS.map(camp => camp.id)).not.toContain('varrock-chickens');
    expect(COMBAT_CAMPS.map(camp => camp.id)).not.toContain('varrock-rats');
});

test.skipIf(!existsSync('out/collision.lcnav.gz')).each(starters.map(([id]) => id))('starter %s is reachable from banks without restricted doors', id => {
    const finder = new PathFinder(gunzipSync(readFileSync('out/collision.lcnav.gz')));
    loadDefaultNavEdges(finder);
    const camp = COMBAT_CAMPS.find(camp => camp.id === id)!;
    const destination = { x: camp.x, z: camp.z, level: 0 };
    for (const start of [{ x: 3092, z: 3243, level: 0 }, { x: 3013, z: 3355, level: 0 }, { x: 3208, z: 3220, level: 0 }]) {
        const route = finder.findPath(start, destination, {
            state: { ...emptyWorldStateData(), members: true, skills: { agility: 1 }, items: { Coins: 200 }, entranaRestrictedGear: true, canSlashWeb: false },
            avoidZones: resolveDangerZones(['white-wolf-mountain'], { includeAutomatic: true, combatLevel: 3, start, destination }), useTeleportCatalog: false
        });
        expect(route.ok, `${id} from ${start.x},${start.z}`).toBe(true);
        if (route.ok) for (const hop of route.hops) expect([102, 1805, 1541]).not.toContain(hop.locId);
    }
});

test.skipIf(!existsSync(`${content}/maps`))('new camps contain verified surface NPC spawns within the fighter leash', () => {
    for (const [id, npcIds] of [...members, ...starters]) {
        const camp = COMBAT_CAMPS.find(camp => camp.id === id);
        expect(camp, id).toBeDefined();
        if (!camp) continue;
        const mx = Math.floor(camp.x / 64), mz = Math.floor(camp.z / 64);
        const section = readFileSync(`${content}/maps/m${mx}_${mz}.jm2`, 'utf8').split('==== NPC ====')[1].split('====')[0];
        const spawns = [...section.matchAll(/^(\d+) (\d+) (\d+): (\d+)$/gm)];
        expect(spawns.some(match => Number(match[1]) === 0 && npcIds.some(npcId => npcId === Number(match[4]))
            && Math.max(Math.abs(mx * 64 + Number(match[2]) - camp.x), Math.abs(mz * 64 + Number(match[3]) - camp.z)) <= 12), id).toBe(true);
    }
});

test.skipIf(!existsSync(`${content}/maps`) || !existsSync('out/collision.lcnav.gz'))('new camps can reach nearby target spawns without locked rooms or long detours', () => {
    const finder = new PathFinder(gunzipSync(readFileSync('out/collision.lcnav.gz')));
    loadDefaultNavEdges(finder);
    for (const [id, npcIds] of [...members, ...starters]) {
        const camp = COMBAT_CAMPS.find(camp => camp.id === id)!;
        const start = { x: camp.x, z: camp.z, level: 0 };
        for (let mx = Math.floor((camp.x - 12) / 64); mx <= Math.floor((camp.x + 12) / 64); mx++) {
            for (let mz = Math.floor((camp.z - 12) / 64); mz <= Math.floor((camp.z + 12) / 64); mz++) {
                const section = readFileSync(`${content}/maps/m${mx}_${mz}.jm2`, 'utf8').split('==== NPC ====')[1].split('====')[0];
                for (const match of section.matchAll(/^(\d+) (\d+) (\d+): (\d+)$/gm)) {
                    const destination = { x: mx * 64 + Number(match[2]), z: mz * 64 + Number(match[3]), level: Number(match[1]) };
                    if (destination.level !== 0 || !npcIds.some(npcId => npcId === Number(match[4]))
                        || Math.max(Math.abs(destination.x - camp.x), Math.abs(destination.z - camp.z)) > 12) continue;
                    const route = finder.findPath(start, destination, {
                        state: { ...emptyWorldStateData(), members: true, skills: { agility: 1 }, entranaRestrictedGear: true, canSlashWeb: false },
                        avoidZones: resolveDangerZones(['white-wolf-mountain'], { includeAutomatic: true, combatLevel: 3, start, destination }), useTeleportCatalog: false
                    });
                    expect(route.ok, `${id} target ${destination.x},${destination.z}`).toBe(true);
                    if (route.ok) {
                        expect(route.cost, `${id} target ${destination.x},${destination.z}`).toBeLessThanOrEqual(64);
                        for (const hop of route.hops) expect([102, 1805, 1541]).not.toContain(hop.locId);
                    }
                }
            }
        }
    }
}, 20000);

test.skipIf(!existsSync('out/collision.lcnav.gz'))('members camps route around danger zones without restricted doors or unlocks', () => {
    const finder = new PathFinder(gunzipSync(readFileSync('out/collision.lcnav.gz')));
    loadDefaultNavEdges(finder);
    for (const [id] of members) {
        const camp = COMBAT_CAMPS.find(camp => camp.id === id);
        expect(camp, id).toBeDefined();
        if (!camp) continue;
        const start = { x: 3092, z: 3243, level: 0 }, destination = { x: camp.x, z: camp.z, level: 0 };
        const route = finder.findPath(start, destination, {
            state: { ...emptyWorldStateData(), members: true, skills: { agility: 1 }, items: { Coins: 200 }, entranaRestrictedGear: true, canSlashWeb: false },
            avoidZones: resolveDangerZones(['white-wolf-mountain'], { includeAutomatic: true, combatLevel: 3, start, destination }), useTeleportCatalog: false
        });
        expect(route.ok, id).toBe(true);
        if (route.ok) for (const hop of route.hops) expect([102, 1805, 1541]).not.toContain(hop.locId);
        if (route.ok && ['seers', 'catherby'].includes(camp.region)) expect(route.hops.some(hop => hop.kind === 'ship')).toBe(true);
    }
}, 20000);
