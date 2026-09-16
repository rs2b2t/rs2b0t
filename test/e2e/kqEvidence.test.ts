import { expect, test } from 'bun:test';
import { KqEvidence, chamber, count, type KqSample } from '../../e2e/lib/kqEvidence.js';

function team(at = 1000): KqSample[] {
    return [0, 1, 2, 3].map(i => ({
        at, tile: { x: 3308, z: 3120, level: 0 }, hp: 99, sceneReady: true,
        pack: [[861, 1], ...(i === 0 ? [[954, 2]] : []), [2434, 2], [2448, 1], [2436, 1], [2440, 1], [2442, 1], [2550, 1], [2552, 1], [1854, 1], [556, 5], [563, 1], [385, i === 0 ? 14 : 16]].map(([id, count]) => ({ id, count })),
        gear: [1434, 1163, 2503, 2497, 2491, 1731, 1061, 2550, 892].map(id => ({ id, count: id === 892 ? 250 : 1 })),
        bank: [], bankOpen: false, restocking: false, mode: 1, protectMagic: true, xp: { melee: 1000, ranged: 1000 }, queens: [], ground: []
    }));
}

function fight(e: KqEvidence, samples: KqSample[], id: number, hp: number): void {
    if (samples.some(s => !chamber(s))) {
        samples.forEach(s => { s.tile = { x: 3226, z: 3108, level: 0 }; s.ropes = [3828]; }); e.observe(samples);
        samples.forEach(s => { s.tile = { x: 3508, z: 9497, level: 2 }; s.ropes = [3831]; }); e.observe(samples);
    }
    samples.forEach((s, i) => {
        s.at += 1000;
        s.ropes = [];
        const radius = id === 1158 ? 3 : 6;
        s.tile = { x: 3476 + [-1, 1, 0, 0][i] * radius, z: 9498 + [0, 0, 1, -1][i] * radius, level: 0 };
        s.queens = [{ id, hp, total: 255, tile: { x: 3476, z: 9498, level: 0 } }];
        s.gear[0].id = id === 1158 ? 1434 : 861;
    });
}

function melee(e: KqEvidence, s: KqSample[]): void {
    e.observe(s);
    fight(e, s, 1158, 255); e.observe(s);
    fight(e, s, 1158, 120); s.forEach(p => p.xp.melee += 50); e.observe(s);
    fight(e, s, 1158, 0); e.observe(s);
}

function kill(e: KqEvidence, s: KqSample[]): void {
    melee(e, s);
    fight(e, s, 1160, 255); e.observe(s);
    fight(e, s, 1160, 100); s.forEach(p => p.xp.ranged += 50); e.observe(s);
    fight(e, s, 1160, 0); e.observe(s);
    s.forEach(p => { p.at += 1000; p.queens = []; }); e.observe(s);
}

function attack(s: KqSample, at = s.at): void {
    s.actions = [{ kind: 'attack', tick: at, at, food: count(s.pack, 385), hp: s.hp, xp: s.xp.melee + s.xp.ranged }];
}

function finishWithoutFourth(e: KqEvidence, s: KqSample[]): void {
    for (const [id, hp] of [[1158, 0], [1160, 255], [1160, 0]]) {
        s.forEach((p, i) => {
            p.at += 1000;
            p.queens = chamber(p) ? [{ id, hp, total: 255, tile: { x: 3476, z: 9498, level: 0 } }] : [];
            if (i < 3 && hp === 0) p.xp[id === 1158 ? 'melee' : 'ranged'] += 50;
        }); e.observe(s);
    }
    s.forEach(p => { p.at += 1000; p.queens = []; }); e.observe(s);
    s.forEach(p => { p.tile = { x: 3308, z: 3120, level: 0 }; });
}

test('a kit missing a charged ring or arrows cannot satisfy readiness', () => {
    const e = new KqEvidence(); const s = team();
    s[3].pack = s[3].pack.filter(p => p.id !== 2552);
    e.observe(s); expect(e.milestones.sharedKit).toBeUndefined();
    s[3] = team()[3]; s[3].gear.find(g => g.id === 892)!.count = 0;
    e.observe(s); expect(e.milestones.sharedKit).toBeUndefined();
    s[3] = team()[3]; e.observe(s); expect(e.milestones.sharedKit).toBe(1000);
});

test('inherited zero HP on the flying form is not a kill', () => {
    const e = new KqEvidence(); const s = team(); melee(e, s);
    fight(e, s, 1160, 0); e.observe(s);
    s.forEach(p => { p.at += 1000; p.queens = []; }); e.observe(s);
    expect(e.milestones.killed).toBeUndefined();
});

test('both forms must take damage and flying death must precede disappearance', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    expect(e.milestones.formation).toBeGreaterThan(0);
    expect(e.milestones.ranged).toBeGreaterThan(e.milestones.formation);
    expect(e.milestones.killed).toBeGreaterThan(e.milestones.ranged);
});

test('a flying queen disappearing alive is not a kill', () => {
    const e = new KqEvidence(); const s = team(); melee(e, s);
    fight(e, s, 1160, 255); e.observe(s);
    fight(e, s, 1160, 100); s.forEach(p => p.xp.ranged += 50); e.observe(s);
    s.forEach(p => { p.at += 1000; p.queens = []; }); e.observe(s);
    expect(e.milestones.killed).toBeUndefined();
});

test('recovered player arrows do not satisfy boss loot', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    s[0].ground = [{ id: 892, name: 'Rune arrow', count: 3, tile: { x: 3474, z: 9496, level: 0 } }]; e.observe(s);
    s[0].ground = []; s[0].pack.push({ id: 892, count: 3 }); e.observe(s);
    expect(e.milestones.looted).toBeUndefined();
});

test('boss loot needs a ground stack, inventory gain and bank deposit', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    s[0].ground = [{ id: 1621, name: 'Uncut emerald', count: 1, tile: { x: 3474, z: 9496, level: 0 } }]; e.observe(s);
    expect(e.milestones.looted).toBeUndefined();
    s[0].ground = []; s[0].pack.push({ id: 1621, count: 1 }); e.observe(s);
    expect(e.milestones.looted).toBeGreaterThan(0);
    expect(e.milestones.bankedLoot).toBeUndefined();
    s[0].tile = { x: 3308, z: 3120, level: 0 }; s[0].bankOpen = true;
    s[0].pack = s[0].pack.filter(p => p.id !== 1621); s[0].bank.push({ id: 1621, count: 1 }); e.observe(s);
    expect(e.milestones.bankedLoot).toBeGreaterThan(0);
});

test('a boss stack of 100 rune arrows is accepted', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    s[0].ground = [{ id: 892, name: 'Rune arrow', count: 100, tile: { x: 3474, z: 9496, level: 0 } }]; e.observe(s);
    s[0].ground = []; s[0].pack.push({ id: 892, count: 100 }); e.observe(s);
    expect(e.milestones.looted).toBeGreaterThan(0);
});

test('missing ranged participation is reported separately from an observed kill', () => {
    const e = new KqEvidence(); const s = team(); melee(e, s);
    fight(e, s, 1160, 255); e.observe(s);
    fight(e, s, 1160, 100); s.slice(0, 3).forEach(p => p.xp.ranged += 50); e.observe(s);
    fight(e, s, 1160, 0); e.observe(s);
    s.forEach(p => { p.at += 1000; p.queens = []; }); e.observe(s);
    expect(e.kills).toHaveLength(1);
    expect(e.milestones.participation).toBeUndefined();
});

test('physical crossings more than three seconds apart fail', () => {
    const e = new KqEvidence(); const s = team();
    s.forEach(p => { p.tile = { x: 3226, z: 3108, level: 0 }; }); e.observe(s);
    s.slice(0, 3).forEach(p => { p.at = 2000; p.tile = { x: 3480, z: 9500, level: 2 }; }); e.observe(s);
    s[3].at = 6001; s[3].tile = { x: 3480, z: 9500, level: 2 };
    expect(() => e.observe(s)).toThrow('surface entry 1 exceeded three seconds');
});

