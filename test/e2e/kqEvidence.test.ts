import { expect, test } from 'bun:test';
import { KqEvidence, chamber, type KqSample } from '../../e2e/lib/kqEvidence.js';

function team(at = 1000): KqSample[] {
    return [0, 1, 2, 3].map(i => ({
        at, tile: { x: 3308, z: 3120, level: 0 }, hp: 99, sceneReady: true,
        pack: [[861, 1], ...(i === 0 ? [[954, 2]] : []), [2434, 2], [2448, 1], [2436, 1], [2440, 1], [2442, 1], [2550, 1], [2552, 1], [1854, 1], [385, i === 0 ? 16 : 18]].map(([id, count]) => ({ id, count })),
        gear: [1434, 1163, 2503, 2497, 2491, 1731, 1061, 2550, 892].map(id => ({ id, count: id === 892 ? 250 : 1 })),
        bank: [], bankOpen: false, mode: 1, protectMagic: true, xp: { melee: 1000, ranged: 1000 }, queens: [], ground: []
    }));
}

function fight(e: KqEvidence, samples: KqSample[], id: number, hp: number): void {
    if (samples.some(s => !chamber(s))) {
        samples.forEach(s => { s.tile = { x: 3226, z: 3108, level: 0 }; }); e.observe(samples);
        samples.forEach(s => { s.tile = { x: 3508, z: 9497, level: 2 }; }); e.observe(samples);
    }
    samples.forEach((s, i) => {
        s.at += 1000;
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

test('returning from a random event does not count as another chamber descent', () => {
    const e = new KqEvidence(); const s = team(); e.observe(s);
    s.forEach(p => { p.at = 2000; p.tile = { x: 3508, z: 9497, level: 2 }; }); e.observe(s);
    s.forEach(p => { p.at = 3000; p.tile = { x: 3508, z: 9493, level: 0 }; }); e.observe(s);
    s[0].at = 4000; s[0].tile = { x: 2008, z: 4764, level: 0 }; e.observe(s);
    s[0].at = 30000; s[0].tile = { x: 3473, z: 9498, level: 0 }; e.observe(s);
    expect(e.crossings.chamber.map(c => c.length)).toEqual([1, 1, 1, 1]);
    s.forEach(p => { p.at = 31000; p.tile = { x: 3308, z: 3120, level: 0 }; }); e.observe(s);
    s.forEach(p => { p.at = 32000; p.tile = { x: 3508, z: 9497, level: 2 }; }); e.observe(s);
    s.forEach(p => { p.at = 33000; p.tile = { x: 3508, z: 9493, level: 0 }; });
    expect(() => e.observe(s)).not.toThrow();
    expect(e.crossings.chamber.map(c => c.length)).toEqual([2, 2, 2, 2]);
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
    s[0].pack.find(p => p.id === 385)!.count = 15;
    s[0].pack.push({ id: 995, count: 100 }); e.observe(s);
    s[0].bankOpen = false; s[0].pack.push({ id: 1854, count: 1 });
    s[0].pack.find(p => p.id === 995)!.count = 95; e.observe(s);
    expect(e.milestones.sharedKit).toBeUndefined();
    expect(e.milestones.buyPass).toBeUndefined();
    s[0].bankOpen = true; s[0].bank = [{ id: 995, count: 9995 }];
    s[0].pack = s[0].pack.filter(p => p.id !== 995);
    s[0].pack.find(p => p.id === 385)!.count = 16; e.observe(s);
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
    fight(e, s, 1158, 200); e.observe(s);
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

test('dueling escape requires arena arrival and a consumed charge even if inventory updates first', () => {
    const e = new KqEvidence(); const s = team(); kill(e, s);
    s.forEach(p => { p.pack.find(i => i.id === 2552)!.id = 2554; }); e.observe(s);
    s.forEach(p => { p.tile = { x: 3315, z: 3235, level: 0 }; }); e.observe(s);
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
    fight(e, s, 1158, 200); e.observe(s);
    expect(e.restarts).toHaveLength(1);
    expect(e.restarts[0].damagedAt - e.restarts[0].spawnedAt).toBe(1000);
});
