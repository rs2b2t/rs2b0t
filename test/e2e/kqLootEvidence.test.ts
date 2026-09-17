import { expect, test } from 'bun:test';
import { KqLootEvidence, LOOT_FIXTURE, type LootSample } from '../../e2e/lib/kqLootEvidence.js';

const tile = { x: 3470, z: 9503, level: 0 };
const team = (): LootSample[] => Array.from({ length: 4 }, () => ({ at: 1000, tick: 1, sceneReady: true, tile: { x: 3308, z: 3120, level: 0 }, hp: 70,
    pack: [{ id: 385, count: 10 }], gear: [{ id: 1731, count: 1 }], bank: [], bankOpen: true, restocking: false,
    mode: 1, protectMagic: true, xp: { melee: 1000, ranged: 1000 }, queens: [], ground: [], stage: 'bank', runner: 'running', chat: [], lootTakes: [], actions: [] }));
const advance = (s: LootSample[], ms = 600) => s.forEach(p => { p.at += ms; p.tick += Math.ceil(ms / 600); p.lootTakes = []; p.actions = []; });
function armed() {
    const e = new KqLootEvidence(); const s = team(); e.observe(s);
    advance(s);
    s.forEach(p => { p.tile = { ...tile }; p.bankOpen = false; p.stage = 'fight'; p.xp.melee += 10; });
    e.arm(s, tile, s[0].at, s[0].at); return { e, s };
}
function publicLoot(e: KqLootEvidence, s: LootSample[]) {
    advance(s, 60_000); s.forEach(p => { p.ground = LOOT_FIXTURE.map(item => ({ ...item, tile })); p.queens = [{ id: 1158, hp: 200, total: 255, tile }]; }); e.observe(s);
}
function pickup(e: KqLootEvidence, s: LootSample[], id: number, player = 0) {
    advance(s);
    s[player].lootTakes = [{ id, tile, at: s[player].at, tick: s[player].tick, owned: id === 1731 ? 1 : 0, food: 10, hp: s[player].hp }]; e.observe(s);
    advance(s); s[player].pack.push({ id, count: 1 }); s.forEach(p => { p.ground = p.ground.filter(g => g.id !== id); }); e.observe(s);
}
function feed(e: KqLootEvidence, s: LootSample[], player = 0) {
    advance(s); s[player].hp = 40; s[player].actions = [{ kind: 'eat', at: s[player].at, tick: s[player].tick, hp: 40, food: 10, xp: 2010 }]; e.observe(s);
    advance(s); s[player].pack.find(i => i.id === 385)!.count--; s[player].hp = 60; s[player].xp.melee += 10; e.observe(s);
    advance(s); s[player].xp.melee += 10; e.observe(s);
}
function bank(e: KqLootEvidence, s: LootSample[]) {
    advance(s, 10_000); s[0].tile = { x: 3308, z: 3120, level: 0 }; s[0].bankOpen = true;
    s[0].pack = [{ id: 385, count: 14 }]; s[0].bank = LOOT_FIXTURE.filter(i => i.id !== 892).map(i => ({ id: i.id, count: 1 })); e.observe(s);
}
function arrows(e: KqLootEvidence, s: LootSample[]) {
    const pile = { ...tile, x: tile.x + 2 };
    advance(s); s[0].ground.push({ id: 892, count: 7, tile: pile }); s[0].gear.push({ id: 892, count: 200 }); e.observe(s);
    advance(s); s[0].lootTakes = [{ id: 892, tile: pile, at: s[0].at, tick: s[0].tick, owned: 200, food: 10, hp: 70 }]; e.observe(s);
    advance(s); s[0].pack.push({ id: 892, count: 7 }); s[0].ground = s[0].ground.filter(g => g.id !== 892); e.observe(s);
}
function death(e: KqLootEvidence, s: LootSample[]) {
    advance(s); s.forEach(p => { p.queens = [{ id: 1160, hp: 30, total: 255, tile }]; }); e.observe(s);
    advance(s); s.forEach(p => { p.queens[0].hp = 0; }); e.observe(s);
    advance(s); s.forEach(p => { p.queens = []; }); e.observe(s);
}

test('the donor arms immediately after a verified death, with four participating fighters still in the chamber', () => {
    const e = new KqLootEvidence(); const s = team(); e.observe(s); advance(s);
    s.forEach(p => { p.tile = { ...tile }; p.bankOpen = false; p.stage = 'fight'; p.xp.melee += 10; });
    expect(e.ready(s, s[0].at)).toBe(true);
    e.arm(s, tile, s[0].at, s[0].at);
    expect(e.fixture).toMatchObject({ at: s[0].at, afterDeathAt: s[0].at });
});