test('existing ropes allow synchronized crossings without consumption', () => {
    const e = new KqEvidence(); const s = team();
    s.forEach(p => { p.tile = { x: 3226, z: 3108, level: 0 }; }); e.observe(s);
    s.forEach(p => { p.at = 2000; p.tile = { x: 3508, z: 9497, level: 2 }; }); e.observe(s);
    s.forEach(p => { p.at = 3000; p.tile = { x: 3508, z: 9493, level: 0 }; }); e.observe(s);
    expect(e.milestones.ropes).toBe(3000);
    expect(e.milestones.entered).toBe(3000);
});

test('another team can place both ropes after this team observes bare entrances', () => {
    const e = new KqEvidence(); const s = team();
    s.forEach(p => { p.tile = { x: 3226, z: 3108, level: 0 }; p.ropes = [3827]; }); e.observe(s);
    s.forEach(p => { p.at += 200; p.ropes = [3828]; }); e.observe(s);
    s.forEach(p => { p.at = 2000; p.tile = { x: 3508, z: 9497, level: 2 }; p.ropes = [3830]; }); e.observe(s);
    s.forEach(p => { p.at += 200; p.ropes = [3831]; }); e.observe(s);
    s.forEach(p => { p.at = 3000; p.tile = { x: 3508, z: 9493, level: 0 }; p.ropes = []; });
    expect(() => e.observe(s)).not.toThrow();
    expect(e.sharedRopes).toEqual(['surface', 'chamber']);
    expect(e.ropeCounts.surface).toEqual([2, 0, 0, 0]);
    expect(e.ropeCounts.chamber).toEqual([2, 0, 0, 0]);
    expect(e.milestones.ropes).toBe(3000);
});

test('the leader can place the first rope and reuse another team\'s second rope', () => {
    const e = new KqEvidence(); const s = team();
    s.forEach(p => { p.tile = { x: 3226, z: 3108, level: 0 }; p.ropes = [3827]; }); e.observe(s);
    s[0].pack.find(p => p.id === 954)!.count = 1;
    s.forEach(p => { p.at = 2000; p.tile = { x: 3508, z: 9497, level: 2 }; p.ropes = [3830]; }); e.observe(s);
    s.forEach(p => { p.at += 200; p.ropes = [3831]; }); e.observe(s);
    s.forEach(p => { p.at = 3000; p.tile = { x: 3508, z: 9493, level: 0 }; p.ropes = []; });
    expect(() => e.observe(s)).not.toThrow();
    expect(e.sharedRopes).toEqual(['chamber']);
    expect(e.ropeCounts.chamber).toEqual([1, 0, 0, 0]);
});

test('unconsumed ropes require an observed usable entrance after a bare entrance', () => {
    const e = new KqEvidence(); const s = team();
    s.forEach(p => { p.tile = { x: 3226, z: 3108, level: 0 }; p.ropes = [3827]; }); e.observe(s);
    s.forEach(p => { p.at = 2000; p.tile = { x: 3508, z: 9497, level: 2 }; p.ropes = [3830]; }); e.observe(s);
    s.forEach(p => { p.at = 3000; p.tile = { x: 3508, z: 9493, level: 0 }; p.ropes = []; });
    expect(() => e.observe(s)).toThrow('Unexpected rope consumption');
});

test('a usable rope clicked between samples proves shared reuse on physical arrival', () => {
    const e = new KqEvidence(); const s = team(); e.observe(s);
    s.forEach(p => { p.tile = { x: 3226, z: 3108, level: 0 }; p.ropes = [3827]; }); e.observe(s);
    s[0].ropeClicks = [{ id: 3828, at: 1500, tile: { ...s[0].tile! } }];
    s.forEach(p => { p.at = 2000; p.tile = { x: 3508, z: 9497, level: 2 }; p.ropes = [3830]; }); e.observe(s);
    s[0].ropeClicks.push({ id: 3831, at: 2500, tile: { ...s[0].tile! } });
    s.forEach(p => { p.at = 3000; p.tile = { x: 3508, z: 9493, level: 0 }; p.ropes = []; }); e.observe(s);
    expect(e.sharedRopes).toEqual(['surface', 'chamber']);
    expect(e.milestones.ropes).toBeDefined();
});

for (const later of [false, true]) test(`a second surface rope is rejected before descent on ${later ? 'a later' : 'the first'} departure`, () => {
    const e = new KqEvidence(); let s = team(); e.observe(s);
    if (later) {
        s.forEach(p => { p.tile = { x: 3226, z: 3108, level: 0 }; p.ropes = [3828]; }); e.observe(s);
        s.forEach(p => { p.at = 2000; p.tile = { x: 3508, z: 9497, level: 2 }; p.ropes = [3831]; }); e.observe(s);
        s.forEach(p => { p.at = 3000; p.tile = { x: 3508, z: 9493, level: 0 }; p.ropes = []; }); e.observe(s);
        s = team(4000); e.observe(s);
    }
    s.forEach(p => { p.at += 1000; p.tile = { x: 3226, z: 3108, level: 0 }; p.ropes = [3827]; });
    s[3].tile = { x: 2890, z: 4558, level: 0 }; e.observe(s);
    s[0].pack.find(p => p.id === 954)!.count = 1;
    s.forEach(p => { p.at += 200; p.ropes = [3828]; }); e.observe(s);
    s.forEach(p => { p.at += 40_000; p.ropes = [3827]; }); e.observe(s);
    s[0].pack.find(p => p.id === 954)!.count = 0;
    s.forEach(p => { p.at += 200; p.ropes = [3828]; });
    expect(() => e.observe(s)).toThrow('Unexpected rope consumption');
    expect(e.crossings.surface[0]).toHaveLength(later ? 1 : 0);
});

test('rope consumption is independently validated on each prepared departure', () => {
    const e = new KqEvidence();
    for (const [n, surface, lower] of [[0, 1, 1], [1, 0, 0], [2, 1, 0], [3, 0, 1]]) {
        const s = team(n * 10_000 + 1000); e.observe(s);
        s.forEach(p => { p.at += 1000; p.tile = { x: 3226, z: 3108, level: 0 }; p.ropes = [surface ? 3827 : 3828]; }); e.observe(s);
        s[0].pack.find(p => p.id === 954)!.count -= surface;
        s.forEach(p => { p.at += 1000; p.tile = { x: 3508, z: 9497, level: 2 }; p.ropes = [lower ? 3830 : 3831]; }); e.observe(s);
        s[0].pack.find(p => p.id === 954)!.count -= lower;
        s.forEach(p => { p.at += 1000; p.tile = { x: 3508, z: 9493, level: 0 }; p.ropes = []; }); e.observe(s);
    }
    expect(e.ropeAttempts.map(a => a.consumed)).toEqual([{ surface: 1, chamber: 1 }, { surface: 0, chamber: 0 }, { surface: 1, chamber: 0 }, { surface: 0, chamber: 1 }]);
    expect(e.ropeAttempts.map(a => a.shared)).toEqual([[], ['surface', 'chamber'], ['chamber'], ['surface']]);
});

test('a loading sample and a random-event absence do not reset the surface rope budget', () => {
    const e = new KqEvidence(); const s = team(); e.observe(s);
    s.forEach(p => { p.tile = { x: 3226, z: 3108, level: 0 }; p.ropes = [3827]; }); e.observe(s);
    s[0].pack.find(p => p.id === 954)!.count = 1; e.observe(s);
    s[0].sceneReady = false; s[0].pack = []; e.observe(s);
    s[0].sceneReady = true; s[0].pack = [{ id: 954, count: 1 }];
    s[0].tile = { x: 2008, z: 4764, level: 0 }; e.observe(s);
    s[0].at += 40_000; s[0].tile = { x: 3226, z: 3108, level: 0 }; e.observe(s);
    s[0].pack = []; expect(() => e.observe(s)).toThrow('Unexpected rope consumption');
});

test('a later departure cannot reuse an old shared-rope observation', () => {
    const e = new KqEvidence(); let s = team(); e.observe(s);
    s.forEach(p => { p.tile = { x: 3226, z: 3108, level: 0 }; p.ropes = [3828]; }); e.observe(s);
    s.forEach(p => { p.at += 1000; p.tile = { x: 3508, z: 9497, level: 2 }; p.ropes = [3831]; }); e.observe(s);
    s.forEach(p => { p.at += 1000; p.tile = { x: 3508, z: 9493, level: 0 }; p.ropes = []; }); e.observe(s);
    s = team(10_000); e.observe(s);
    s.forEach(p => { p.at += 1000; p.tile = { x: 3226, z: 3108, level: 0 }; p.ropes = [3827]; }); e.observe(s);
    s[0].ropeClicks = [{ id: 3828, at: 2000, tile: { ...s[0].tile! } }];
    s.forEach(p => { p.at += 1000; p.tile = { x: 3508, z: 9497, level: 2 }; p.ropes = [3830]; });
    expect(() => e.observe(s)).toThrow('unverified shared surface rope');
});

