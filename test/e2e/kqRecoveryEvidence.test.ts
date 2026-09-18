import { expect, test } from 'bun:test';
import { KqRecoveryEvidence, type RecoverySample } from '../../e2e/lib/kqRecoveryEvidence.js';

const names = ['west', 'east', 'north', 'south'];
function team(): RecoverySample[] {
    return names.map(() => ({ at: 1000, sceneReady: true, tile: { x: 3308, z: 3120, level: 0 }, hp: 70,
        pack: [{ id: 861, count: 1 }, { id: 385, count: 10 }], gear: [{ id: 1434, count: 1 }, { id: 1061, count: 1 }],
        bank: [{ id: 995, count: 100 }], bankOpen: true, restocking: false, mode: 1, protectMagic: true,
        xp: { melee: 1000, ranged: 1000 }, queens: [], ground: [], stage: 'bank', runner: 'running', status: '',
        chat: [], deathChatCount: 0, death: null, recoveredItems: [] }));
}
function armed() {
    const e = new KqRecoveryEvidence(names); const s = team(); e.observe(s);
    s.forEach((p, i) => { p.at += 1000; p.bankOpen = false; p.tile = { x: 3476 + [-3, 3, 0, 0][i], z: 9498 + [0, 0, 3, -3][i], level: 0 }; p.stage = 'fight'; });
    e.arm(s, 2000); return { e, s };
}
function died(e: KqRecoveryEvidence, s: RecoverySample[]) {
    s.forEach(p => { p.at += 200; }); s[3].hp = 0; e.observe(s);
    s.forEach(p => { p.at += 1000; });
    s[3].hp = 70; s[3].tile = { x: 3221, z: 3218, level: 0 }; s[3].pack = []; s[3].gear = [{ id: 1434, count: 1 }];
    s[3].chat = ['Oh dear you are dead!']; s[3].deathChatCount = 1; s[3].restocking = true;
    s[3].death = { at: 2200, tile: { x: 3476, z: 9495, level: 0 }, items: [{ id: 861, count: 1 }], ground: [] };
    s[0].ground = [{ id: 861, count: 1, tile: { x: 3476, z: 9495, level: 0 } }]; e.observe(s);
}
function picked(e: KqRecoveryEvidence, s: RecoverySample[]) {
    s.forEach(p => { p.at += 200; });
    s[0].pack[0].count = 2; s[0].ground = [];
    s[0].recoveredItems = [{ owner: 'south', id: 861, count: 1, at: s[0].at }]; e.observe(s);
}
function banked(e: KqRecoveryEvidence, s: RecoverySample[]) {
    s.forEach(p => { p.at += 2000; });
    s[0].tile = { x: 3308, z: 3120, level: 0 }; s[0].bankOpen = true; s[0].bank.push({ id: 861, count: 2 }); s[0].pack = [];
    s[3].tile = { x: 3308, z: 3120, level: 0 }; s[3].stage = 'bank'; s[3].bankOpen = true;
    s[3].status = 'returning to Shantay; waiting for replacement gear'; e.observe(s);
}

test('one controlled death requires ground, own-roster pickup, bank deposit and the dead player waiting at Shantay', () => {
    const { e, s } = armed(); died(e, s); picked(e, s); banked(e, s);
    expect(e.complete).toBe(true);
    expect(e.deaths).toHaveLength(1); expect(e.deaths[0].expected).toBe(true);
    expect(e.pickups[0]).toMatchObject({ player: 0, owner: 'south', id: 861, count: 1, bankBefore: 0, ownedBefore: 1 });
    expect(e.pickups[0].bankedAt).toBe(s[0].at);
});

test('script death metadata without zero HP or death chat cannot prove a death', () => {
    const { e, s } = armed(); s[3].death = { at: 2100, tile: { ...s[3].tile! }, items: [], ground: [] };
    e.observe(s); expect(e.deaths).toHaveLength(0);
    s.forEach(p => { p.at += 6000; }); expect(() => e.observe(s)).toThrow('did not produce an observed death');
});