test('live fights, stale deaths and departed members cannot trigger the donor timing fixture', () => {
    for (const variant of ['no death', 'live queen', 'stale death', 'departed', 'no XP']) {
        const e = new KqLootEvidence(); const s = team(); e.observe(s); advance(s, 10_000);
        s.forEach(p => { p.tile = { ...tile }; p.bankOpen = false; p.stage = 'fight'; p.xp.melee += 10; });
        if (variant === 'live queen') s[0].queens = [{ id: 1158, hp: 255, total: 255, tile }];
        if (variant === 'departed') s[0].serverTile = { x: 2757, z: 3478, level: 0 };
        if (variant === 'no XP') s[0].xp.melee -= 10;
        const killedAt = variant === 'no death' ? 0 : s[0].at - (variant === 'stale death' ? 5001 : 0);
        expect(e.ready(s, killedAt)).toBe(false);
        expect(() => e.arm(s, tile, s[0].at, killedAt)).toThrow('verified death');
    }
});

test('public leftovers require non-owner visibility, actual own pickups and extra bank ownership', () => {
    const { e, s } = armed(); arrows(e, s); publicLoot(e, s);
    for (const id of [3140, 1113, 1731]) pickup(e, s, id);
    feed(e, s); bank(e, s);
    expect(e.complete).toBe(true); expect(e.pickups).toHaveLength(3); expect(e.pickups.every(p => p.bankedAt)).toBe(true);
});

test('spent arrows are recovered during the verified first wait without relying on the donor stack lifetime', () => {
    const { e, s } = armed(); arrows(e, s);
    expect(e.arrowRecoveries).toMatchObject([{ player: 0, count: 7, ownedBefore: 200, ownedAfter: 207, source: 'other-ground' }]);
    expect(e.milestones.lootArrowsRecovered).toBeGreaterThan(0);
    expect(e.milestones.lootPublic).toBeUndefined();
});

test('a later wait needs observed living flying form, zero HP and disappearance', () => {
    const { e, s } = armed(); publicLoot(e, s); death(e, s); arrows(e, s);
    expect(e.arrowRecoveries).toHaveLength(1);
    expect(e.arrowRecoveries[0].deathAt).toBeGreaterThan(e.fixture!.afterDeathAt);
});

test('a death witness is retained when another client still shows the last positive HP sample', () => {
    const { e, s } = armed(); publicLoot(e, s); advance(s);
    s.forEach(p => { p.queens = [{ id: 1160, hp: 30, total: 255, tile }]; }); e.observe(s);
    advance(s); s[0].queens[0].hp = 0; e.observe(s);
    advance(s); s.forEach(p => { p.queens = []; }); e.observe(s);
    arrows(e, s); expect(e.arrowRecoveries).toHaveLength(1);
});

test('public arrows left alone during combat do not replace recovery evidence', () => {
    const { e, s } = armed(); publicLoot(e, s);
    for (const id of [3140, 1113, 1731]) pickup(e, s, id);
    feed(e, s); bank(e, s);
    expect(e.milestones.lootArrows).toBeGreaterThan(0);
    expect(e.milestones.lootArrowsRecovered).toBeUndefined(); expect(e.complete).toBe(false);
});

test('a wait expires before an unseen respawn can authorize arrow recovery', () => {
    const { e, s } = armed(); advance(s, 60_001);
    s[0].lootTakes = [{ id: 892, tile, at: s[0].at, tick: s[0].tick, owned: 200, food: 10, hp: 70 }];
    expect(() => e.observe(s)).toThrow('Rune arrow');
});

test('absence, lost witnesses and a respawn cannot authorize Rune-arrow recovery', () => {
    for (const variant of ['unseen', 'departed', 'unknown scene', 'respawn', 'unknown HP respawn', 'corpse appeared']) {
        const { e, s } = armed(); publicLoot(e, s);
        if (variant !== 'unseen') death(e, s);
        advance(s); s.forEach(p => { p.queens = []; });
        if (variant === 'departed') s.forEach(p => { p.serverTile = { x: 2757, z: 3478, level: 0 }; });
        if (variant === 'unknown scene') s.forEach(p => { p.sceneReady = false; });
        if (variant.includes('respawn')) s[1].queens = [{ id: 1158, hp: variant === 'respawn' ? 255 : 0, total: variant === 'respawn' ? 255 : 0, tile }];
        if (variant === 'corpse appeared') s[1].queens = [{ id: 1158, hp: 0, total: 255, tile }];
        e.observe(s); advance(s); s.forEach(p => { p.sceneReady = true; p.serverTile = { ...tile }; });
        s[0].lootTakes = [{ id: 892, tile, at: s[0].at, tick: s[0].tick, owned: 200, food: 10, hp: 70 }];
        expect(() => e.observe(s)).toThrow('Rune arrow');
        expect(e.arrowRecoveries).toHaveLength(0);
    }
});