test('shared entrances do not permit a follower to carry ropes', () => {
    const e = new KqEvidence(); const s = team();
    s[1].pack.push({ id: 954, count: 1 });
    s.forEach(p => { p.tile = { x: 3226, z: 3108, level: 0 }; p.ropes = [3828]; }); e.observe(s);
    s.forEach(p => { p.at = 2000; p.tile = { x: 3508, z: 9497, level: 2 }; p.ropes = [3831]; }); e.observe(s);
    s.forEach(p => { p.at = 3000; p.tile = { x: 3508, z: 9493, level: 0 }; p.ropes = []; });
    expect(() => e.observe(s)).toThrow('Unexpected rope consumption');
});

test('returning from a random event does not count as another chamber descent', () => {
    const e = new KqEvidence(); const s = team(); e.observe(s);
    s.forEach(p => { p.at = 2000; p.tile = { x: 3508, z: 9497, level: 2 }; p.ropes = [3831]; }); e.observe(s);
    s.forEach(p => { p.at = 3000; p.tile = { x: 3508, z: 9493, level: 0 }; }); e.observe(s);
    s[0].at = 4000; s[0].tile = { x: 2008, z: 4764, level: 0 }; e.observe(s);
    s[0].at = 30000; s[0].tile = { x: 3473, z: 9498, level: 0 }; e.observe(s);
    expect(e.crossings.chamber.map(c => c.length)).toEqual([1, 1, 1, 1]);
    s.forEach(p => { p.at = 31000; p.tile = { x: 3308, z: 3120, level: 0 }; }); e.observe(s);
    s.forEach(p => { p.at = 32000; p.tile = { x: 3508, z: 9497, level: 2 }; }); e.observe(s);
    s.forEach(p => { p.at = 33000; p.tile = { x: 3508, z: 9493, level: 0 }; });
    expect(() => e.observe(s)).not.toThrow();
    expect(e.crossings.chamber.map(c => c.length)).toEqual([2, 2, 2, 2]);
    expect(e.milestones.ropes).toBeUndefined();
});

test('returning from a random event in the upper cave is not a surface rope descent', () => {
    const e = new KqEvidence(); const s = team();
    s.forEach(p => { p.tile = { x: 3226, z: 3108, level: 0 }; }); e.observe(s);
    s.forEach(p => { p.at = 2000; p.tile = { x: 3480, z: 9500, level: 2 }; }); e.observe(s);
    s[0].at = 4000; s[0].tile = { x: 2008, z: 4764, level: 0 }; e.observe(s);
    s[0].at = 30000; s[0].tile = { x: 3480, z: 9500, level: 2 }; e.observe(s);
    expect(e.crossings.surface.map(c => c.length)).toEqual([1, 1, 1, 1]);
});

test('noted loot is verified under its unnoted bank item', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    s[0].ground = [{ id: 246, name: 'Wine of zamorak', bankId: 245, count: 20, tile: { x: 3474, z: 9496, level: 0 } }]; e.observe(s);
    s[0].ground = []; s[0].pack.push({ id: 246, count: 20 }); e.observe(s);
    s[0].tile = { x: 3308, z: 3120, level: 0 }; s[0].bankOpen = true;
    s[0].pack = s[0].pack.filter(p => p.id !== 246); s[0].bank.push({ id: 245, count: 20 }); e.observe(s);
    expect(e.milestones.bankedLoot).toBeGreaterThan(0);
});

test('a dropped vial cannot become boss loot through later potion use', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    s[0].ground = [{ id: 229, name: 'Vial', count: 1, tile: { x: 3474, z: 9496, level: 0 } }]; e.observe(s);
    s[0].ground = []; s[0].pack.push({ id: 229, count: 1 }); e.observe(s);
    expect(e.milestones.looted).toBeUndefined();
});

test('a later trip compares banked rune loot with its own supply baseline', () => {
    const e = new KqEvidence(); const s = team();
    s[0].bankOpen = true; s[0].bank = [{ id: 563, count: 98 }]; e.observe(s);
    s[0].bank = [{ id: 563, count: 78 }]; e.observe(s);
    s[0].bankOpen = false; kill(e, s);
    s[0].ground = [{ id: 563, name: 'Law rune', count: 20, tile: { x: 3474, z: 9496, level: 0 } }]; e.observe(s);
    s[0].ground = []; s[0].pack.push({ id: 563, count: 20 }); e.observe(s);
    s[0].tile = { x: 3308, z: 3120, level: 0 }; s[0].bankOpen = true;
    s[0].pack = s[0].pack.filter(p => p.id !== 563); s[0].bank = [{ id: 563, count: 99 }]; e.observe(s);
    expect(e.milestones.bankedLoot).toBeGreaterThan(0);
});

test('a bought pass is not ready until the change is banked and the last shark is withdrawn', () => {
    const e = new KqEvidence(); const s = team();
    s[0].bankOpen = true; s[0].bank = [{ id: 995, count: 9900 }];
    s[0].pack = s[0].pack.filter(p => p.id !== 1854);
    s[0].pack.find(p => p.id === 385)!.count = 13;
    s[0].pack.push({ id: 995, count: 100 }); e.observe(s);
    s[0].bankOpen = false; s[0].pack.push({ id: 1854, count: 1 });
    s[0].pack.find(p => p.id === 995)!.count = 95; e.observe(s);
    expect(e.milestones.sharedKit).toBeUndefined();
    expect(e.milestones.buyPass).toBeUndefined();
    s[0].bankOpen = true; s[0].bank = [{ id: 995, count: 9995 }];
    s[0].pack = s[0].pack.filter(p => p.id !== 995);
    s[0].pack.find(p => p.id === 385)!.count = 14; e.observe(s);
    expect(e.milestones.buyPass).toBe(1000);
    expect(e.milestones.sharedKit).toBe(1000);
});

test('an existing bank pass is withdrawn without taking coins', () => {
    const e = new KqEvidence(); const s = team();
    s[0].bankOpen = true; s[0].bank = [{ id: 1854, count: 3 }];
    s[0].pack = s[0].pack.filter(p => p.id !== 1854); e.observe(s);
    s[0].bank = [{ id: 1854, count: 2 }]; s[0].pack.push({ id: 1854, count: 1 }); e.observe(s);
    expect(e.milestones.bankPass).toBe(1000);
    expect(e.milestones.sharedKit).toBe(1000);
});

test('the repeat-fight check requires damage to a respawn before leaving the chamber', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    fight(e, s, 1158, 255); e.observe(s);
    expect(e.milestones.repeatFight).toBeUndefined();
    fight(e, s, 1158, 200); attack(s[0]); s[0].xp.melee += 40; e.observe(s);
    expect(e.milestones.repeatFight).toBeGreaterThan(e.milestones.killed);
});

test('banking between queens cannot satisfy the repeat-fight check', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    s.forEach(p => { p.at += 1000; p.tile = { x: 3308, z: 3120, level: 0 }; }); e.observe(s);
    fight(e, s, 1158, 255); e.observe(s);
    fight(e, s, 1158, 200); e.observe(s);
    expect(e.milestones.repeatFight).toBeUndefined();
});

test('a prepared kit must not retain a waterskin from an earlier run', () => {
    const e = new KqEvidence(); const s = team();
    s[0].pack.push({ id: 1823, name: 'Waterskin(4)', count: 1 });
    e.observe(s); expect(e.milestones.sharedKit).toBeUndefined();
    s[0].pack = s[0].pack.filter(i => i.id !== 1823);
    e.observe(s); expect(e.milestones.sharedKit).toBe(1000);
});

test('a completed trip is recorded once after all four return to Shantay', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    s.forEach(p => { p.at += 1000; p.tile = { x: 3308, z: 3120, level: 0 }; });
    e.observe(s); e.observe(s);
    expect(e.trips).toHaveLength(1);
    expect(e.trips[0].kills).toBe(1);
    fight(e, s, 1158, 255); e.observe(s);
    s.forEach(p => { p.at += 1000; p.tile = { x: 3308, z: 3120, level: 0 }; }); e.observe(s);
    expect(e.trips).toHaveLength(2);
    expect(e.trips[1].kills).toBe(0);
});