test('a survivor death or a second death of the fixture player fails the recovery probe', () => {
    for (const player of [0, 3]) {
        const { e, s } = armed(); died(e, s);
        s.forEach(p => { p.at += 2000; }); s[player].hp = 0;
        expect(() => e.observe(s)).toThrow('Unexpected death');
        expect(e.deaths.filter(d => !d.expected)).toHaveLength(1);
    }
});

test('a delayed first death chat confirms the HP-zero episode and a later HP zero is a second death', () => {
    const { e, s } = armed();
    s.forEach(p => { p.at += 200; }); s[3].hp = 0; e.observe(s);
    s.forEach(p => { p.at += 3200; }); s[3].hp = 70; s[3].tile = { x: 3221, z: 3218, level: 0 };
    s[3].chat = ['Oh dear you are dead!']; s[3].deathChatCount = 1; s[3].pack = [];
    expect(() => e.observe(s)).not.toThrow(); expect(e.deaths).toHaveLength(1);
    s.forEach(p => { p.at += 2000; }); s[3].hp = 0;
    expect(() => e.observe(s)).toThrow('Unexpected death'); expect(e.deaths).toHaveLength(2);
});

test('recovery metadata for another owner cannot prove the controlled victim pickup', () => {
    const { e, s } = armed(); died(e, s);
    s[0].pack[0].count = 2; s[0].recoveredItems = [{ owner: 'outsider', id: 861, count: 1, at: s[0].at }];
    e.observe(s); expect(e.pickups).toHaveLength(0);
});

test('a counter or unequipping an existing bow cannot prove an inventory pickup', () => {
    const { e, s } = armed(); died(e, s);
    s[0].recoveredItems = [{ owner: 'south', id: 861, count: 1, at: s[0].at }]; e.observe(s);
    expect(e.pickups).toHaveLength(0);
});

test('depositing only the original bow cannot prove the recovered bow was banked', () => {
    const { e, s } = armed(); died(e, s); picked(e, s);
    s[0].tile = { x: 3308, z: 3120, level: 0 }; s[0].bankOpen = true; s[0].pack = []; s[0].bank.push({ id: 861, count: 1 }); e.observe(s);
    expect(e.pickups[0].bankedAt).toBeUndefined(); expect(e.complete).toBe(false);
});

test('depositing two bows and withdrawing the loadout bow between samples still proves banking', () => {
    const { e, s } = armed(); died(e, s); picked(e, s);
    s[0].tile = { x: 3308, z: 3120, level: 0 }; s[0].bankOpen = true; s[0].pack[0].count = 1; s[0].bank.push({ id: 861, count: 1 });
    s.forEach(p => { p.at += 2000; }); e.observe(s);
    expect(e.pickups[0].bankedAt).toBe(s[0].at);
});

test('a bow already on the floor before the death is not recovery evidence', () => {
    const e = new KqRecoveryEvidence(names); const s = team(); e.observe(s);
    s.forEach(p => { p.tile = { x: 3476, z: 9495, level: 0 }; });
    s[0].ground = [{ id: 861, count: 1, tile: { x: 3476, z: 9495, level: 0 } }]; e.arm(s, 1000);
    died(e, s); picked(e, s); expect(e.pickups).toHaveLength(0);
});

test('a death before the explicit fixture is unexpected', () => {
    const e = new KqRecoveryEvidence(names); const s = team(); s[0].hp = 0;
    expect(() => e.observe(s)).toThrow('Unexpected death');
});

test('recovery readiness requires a stable first fight and room for a survivor to collect', () => {
    const e = new KqRecoveryEvidence(names); const s = team(); e.observe(s);
    s.forEach((p, i) => { p.at += 1000; p.tile = { x: 3476 + [-3, 3, 0, 0][i], z: 9498 + [0, 0, 3, -3][i], level: 0 }; p.stage = 'fight'; p.xp.melee += 10; p.queens = [{ id: 1158, hp: 200, total: 255, tile: { x: 3476, z: 9498, level: 0 } }]; });
    expect(e.ready(s)).toBe(false);
    s.forEach(p => { p.at += 600; }); expect(e.ready(s)).toBe(true);
    s[1].restocking = true; expect(e.ready(s)).toBe(false);
});