test('a flying sighting cannot survive all witnesses leaving and authorize a later corpse wait', () => {
    const { e, s } = armed(); publicLoot(e, s); advance(s);
    s.forEach(p => { p.queens = [{ id: 1160, hp: 30, total: 255, tile }]; }); e.observe(s);
    advance(s); s.forEach(p => { p.serverTile = { x: 2757, z: 3478, level: 0 }; }); e.observe(s);
    advance(s); s.forEach(p => { p.serverTile = { ...tile }; p.queens[0].hp = 0; }); e.observe(s);
    advance(s); s.forEach(p => { p.queens = []; }); e.observe(s);
    advance(s); s[0].lootTakes = [{ id: 892, tile, at: s[0].at, tick: s[0].tick, owned: 0, food: 10, hp: 70 }];
    expect(() => e.observe(s)).toThrow('Rune arrow');
});

test('a missing arrow stack cannot turn unrelated inventory growth into recovery', () => {
    const { e, s } = armed(); advance(s);
    s[0].lootTakes = [{ id: 892, tile, at: s[0].at, tick: s[0].tick, owned: 0, food: 10, hp: 70 }]; e.observe(s);
    advance(s); s[0].pack.push({ id: 892, count: 7 }); e.observe(s);
    expect(e.arrowRecoveries).toHaveLength(0);
});

test('an unacknowledged arrow Take cannot prove recovery and respawn cancels its pending proof', () => {
    const { e, s } = armed(); advance(s); s[0].ground = [{ id: 892, count: 7, tile }]; e.observe(s);
    advance(s); s[0].lootTakes = [{ id: 892, tile, at: s[0].at, tick: s[0].tick, owned: 0, food: 10, hp: 70 }]; e.observe(s);
    expect(e.arrowRecoveries).toHaveLength(0);
    advance(s); s[1].queens = [{ id: 1158, hp: 255, total: 255, tile }]; s[0].pack.push({ id: 892, count: 7 }); e.observe(s);
    expect(e.arrowRecoveries).toHaveLength(0);
});

test('a valuable pickup completed after the queen dies does not prove active-fight collection', () => {
    const { e, s } = armed(); publicLoot(e, s); advance(s);
    s[0].lootTakes = [{ id: 3140, tile, at: s[0].at, tick: s[0].tick, owned: 0, food: 10, hp: 70 }]; e.observe(s);
    advance(s); s.forEach(p => { p.queens = []; }); s[0].pack.push({ id: 3140, count: 1 }); e.observe(s);
    expect(e.pickups).toHaveLength(0);
});

test('active Rune-arrow Takes fail even before the donor fixture is armed', () => {
    const e = new KqLootEvidence(); const s = team(); e.observe(s); advance(s);
    s[0].tile = tile; s[0].queens = [{ id: 1158, hp: 200, total: 255, tile }];
    s[0].lootTakes = [{ id: 892, tile, at: s[0].at, tick: s[0].tick, owned: 250, food: 10, hp: 70 }];
    expect(() => e.observe(s)).toThrow('Rune arrow');
});

test('private visibility or an absent queen cannot establish active-fight public loot', () => {
    for (const variant of ['private', 'no queen']) {
        const { e, s } = armed(); advance(s, 60_000);
        s.forEach((p, i) => { p.ground = i === 0 || variant === 'no queen' ? LOOT_FIXTURE.map(item => ({ ...item, tile })) : []; if (variant !== 'no queen') p.queens = [{ id: 1158, hp: 200, total: 255, tile }]; });
        e.observe(s); expect(e.milestones.lootPublic).toBeUndefined();
    }
});

test('old ground items cannot be reclassified as the donor fixture', () => {
    const { s } = armed(); s[0].ground = [{ id: 3140, count: 1, tile }];
    const next = new KqLootEvidence(); next.observe(team());
    expect(() => next.arm(s, tile, s[0].at, s[0].at)).toThrow('already');
});

test('unequipping the original amulet cannot prove collection', () => {
    const { e, s } = armed(); publicLoot(e, s); advance(s);
    s[0].gear = []; s[0].pack.push({ id: 1731, count: 1 }); e.observe(s);
    expect(e.pickups).toHaveLength(0);
});