test('a trip stays open until the last member returns and retains each players XP', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    s.slice(0, 3).forEach(p => { p.at += 1000; p.tile = { x: 3308, z: 3120, level: 0 }; }); e.observe(s);
    expect(e.trips).toHaveLength(0);
    s[3].tile = { x: 3308, z: 3120, level: 0 }; e.observe(s);
    expect(e.trips[0].xpGains).toEqual(s.map(() => ({ melee: 50, ranged: 50 })));
});

test('a member cannot stay passive on later completed trips with kills', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    s.forEach(p => { p.tile = { x: 3308, z: 3120, level: 0 }; }); e.observe(s);
    const before = { ...s[3].xp };
    kill(e, s); s[3].xp = before;
    s.forEach(p => { p.tile = { x: 3308, z: 3120, level: 0 }; });
    expect(() => e.observe(s)).toThrow('did not contribute combat XP on trip 2');
});

test('a later trip can finish a flying queen left by the previous retreat', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    melee(e, s); fight(e, s, 1160, 200); e.observe(s);
    s.forEach(p => { p.tile = { x: 3308, z: 3120, level: 0 }; }); e.observe(s);
    fight(e, s, 1160, 200); e.observe(s);
    fight(e, s, 1160, 100); s.forEach(p => { p.xp.ranged += 50; }); e.observe(s);
    fight(e, s, 1160, 0); e.observe(s);
    s.forEach(p => { p.queens = []; }); e.observe(s);
    s.forEach(p => { p.tile = { x: 3308, z: 3120, level: 0 }; });
    expect(() => e.observe(s)).not.toThrow();
    expect(e.trips[1].kills).toBe(1);
    expect(e.trips[1].xpGains.every(xp => xp.melee === 0 && xp.ranged > 0)).toBe(true);
});

test('super-potion proof needs a consumed dose and boosted stats on every client', () => {
    const e = new KqEvidence(); const s = team(); e.observe(s);
    s.forEach(p => {
        p.tile = { x: 3508, z: 9497, level: 2 };
        p.boosts = { attack: { base: 99, effective: 118 }, strength: { base: 99, effective: 118 }, defence: { base: 99, effective: 118 } };
    });
    e.observe(s); expect(e.milestones.boosts).toBeUndefined();
    s.forEach(p => p.pack.forEach(item => { item.id = ({ 2436: 145, 2440: 157, 2442: 163 } as Record<number, number>)[item.id] ?? item.id; }));
    s[3].boosts!.defence.effective = 99;
    e.observe(s); expect(e.milestones.boosts).toBeUndefined();
    s[3].boosts!.defence.effective = 118;
    e.observe(s); expect(e.milestones.boosts).toBeGreaterThan(0);
});

test('escape requires consumed Camelot runes followed by a charged ring even when inventory updates first', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    s.forEach(p => { p.pack = p.pack.filter(i => i.id !== 556 && i.id !== 563); }); e.observe(s);
    s.forEach(p => { p.tile = { x: 2757, z: 3478, level: 0 }; p.queens = []; }); e.observe(s);
    expect(e.milestones.escape).toBeUndefined();
    s.forEach(p => { p.pack.find(i => i.id === 2552)!.id = 2554; }); e.observe(s);
    s.forEach(p => { p.tile = { x: 3315, z: 3235, level: 0 }; }); e.observe(s);
    expect(e.milestones.escape).toBeGreaterThan(0);
});

test('a ring escape directly from the nest cannot satisfy the Camelot route', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    s.forEach(p => { p.pack.find(i => i.id === 2552)!.id = 2554; p.tile = { x: 3315, z: 3235, level: 0 }; p.queens = []; }); e.observe(s);
    expect(e.milestones.escape).toBeUndefined();
});

test('visiting Camelot without consuming both rune types cannot satisfy escape', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    s.forEach(p => { p.pack = p.pack.filter(i => i.id !== 556); p.tile = { x: 2757, z: 3478, level: 0 }; p.queens = []; }); e.observe(s);
    s.forEach(p => { p.pack.find(i => i.id === 2552)!.id = 2554; p.tile = { x: 3315, z: 3235, level: 0 }; }); e.observe(s);
    expect(e.milestones.escape).toBeUndefined();
});

test('Camelot must be observed before the arena ring charge is consumed', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    s.forEach(p => {
        p.pack = p.pack.filter(i => i.id !== 556 && i.id !== 563);
        p.pack.find(i => i.id === 2552)!.id = 2554;
        p.tile = { x: 2757, z: 3478, level: 0 }; p.queens = [];
    }); e.observe(s);
    s.forEach(p => { p.tile = { x: 3315, z: 3235, level: 0 }; }); e.observe(s);
    expect(e.milestones.escape).toBeUndefined();
});

test('an unverified earlier escape cannot contaminate a later trips ring baseline', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    s.forEach(p => { p.pack.find(i => i.id === 2552)!.id = 2554; p.tile = { x: 3315, z: 3235, level: 0 }; p.queens = []; }); e.observe(s);
    s.forEach(p => { p.tile = { x: 3308, z: 3120, level: 0 }; }); e.observe(s);
    fight(e, s, 1158, 255); e.observe(s);
    s.forEach(p => { p.pack = p.pack.filter(i => i.id !== 556 && i.id !== 563); p.tile = { x: 2757, z: 3478, level: 0 }; p.queens = []; }); e.observe(s);
    s.forEach(p => { p.pack.find(i => i.id === 2554)!.id = 2556; p.tile = { x: 3315, z: 3235, level: 0 }; }); e.observe(s);
    expect(e.milestones.escape).toBeGreaterThan(0);
});

test('walking to the arena without consuming a charge is not an escape', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    s.forEach(p => { p.tile = { x: 3315, z: 3235, level: 0 }; }); e.observe(s);
    expect(e.milestones.escape).toBeUndefined();
});


test('ranged cross can adjust around rocks while preserving cardinal arms and splash separation', () => {
    const e = new KqEvidence(); const s = team(); melee(e, s);
    fight(e, s, 1160, 255);
    s[1].tile!.x--;
    e.observe(s);
    expect(e.milestones.ranged).toBeGreaterThan(0);
});

test('adjacent cross arms within five tiles do not satisfy ranged spacing', () => {
    const e = new KqEvidence(); const s = team(); melee(e, s);
    fight(e, s, 1160, 255);
    s[1].tile!.x--; s[2].tile!.z--;
    e.observe(s);
    expect(e.milestones.ranged).toBeUndefined();
});

test('corner wait requires all four near the spawn with maces and every prayer off', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    s.forEach(p => { p.tile = { x: 3470, z: 9503, level: 0 }; p.prayers = []; p.protectMagic = false; p.gear[0].id = 1434; });
    s[3].tile!.x++;
    e.observe(s); expect(e.milestones.corner).toBeUndefined();
    s[3].tile!.x--; s[3].prayers = [93];
    e.observe(s); expect(e.milestones.corner).toBeUndefined();
    s[3].prayers = []; s[3].gear[0].id = 861;
    e.observe(s); expect(e.milestones.corner).toBeUndefined();
    s[3].gear[0].id = 1434;
    e.observe(s); expect(e.milestones.corner).toBeGreaterThan(0);
});

test('a phase can lose its remaining health between two samples', () => {
    const e = new KqEvidence(); const s = team(); e.observe(s);
    fight(e, s, 1158, 255); e.observe(s);
    fight(e, s, 1158, 0); s.forEach(p => p.xp.melee += 50); e.observe(s);
    fight(e, s, 1160, 255); e.observe(s);
    fight(e, s, 1160, 0); s.forEach(p => p.xp.ranged += 50); e.observe(s);
    s.forEach(p => { p.queens = []; }); e.observe(s);
    expect(e.kills).toHaveLength(1);
    expect(e.milestones.participation).toBeGreaterThan(0);
});


test('an initial flying queen death counts without claiming both-form evidence', () => {
    const e = new KqEvidence(); const s = team(); e.observe(s);
    fight(e, s, 1160, 100); e.observe(s);
    fight(e, s, 1160, 50); s.forEach(p => p.xp.ranged += 50); e.observe(s);
    fight(e, s, 1160, 0); e.observe(s);
    s.forEach(p => { p.queens = []; }); e.observe(s);
    expect(e.kills).toHaveLength(1);
    expect(e.milestones.killed).toBeUndefined();
    expect(e.milestones.participation).toBeUndefined();
});


test('a respawn left undamaged for six seconds fails the restart check', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    fight(e, s, 1158, 255); e.observe(s);
    s.forEach(p => { p.at += 6001; });
    expect(() => e.observe(s)).toThrow('did not re-engage within six seconds');
});

test('restart evidence records latency from first visible respawn to damage', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    fight(e, s, 1158, 255); e.observe(s);
    fight(e, s, 1158, 200); attack(s[0]); s[0].xp.melee += 40; e.observe(s);
    expect(e.restarts).toHaveLength(1);
    expect(e.restarts[0].damagedAt - e.restarts[0].spawnedAt).toBe(1000);
});

test('damage from another team cannot prove this roster restarted combat', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    fight(e, s, 1158, 255); e.observe(s);
    fight(e, s, 1158, 200); e.observe(s);
    expect(e.milestones.repeatFight).toBeUndefined();
    s.forEach(p => { p.at += 6000; });
    expect(() => e.observe(s)).toThrow('did not re-engage within six seconds');
});

test('our first hit already present in the first respawn sample proves immediate re-engagement', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    fight(e, s, 1158, 230); attack(s[0], s[0].at - 100); s[0].xp.melee += 40; e.observe(s);
    expect(e.restarts).toHaveLength(1);
    s.forEach(p => { p.at += 6001; });
    expect(() => e.observe(s)).not.toThrow();
});

test('a timely own attack can be confirmed by a hit after the six-second deadline', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    fight(e, s, 1158, 255); e.observe(s);
    const spawnedAt = s[0].at;
    s.forEach(p => { p.at += 2000; }); attack(s[1]); e.observe(s);
    s[1].actions = [];
    s.forEach(p => { p.at += 5000; p.queens[0].hp = 190; });
    expect(() => e.observe(s)).not.toThrow();
    expect(e.milestones.repeatFight).toBeUndefined();
    s.forEach(p => { p.at += 1000; }); s[1].xp.melee += 20; e.observe(s);
    expect(e.restarts).toEqual([{ spawnedAt, player: 1, attackedAt: spawnedAt + 2000, damagedAt: spawnedAt + 8000 }]);
});

test('XP without an own queen attack cannot confirm a restart', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    fight(e, s, 1158, 255); e.observe(s);
    fight(e, s, 1158, 200); s[0].xp.melee += 40; e.observe(s);
    expect(e.restarts).toHaveLength(0);
    s.forEach(p => { p.at += 6001; });
    expect(() => e.observe(s)).toThrow('did not re-engage within six seconds');
});

test('another member gaining XP does not confirm the attacker hit', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    fight(e, s, 1158, 255); attack(s[0]); e.observe(s);
    s[0].actions = [];
    fight(e, s, 1158, 200); s[1].xp.melee += 40; e.observe(s);
    expect(e.restarts).toHaveLength(0);
});

test('stale and late queen attacks cannot satisfy the respawn deadline', () => {
    for (const offset of [-2000, 6001]) {
        const e = new KqEvidence(); const s = team(); kill(e, s);
        fight(e, s, 1158, 255); e.observe(s);
        const spawnedAt = s[0].at;
        s.forEach(p => { p.at += 6001; }); attack(s[0], spawnedAt + offset);
        s[0].xp.melee += 40;
        expect(() => e.observe(s)).toThrow('did not re-engage within six seconds');
        expect(e.restarts).toHaveLength(0);
    }
});

test('leaving the chamber discards an unconfirmed respawn attack', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    fight(e, s, 1158, 255); attack(s[0]); e.observe(s);
    s[0].actions = []; s[0].restocking = true; s[0].tile = { x: 3308, z: 3120, level: 0 }; s[0].queens = [];
    s.forEach(p => { p.at += 1000; }); e.observe(s);
    s[0].xp.melee += 40; s.forEach(p => { p.at += 1000; }); e.observe(s);
    s[0].restocking = false; s[0].tile = { x: 3473, z: 9498, level: 0 };
    s.forEach(p => { p.at += 1000; p.queens = [{ id: 1158, hp: 200, total: 255, tile: { x: 3476, z: 9498, level: 0 } }]; }); e.observe(s);
    expect(e.restarts).toHaveLength(0);
});

test('a dying attacker cannot confirm a restart with its final XP sample', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    fight(e, s, 1158, 255); attack(s[0]); e.observe(s);
    s[0].actions = []; s[0].hp = 0; s[0].xp.melee += 40;
    s.forEach(p => { p.at += 1000; });
    expect(() => e.observe(s)).toThrow('A team member died');
    expect(e.restarts).toHaveLength(0);
});

test('a queen death discards unconfirmed attacks before another encounter', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    fight(e, s, 1158, 255); attack(s[0]); e.observe(s); s[0].actions = [];
    fight(e, s, 1158, 0); e.observe(s);
    fight(e, s, 1160, 100); e.observe(s);
    fight(e, s, 1160, 0); e.observe(s);
    s.forEach(p => { p.at += 1000; p.queens = []; }); e.observe(s);
    fight(e, s, 1158, 200); s[0].xp.melee += 40; e.observe(s);
    expect(e.restarts).toHaveLength(0);
});

test('the full kit requires exactly five air runes and one law rune', () => {
    const e = new KqEvidence(); const s = team();
    s[0].pack.find(i => i.id === 556)!.count = 4;
    e.observe(s); expect(e.milestones.sharedKit).toBeUndefined();
    s[0].pack.find(i => i.id === 556)!.count = 5;
    s[0].pack.find(i => i.id === 563)!.count = 0;
    e.observe(s); expect(e.milestones.sharedKit).toBeUndefined();
    s[0].pack.find(i => i.id === 563)!.count = 1;
    e.observe(s); expect(e.milestones.sharedKit).toBe(1000);
});

test('remaining members can finish a flying queen after a contributor banks', () => {
    const e = new KqEvidence(); const s = team(); melee(e, s);
    fight(e, s, 1160, 100); e.observe(s);
    s[0].restocking = true; s[0].tile = { x: 3308, z: 3120, level: 0 }; s[0].queens = [];
    e.observe(s);
    s.slice(1).forEach(p => { p.at += 1000; p.queens[0].hp = 0; p.xp.ranged += 50; }); e.observe(s);
    s.slice(1).forEach(p => { p.at += 1000; p.queens = []; }); e.observe(s);
    expect(e.kills).toHaveLength(1);
    expect(e.milestones.killed).toBeGreaterThan(0);
    s.slice(1).forEach(p => { p.tile = { x: 3308, z: 3120, level: 0 }; });
    expect(() => e.observe(s)).not.toThrow();
    expect(e.trips[0].kills).toBe(1);
    expect(e.trips[0].xpGains[0]).toEqual({ melee: 50, ranged: 0 });
});

test('a remaining observer losing sight of a living flying queen cannot count a kill', () => {
    const e = new KqEvidence(); const s = team(); melee(e, s);
    fight(e, s, 1160, 100); e.observe(s);
    s.slice(0, 3).forEach(p => { p.restocking = true; p.tile = { x: 3308, z: 3120, level: 0 }; });
    s.forEach(p => { p.queens = []; }); e.observe(s);
    expect(e.kills).toHaveLength(0);
});

test('stale death data outside the chamber or during loading cannot prove a kill', () => {
    for (const loading of [false, true]) {
        const e = new KqEvidence(); const s = team(); melee(e, s);
        fight(e, s, 1160, 100); e.observe(s);
        s.slice(1).forEach(p => { p.queens = []; });
        s[0].queens[0].hp = 0;
        if (loading) s[0].sceneReady = false;
        else s[0].tile = { x: 3308, z: 3120, level: 0 };
        e.observe(s);
        s[0].queens = []; s[0].sceneReady = true; e.observe(s);
        expect(e.kills).toHaveLength(0);
    }
});