test('inventory growth requires an accepted take at the exact fixture tile', () => {
    for (const variant of ['missing', 'wrong tile', 'stale']) {
        const { e, s } = armed(); publicLoot(e, s); advance(s);
        if (variant !== 'missing') s[0].lootTakes = [{ id: 3140, tile: variant === 'wrong tile' ? { ...tile, x: tile.x + 1 } : tile, at: s[0].at - (variant === 'stale' ? 20_000 : 0), tick: s[0].tick, owned: 0, food: 10, hp: 70 }];
        e.observe(s); advance(s); s[0].pack.push({ id: 3140, count: 1 }); e.observe(s);
        expect(e.pickups).toHaveLength(0);
    }
});

test('a rune-arrow take fails even without an inventory increase', () => {
    const { e, s } = armed(); publicLoot(e, s); advance(s);
    s[1].lootTakes = [{ id: 892, tile, at: s[1].at, tick: s[1].tick, owned: 250, food: 10, hp: 70 }];
    expect(() => e.observe(s)).toThrow('Rune arrow');
});

test('depositing only existing equipment does not prove banking the extra amulet', () => {
    const { e, s } = armed(); publicLoot(e, s); pickup(e, s, 1731); advance(s);
    s[0].tile = { x: 3308, z: 3120, level: 0 }; s[0].bankOpen = true; s[0].pack = []; s[0].gear = []; s[0].bank = [{ id: 1731, count: 1 }]; e.observe(s);
    expect(e.pickups[0]?.bankedAt).toBeUndefined();
});

test('bank counts from a closed or stale rendered bank view cannot prove a deposit', () => {
    for (const variant of ['closed', 'server elsewhere']) {
        const { e, s } = armed(); publicLoot(e, s); pickup(e, s, 3140); advance(s);
        s[0].tile = { x: 3308, z: 3120, level: 0 }; s[0].serverTile = variant === 'server elsewhere' ? tile : s[0].tile;
        s[0].bankOpen = variant !== 'closed'; s[0].pack = []; s[0].bank = [{ id: 3140, count: 1 }]; e.observe(s);
        expect(e.pickups[0]?.bankedAt).toBeUndefined();
    }
});

test('a delayed pickup retains its own action while eating continues', () => {
    const { e, s } = armed(); publicLoot(e, s); advance(s);
    s[0].lootTakes = [{ id: 3140, tile, at: s[0].at, tick: s[0].tick, owned: 0, food: 10, hp: 40 }]; e.observe(s);
    feed(e, s); advance(s, 2400); s[0].pack.push({ id: 3140, count: 1 }); e.observe(s);
    expect(e.pickups).toHaveLength(1); expect(e.eating[0]).toMatchObject({ player: 0, duringPickup: true });
});

test('a take in the first public batch survives small differences between client observation times', () => {
    const { e, s } = armed(); advance(s, 60_000);
    s.forEach((p, i) => { p.at += i; p.ground = LOOT_FIXTURE.map(item => ({ ...item, tile })); p.queens = [{ id: 1158, hp: 200, total: 255, tile }]; });
    s[0].lootTakes = [{ id: 3140, tile, at: s[0].at - 10, tick: s[0].tick, owned: 0, food: 10, hp: 70 }]; e.observe(s);
    advance(s); s[0].pack.push({ id: 3140, count: 1 }); e.observe(s);
    expect(e.pickups).toHaveLength(1);
});

test('food disappearance without an Eat and survival without combat do not prove continued eating and combat', () => {
    const { e, s } = armed(); publicLoot(e, s); advance(s);
    s[0].pack[0].count--; s[0].xp.melee += 100; e.observe(s);
    expect(e.milestones.lootSustain).toBeUndefined();
});

test('a queued food drop cannot masquerade as a confirmed meal followed by combat XP', () => {
    for (const beforeEat of [false, true]) {
        const { e, s } = armed(); publicLoot(e, s); advance(s);
        if (beforeEat) { Object.assign(s[0], { foodDrops: [{ at: s[0].at, tick: s[0].tick }] }); e.observe(s); advance(s); Object.assign(s[0], { foodDrops: [] }); }
        s[0].actions = [{ kind: 'eat', at: s[0].at, tick: s[0].tick, hp: 40, food: 10, xp: 2010 }]; e.observe(s);
        advance(s); if (!beforeEat) Object.assign(s[0], { foodDrops: [{ at: s[0].at, tick: s[0].tick }] });
        s[0].pack[0].count--; e.observe(s); advance(s); s[0].xp.melee += 40; e.observe(s);
        expect(e.milestones.lootSustain).toBeUndefined(); expect(e.eating).toHaveLength(0);
    }
});

test('the probe cannot pass if a roster member dies', () => {
    const { e, s } = armed(); s[2].hp = 0;
    expect(() => e.observe(s)).toThrow('died');
});