test('flying death still needs a chamber observer for its disappearance', () => {
    const e = new KqEvidence(); const s = team(); melee(e, s);
    fight(e, s, 1160, 100); e.observe(s);
    fight(e, s, 1160, 0); e.observe(s);
    s.forEach(p => { p.queens = []; p.tile = { x: 3308, z: 3120, level: 0 }; }); e.observe(s);
    expect(e.kills).toHaveLength(0);
});

test('a flying death abandoned before disappearance cannot be confirmed on the next trip', () => {
    const e = new KqEvidence(); const s = team(); melee(e, s);
    fight(e, s, 1160, 100); e.observe(s);
    fight(e, s, 1160, 0); e.observe(s);
    s.forEach(p => { p.at += 200; p.tile = { x: 3308, z: 3120, level: 0 }; p.queens = []; }); e.observe(s);
    expect(e.trips[0].kills).toBe(0);
    const next = team(s[0].at + 200); next.forEach((p, i) => { p.xp = { ...s[i].xp }; }); e.observe(next);
    fight(e, next, 1158, 255);
    next.forEach(p => { p.queens = []; p.ground = [{ id: 1621, name: 'Uncut emerald', count: 1, tile: { x: 3476, z: 9498, level: 0 } }]; }); e.observe(next);
    expect(e.kills).toHaveLength(0);
    expect(e.loot).toHaveLength(0);
    expect(e.milestones.killed).toBeUndefined();
});

test('one continuous zero-HP witness can confirm the death after the other three leave', () => {
    const e = new KqEvidence(); const s = team(); melee(e, s);
    fight(e, s, 1160, 100); e.observe(s);
    fight(e, s, 1160, 0); e.observe(s);
    const deathAt = s[0].at;
    s.forEach((p, i) => { p.at += 200; p.queens = []; if (i < 3) { p.restocking = true; p.tile = { x: 3308, z: 3120, level: 0 }; } }); e.observe(s);
    expect(e.kills).toEqual([{ at: deathAt, entries: [1, 1, 1, 1] }]);
});

test('an unwitnessed chamber member cannot replace the departing zero-HP witness', () => {
    const e = new KqEvidence(); const s = team(); melee(e, s);
    fight(e, s, 1160, 100); e.observe(s);
    fight(e, s, 1160, 0); s.slice(0, 3).forEach(p => { p.queens = []; }); e.observe(s);
    s[3].tile = { x: 3308, z: 3120, level: 0 }; s[3].queens = [];
    s.forEach(p => { p.at += 200; }); e.observe(s);
    expect(e.kills).toHaveLength(0);
});

test('loading interrupts the only death witness and returning cannot restore it', () => {
    const e = new KqEvidence(); const s = team(); melee(e, s);
    fight(e, s, 1160, 100); e.observe(s);
    fight(e, s, 1160, 0); e.observe(s);
    s.forEach(p => { p.at += 200; p.sceneReady = false; p.queens = []; }); e.observe(s);
    s.forEach(p => { p.at += 200; p.sceneReady = true; }); e.observe(s);
    expect(e.kills).toHaveLength(0);
});

test('a rendered chamber tile cannot retain a death witness whose server position already escaped', () => {
    const e = new KqEvidence(); const s = team(); melee(e, s);
    fight(e, s, 1160, 100); e.observe(s);
    fight(e, s, 1160, 0); e.observe(s);
    s.forEach(p => { p.at += 200; p.serverTile = { x: 2757, z: 3478, level: 0 }; p.queens = []; }); e.observe(s);
    expect(e.kills).toHaveLength(0);
});

test('abandoning a later death cannot create loot or respawn proof from an earlier kill', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    fight(e, s, 1158, 255); e.observe(s);
    fight(e, s, 1160, 100); e.observe(s);
    fight(e, s, 1160, 0); e.observe(s);
    s.forEach(p => { p.at += 200; p.tile = { x: 3308, z: 3120, level: 0 }; p.queens = []; }); e.observe(s);
    const next = team(s[0].at + 200); next.forEach((p, i) => { p.xp = { ...s[i].xp }; }); e.observe(next);
    fight(e, next, 1158, 255);
    next.forEach(p => { p.ground = [{ id: 1621, name: 'Uncut emerald', count: 1, tile: { x: 3476, z: 9498, level: 0 } }]; }); e.observe(next);
    next.forEach(p => { p.at += 1000; p.queens[0].hp = 200; }); attack(next[0]); next[0].xp.melee += 40; e.observe(next);
    expect(e.kills).toHaveLength(1);
    expect(e.loot).toHaveLength(0);
    expect(e.restarts).toHaveLength(0);
});

test('independent restocking requires a real bank view and continued combat during the absence', () => {
    for (const damageOnly of [false, true]) {
        const e = new KqEvidence(); const s = team(); melee(e, s);
        fight(e, s, 1160, 100); e.observe(s);
        s[0].restocking = true; s[0].tile = { x: 2757, z: 3478, level: 0 }; s[0].queens = []; e.observe(s);
        s.forEach(p => { p.at += 1000; });
        if (damageOnly) s.slice(1).forEach(p => { p.queens[0].hp = 90; });
        else s[1].xp.ranged += 25;
        e.observe(s);
        s[0].tile = { x: 3308, z: 3120, level: 0 }; e.observe(s);
        expect(e.milestones.independentRestock).toBeUndefined();
        s[0].bankOpen = true; e.observe(s);
        if (damageOnly) expect(e.milestones.independentRestock).toBeUndefined();
        else expect(e.milestones.independentRestock).toBeGreaterThan(0);
    }
});

test('earlier combat and an idle chamber party do not prove independent restocking', () => {
    const e = new KqEvidence(); const s = team(); melee(e, s);
    fight(e, s, 1160, 100); s[1].xp.ranged += 25; e.observe(s);
    s[0].restocking = true; s[0].tile = { x: 3308, z: 3120, level: 0 }; s[0].bankOpen = true; s[0].queens = []; e.observe(s);
    s.forEach(p => { p.at += 1000; }); e.observe(s);
    expect(e.milestones.independentRestock).toBeUndefined();
});

test('a chamber member who also retreats cannot witness independent restocking', () => {
    const e = new KqEvidence(); const s = team(); melee(e, s);
    fight(e, s, 1160, 100); e.observe(s);
    s[0].restocking = true; s[0].tile = { x: 2757, z: 3478, level: 0 }; s[0].queens = []; e.observe(s);
    s.slice(1).forEach(p => { p.restocking = true; p.xp.ranged += 25; }); e.observe(s);
    s[0].tile = { x: 3308, z: 3120, level: 0 }; s[0].bankOpen = true; e.observe(s);
    expect(e.milestones.independentRestock).toBeUndefined();
});

test('the active party waits in the corner while a depleted member restocks', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    s[0].tile = { x: 3308, z: 3120, level: 0 };
    s.slice(1).forEach(p => { p.tile = { x: 3470, z: 9503, level: 0 }; p.prayers = []; p.gear[0].id = 1434; });
    e.observe(s); expect(e.milestones.corner).toBeUndefined();
    s[0].restocking = true;
    e.observe(s); expect(e.milestones.corner).toBeGreaterThan(0);
});

test('remaining fighters must re-engage a respawn while another member restocks', () => {
    for (const attack of [false, true]) {
        const e = new KqEvidence(); const s = team(); kill(e, s);
        fight(e, s, 1158, 255);
        s[0].restocking = true; s[0].tile = { x: 3308, z: 3120, level: 0 }; s[0].queens = []; e.observe(s);
        if (attack) {
            s.slice(1).forEach(p => { p.at += 1000; p.queens[0].hp = 200; });
            s[1].actions = [{ kind: 'attack', tick: s[1].at, at: s[1].at, food: 16, hp: 99, xp: s[1].xp.melee + s[1].xp.ranged }];
            s.slice(1).forEach(p => { p.xp.melee += 40; }); e.observe(s);
            expect(e.milestones.repeatFight).toBeGreaterThan(0);
        } else {
            s.forEach(p => { p.at += 6001; });
            expect(() => e.observe(s)).toThrow('did not re-engage within six seconds');
        }
    }
});

test('a pause probe waits for all four to gain combat XP on a later chamber visit', () => {
    const e = new KqEvidence(); const s = team();
    s.forEach(p => Object.assign(p, { stage: 'fight', runner: 'running' }));
    melee(e, s);
    expect(e.readyForPause(s)).toBe(false);
    s.forEach(p => { p.tile = { x: 3308, z: 3120, level: 0 }; p.queens = []; }); e.observe(s);
    fight(e, s, 1158, 255); e.observe(s);
    expect(e.readyForPause(s)).toBe(false);
    s.slice(0, 3).forEach(p => { p.xp.melee += 50; });
    expect(e.readyForPause(s)).toBe(false);
    s[3].xp.ranged += 25;
    expect(e.readyForPause(s)).toBe(true);
});

test('pause eligibility requires every member running and fighting inside the ready chamber', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    s.forEach(p => { p.tile = { x: 3308, z: 3120, level: 0 }; }); e.observe(s);
    fight(e, s, 1158, 255); e.observe(s);
    s.forEach(p => { Object.assign(p, { stage: 'fight', runner: 'running' }); p.xp.melee += 25; });
    expect(e.readyForPause(s)).toBe(true);
    for (const change of [
        { stage: 'upper' }, { stage: 'loot' }, { runner: 'paused' }, { restocking: true }, { sceneReady: false },
        { tile: { x: 3508, z: 9497, level: 2 } }
    ]) {
        const altered = structuredClone(s);
        Object.assign(altered[3], change);
        expect(e.readyForPause(altered)).toBe(false);
    }
    expect(e.readyForPause(s.slice(0, 3))).toBe(false);
});

test('eat and attack evidence needs matching ticks, consumed food and subsequent combat XP from every player', () => {
    const e = new KqEvidence(); const s = team(); e.observe(s);
    fight(e, s, 1158, 255); e.observe(s);
    s.forEach(p => {
        const action = { tick: 100, at: p.at, food: count(p.pack, 385), hp: p.hp, xp: p.xp.melee + p.xp.ranged };
        p.actions = [{ ...action, kind: 'eat' }, { ...action, kind: 'attack' }];
    });
    e.observe(s);
    expect(e.milestones.eatAttack).toBeUndefined();
    s.forEach(p => { p.actions = []; p.at += 200; p.pack.find(i => i.id === 385)!.count--; });
    e.observe(s);
    expect(e.milestones.eatAttack).toBeUndefined();
    s.slice(0, 3).forEach(p => { p.xp.melee += 40; }); e.observe(s);
    expect(e.eatAttacks).toHaveLength(3);
    expect(e.milestones.eatAttack).toBeUndefined();
    s[3].xp.melee += 40; e.observe(s);
    expect(e.milestones.eatAttack).toBeDefined();
    expect(e.eatAttacks).toHaveLength(4);
});

test('chamber search requires movement, queen visibility and this players combat XP', () => {
    const e = new KqEvidence(); const s = team(); e.observe(s);
    s.forEach(p => { p.at += 1000; p.tile = { x: 3508, z: 9493, level: 0 }; }); e.observe(s);
    s[0].tile = { x: 3488, z: 9496, level: 0 }; e.observe(s);
    s[0].queens = [{ id: 1158, hp: 230, total: 255, tile: { x: 3480, z: 9495, level: 0 } }]; e.observe(s);
    expect(e.milestones.search).toBeUndefined();
    s[1].xp.melee += 40; e.observe(s);
    expect(e.milestones.search).toBeUndefined();
    s[0].xp.melee += 40; e.observe(s);
    expect(e.milestones.search).toBeDefined();
    expect(e.searches[0].player).toBe(0);
});

test('combat before discovering the queen cannot prove search success', () => {
    const e = new KqEvidence(); const s = team(); e.observe(s);
    s.forEach(p => { p.at += 1000; p.tile = { x: 3508, z: 9493, level: 0 }; }); e.observe(s);
    s[0].tile = { x: 3504, z: 9493, level: 0 }; s[0].xp.melee += 40; e.observe(s);
    s[0].queens = [{ id: 1158, hp: 230, total: 255, tile: { x: 3480, z: 9495, level: 0 } }]; e.observe(s);
    expect(e.milestones.search).toBeUndefined();
    s[0].xp.melee += 40; e.observe(s);
    expect(e.searches[0].xpGained).toBe(40);
});

test('formation movement after discovering the queen is not a chamber search', () => {
    const e = new KqEvidence(); const s = team(); e.observe(s);
    s.forEach(p => { p.at += 1000; p.tile = { x: 3508, z: 9493, level: 0 }; }); e.observe(s);
    s[0].queens = [{ id: 1158, hp: 230, total: 255, tile: { x: 3480, z: 9495, level: 0 } }]; s[0].xp.melee += 40; e.observe(s);
    s[0].tile = { x: 3504, z: 9493, level: 0 }; s[0].xp.melee += 40; e.observe(s);
    expect(e.milestones.search).toBeUndefined();
});

test('reacquiring a queen lost during the same visit can prove a search', () => {
    const e = new KqEvidence(); const s = team(); e.observe(s);
    fight(e, s, 1158, 255); e.observe(s);
    const queen = s[0].queens[0];
    s[0].queens = []; e.observe(s);
    s[0].tile!.x -= 4; e.observe(s);
    s[0].queens = [queen]; e.observe(s);
    expect(e.milestones.search).toBeUndefined();
    s[0].xp.melee += 40; e.observe(s);
    expect(e.searches).toHaveLength(1);
});

test('walking to the corner after a known death is not a queen search', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    s[0].tile!.x -= 4; e.observe(s);
    fight(e, s, 1158, 255); e.observe(s);
    s[0].xp.melee += 40; e.observe(s);
    expect(e.milestones.search).toBeUndefined();
});

test('another member observing the death cancels a pending search', () => {
    const e = new KqEvidence(); const s = team(); melee(e, s);
    fight(e, s, 1160, 255); e.observe(s);
    fight(e, s, 1160, 100); e.observe(s);
    s[0].queens = []; e.observe(s);
    s[0].tile!.x -= 4;
    s.slice(1).forEach(p => { p.queens[0].hp = 0; }); e.observe(s);
    s.forEach(p => { p.queens = []; p.at += 1000; }); e.observe(s);
    expect(e.kills).toHaveLength(1);
    s[0].tile!.x -= 4; e.observe(s);
    fight(e, s, 1158, 255); e.observe(s);
    s[0].xp.melee += 40; e.observe(s);
    expect(e.milestones.search).toBeUndefined();
});

test('returning before finding the queen cannot satisfy chamber search', () => {
    const e = new KqEvidence(); const s = team(); e.observe(s);
    s.forEach(p => { p.at += 1000; p.tile = { x: 3508, z: 9493, level: 0 }; }); e.observe(s);
    s[0].tile = { x: 2757, z: 3478, level: 0 }; s[0].restocking = true; e.observe(s);
    s[0].tile = { x: 3488, z: 9496, level: 0 }; s[0].restocking = false;
    s[0].queens = [{ id: 1158, hp: 230, total: 255, tile: { x: 3480, z: 9495, level: 0 } }]; s[0].xp.melee += 40; e.observe(s);
    expect(e.milestones.search).toBeUndefined();
});

test('later-tick attacks or unconsumed food cannot prove combined eating and combat', () => {
    for (const sameTick of [true, false]) {
        const e = new KqEvidence(); const s = team(); e.observe(s);
        fight(e, s, 1158, 255); e.observe(s);
        const action = { tick: 100, at: s[0].at, food: count(s[0].pack, 385), hp: 40, xp: s[0].xp.melee + s[0].xp.ranged };
        s[0].actions = [{ ...action, kind: 'eat' }, { ...action, kind: 'attack', tick: sameTick ? 100 : 101 }]; e.observe(s);
        s[0].actions = []; s[0].at += 200; s[0].xp.melee += 40;
        if (!sameTick) s[0].pack.find(i => i.id === 385)!.count--;
        e.observe(s);
        expect(e.eatAttacks).toHaveLength(0);
    }
});

test('XP before food consumption is not subsequent combat evidence', () => {
    const e = new KqEvidence(); const s = team(); e.observe(s);
    fight(e, s, 1158, 255); e.observe(s);
    const p = s[0];
    const action = { tick: 100, at: p.at, food: count(p.pack, 385), hp: 40, xp: p.xp.melee + p.xp.ranged };
    p.actions = [{ ...action, kind: 'eat' }, { ...action, kind: 'attack' }]; e.observe(s);
    p.actions = []; p.at += 200; p.xp.melee += 40; e.observe(s);
    p.at += 200; p.pack.find(i => i.id === 385)!.count--; e.observe(s);
    expect(e.eatAttacks).toHaveLength(0);
    p.at += 200; p.xp.melee += 40; e.observe(s);
    expect(e.eatAttacks).toHaveLength(1);
});

test('a new food input cannot replace an earlier pair awaiting combat evidence', () => {
    const e = new KqEvidence(); const s = team(); e.observe(s);
    fight(e, s, 1158, 255); e.observe(s);
    const p = s[0];
    const action = { tick: 100, at: p.at, food: count(p.pack, 385), hp: 40, xp: p.xp.melee + p.xp.ranged };
    p.actions = [{ ...action, kind: 'eat' }, { ...action, kind: 'attack' }]; e.observe(s);
    p.actions = []; p.at += 200; p.pack.find(i => i.id === 385)!.count--; e.observe(s);
    p.at += 400; p.xp.melee += 40;
    p.actions = [{ ...action, kind: 'eat', tick: 103, at: p.at, food: count(p.pack, 385) }]; e.observe(s);
    expect(e.eatAttacks).toHaveLength(1);
    expect(e.eatAttacks[0].input.tick).toBe(100);
});

test('depleted food excuses a prompt zero-XP emergency departure', () => {
    const e = new KqEvidence(); const s = team(); e.observe(s);
    fight(e, s, 1158, 255); e.observe(s);
    s[3].pack.find(p => p.id === 385)!.count = 1;
    e.observe(s);
    const emergencyAt = s[3].at;
    s[3].at += 1000; s[3].restocking = true; s[3].tile = { x: 2757, z: 3478, level: 0 }; s[3].queens = []; e.observe(s);
    const departedAt = s[3].at;
    finishWithoutFourth(e, s);
    expect(() => e.observe(s)).not.toThrow();
    expect(e.trips[0].excusedPlayers).toEqual([{ player: 3, emergencyAt, departedAt, hp: 99, food: 1 }]);
});

test('low HP with food cannot excuse a zero-XP departure', () => {
    const e = new KqEvidence(); const s = team(); e.observe(s);
    fight(e, s, 1158, 255); e.observe(s);
    s[3].hp = 20; e.observe(s);
    s[3].at += 1000; s[3].restocking = true; s[3].tile = { x: 2757, z: 3478, level: 0 }; s[3].queens = []; e.observe(s);
    finishWithoutFourth(e, s);
    expect(() => e.observe(s)).toThrow('did not contribute combat XP on trip 1');
});

test('restocking without observed depleted food cannot excuse zero combat XP', () => {
    const e = new KqEvidence(); const s = team(); e.observe(s);
    fight(e, s, 1158, 255); e.observe(s);
    s[3].restocking = true; s[3].tile = { x: 2757, z: 3478, level: 0 }; s[3].queens = []; e.observe(s);
    finishWithoutFourth(e, s);
    expect(() => e.observe(s)).toThrow('did not contribute combat XP on trip 1');
});

test('critical HP without an observed restocking departure cannot excuse a passive member', () => {
    const e = new KqEvidence(); const s = team(); e.observe(s);
    fight(e, s, 1158, 255); e.observe(s);
    s[3].hp = 30; e.observe(s);
    s[3].hp = 70; e.observe(s);
    finishWithoutFourth(e, s);
    expect(() => e.observe(s)).toThrow('did not contribute combat XP on trip 1');
});

test('critical HP outside the chamber or during loading cannot excuse a later departure', () => {
    for (const loading of [false, true]) {
        const e = new KqEvidence(); const s = team(); e.observe(s);
        if (loading) { fight(e, s, 1158, 255); e.observe(s); s[3].sceneReady = false; }
        s[3].hp = 30; e.observe(s);
        s[3].hp = 99; s[3].sceneReady = true;
        if (!loading) fight(e, s, 1158, 255);
        e.observe(s);
        s[3].restocking = true; s[3].tile = { x: 2757, z: 3478, level: 0 }; s[3].queens = []; e.observe(s);
        finishWithoutFourth(e, s);
        expect(() => e.observe(s)).toThrow('did not contribute combat XP on trip 1');
    }
});

test('an emergency on an earlier visit does not excuse a later zero-XP departure', () => {
    const e = new KqEvidence(); const s = team(); melee(e, s);
    s[3].hp = 30; e.observe(s);
    s.forEach(p => { p.tile = { x: 3308, z: 3120, level: 0 }; p.queens = []; }); e.observe(s);
    s[3].hp = 99;
    fight(e, s, 1158, 255); e.observe(s);
    s[3].restocking = true; s[3].tile = { x: 2757, z: 3478, level: 0 }; s[3].queens = []; e.observe(s);
    finishWithoutFourth(e, s);
    expect(() => e.observe(s)).toThrow('did not contribute combat XP on trip 2');
});

test('an old healed emergency cannot excuse a departure more than ten seconds later', () => {
    const e = new KqEvidence(); const s = team(); e.observe(s);
    fight(e, s, 1158, 255); e.observe(s);
    s[3].hp = 30; e.observe(s);
    s[3].hp = 70; e.observe(s);
    s[3].at += 10001; s[3].restocking = true; s[3].tile = { x: 2757, z: 3478, level: 0 }; s[3].queens = []; e.observe(s);
    finishWithoutFourth(e, s);
    expect(() => e.observe(s)).toThrow('did not contribute combat XP on trip 1');
});

test('fresh depleted food replaces an expired emergency before departure', () => {
    const e = new KqEvidence(); const s = team(); e.observe(s);
    fight(e, s, 1158, 255); e.observe(s);
    s[3].pack.find(p => p.id === 385)!.count = 1; e.observe(s);
    s[3].pack.find(p => p.id === 385)!.count = 16; e.observe(s);
    s[3].at += 10001; s[3].pack.find(p => p.id === 385)!.count = 1; e.observe(s);
    const emergencyAt = s[3].at;
    s[3].at += 1000; s[3].restocking = true; s[3].tile = { x: 2757, z: 3478, level: 0 }; s[3].queens = []; e.observe(s);
    finishWithoutFourth(e, s);
    expect(() => e.observe(s)).not.toThrow();
    expect(e.trips[0].excusedPlayers[0].emergencyAt).toBe(emergencyAt);
});

test('an observed nearby own-target visitor excuses a prompt zero-XP restocking departure', () => {
    for (const name of ['Genie', 'Mysterious old man']) {
        const e = new KqEvidence(); const s = team(); e.observe(s);
        fight(e, s, 1158, 255); e.observe(s);
        const visitor = { id: 409, name, tile: { ...s[3].tile! }, targetsMe: true };
        s[3].visitors = [visitor]; e.observe(s);
        s[3].at += 1000; s[3].restocking = true; s[3].tile = { x: 2757, z: 3478, level: 0 }; s[3].visitors = []; s[3].queens = []; e.observe(s);
        finishWithoutFourth(e, s);
        expect(() => e.observe(s)).not.toThrow();
        expect(e.trips[0].excusedPlayers[0].visitor).toEqual(visitor);
        expect(e.trips[0].xpGains[3]).toEqual({ melee: 0, ranged: 0 });
    }
});

test('unowned, distant, stale or unrecognized visitors cannot excuse zero combat XP', () => {
    for (const invalid of ['unowned', 'distant', 'other level', 'stale', 'unknown', 'loading']) {
        const e = new KqEvidence(); const s = team(); e.observe(s);
        fight(e, s, 1158, 255); e.observe(s);
        const visitor = { id: 409, name: 'Genie', tile: { ...s[3].tile! }, targetsMe: true };
        if (invalid === 'unowned') visitor.targetsMe = false;
        if (invalid === 'distant') visitor.tile.x += 7;
        if (invalid === 'other level') visitor.tile.level = 2;
        if (invalid === 'unknown') visitor.name = 'Guard';
        if (invalid === 'loading') s[3].sceneReady = false;
        s[3].visitors = [visitor]; e.observe(s);
        s[3].at += invalid === 'stale' ? 10001 : 1000; s[3].sceneReady = true;
        s[3].restocking = true; s[3].tile = { x: 2757, z: 3478, level: 0 }; s[3].visitors = []; s[3].queens = []; e.observe(s);
        finishWithoutFourth(e, s);
        expect(() => e.observe(s)).toThrow('did not contribute combat XP on trip 1');
    }
});
