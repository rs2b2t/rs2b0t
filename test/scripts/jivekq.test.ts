import { describe, expect, test } from 'bun:test';
import { Party, parseRoster, type Member } from '../../src/bot/scripts/JiveKQ/party.js';
import { combatFormation, combatMode, combatTile, knownDead, lureTile, QueenTracker, queenPhase, retreatReason } from '../../src/bot/scripts/JiveKQ/policy.js';

const names = ['one', 'two', 'three', 'four'];
const member = (name: string, overrides: Partial<Member> = {}): Member => ({ name, session: name, trip: 1, stage: 'surface', tile: { x: 3226, z: 3108, level: 0 }, ready: true, ...overrides });

test('a central rock cannot leave the east ranger trying to stand inside it', () => {
    const centre = { x: 3476, z: 9502, level: 0 };
    const tiles = combatFormation(centre, 5, 'ranged', p => !(p.x >= 3482 && p.x <= 3485 && p.z === 9502));
    expect(tiles).not.toBeNull();
    expect(tiles![1]).toEqual({ x: 3481, z: 9502, level: 0 });
    for (const a of tiles!) for (const b of tiles!) if (a !== b) expect(Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z))).toBeGreaterThan(5);
});

test('adaptive cross never shortens two adjacent arms into splash range', () => {
    const tiles = combatFormation({ x: 100, z: 100, level: 0 }, 5, 'ranged', p => !(p.x === 106 || p.z === 106));
    expect(tiles).not.toBeNull();
    for (const a of tiles!) for (const b of tiles!) if (a !== b) expect(Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z))).toBeGreaterThan(5);
});

test('an impossible formation is reported instead of walking into a blocked tile forever', () => {
    expect(combatFormation({ x: 100, z: 100, level: 0 }, 5, 'ranged', () => false)).toBeNull();
});

describe('KQ party', () => {
    test('requires four distinct normalized accounts', () => {
        expect(parseRoster(' One, TWO, three, four ')).toEqual(names);
        expect(() => parseRoster('one,two,three')).toThrow();
        expect(() => parseRoster('one,ONE,three,four')).toThrow();
    });

    test('three accounts cannot release the entrance', () => {
        const party = new Party(names, 'one', 'one');
        names.slice(0, 3).forEach(name => party.receive(member(name), 100));
        expect(party.release('surface', 1, 100)).toBeNull();
    });

    test('only the leader releases four ready accounts physically at the entrance', () => {
        const party = new Party(names, 'one', 'one');
        names.forEach(name => party.receive(member(name), 100));
        expect(party.release('surface', 1, 100)?.sessions).toEqual(names);
        party.receive(member('four', { tile: { x: 3308, z: 3120, level: 0 } }), 101);
        expect(party.release('surface', 1, 101)).toBeNull();
    });

    test('stale, unready and wrong-trip members block release', () => {
        for (const override of [{ ready: false }, { trip: 2 }, { stage: 'bank' as const }]) {
            const party = new Party(names, 'one', 'one');
            names.forEach(name => party.receive(member(name), 100));
            party.receive(member('four', override), 100);
            expect(party.release('surface', 1, 100)).toBeNull();
        }
        const party = new Party(names, 'one', 'one');
        names.forEach(name => party.receive(member(name), 100));
        expect(party.release('surface', 1, 20_000)).toBeNull();
    });

    test('a release survives the leader descending before followers read it', () => {
        const leader = new Party(names, 'one', 'one');
        const follower = new Party(names, 'four', 'four');
        names.forEach(name => { leader.receive(member(name), 100); follower.receive(member(name), 100); });
        const release = leader.release('surface', 1, 100)!;
        follower.receive(member('one', { stage: 'upper', tile: { x: 3483, z: 9510, level: 2 } }), 110);
        follower.accept(release, 110);
        expect(follower.released('surface', 1, 500)).toBe(true);
        expect(follower.released('surface', 2, 500)).toBe(false);
        expect(follower.released('surface', 1, 20_000)).toBe(false);
    });

    test('rejects releases for a previous client session and malformed traffic', () => {
        const party = new Party(names, 'four', 'new-session');
        party.accept({ stage: 'surface', trip: 1, sessions: names, at: 100 }, 100);
        expect(party.released('surface', 1, 500)).toBe(false);
        for (const value of [null, {}, { name: 'intruder' }, { name: 'one', tile: null }]) {
            expect(() => party.receive(value, 100)).not.toThrow();
        }
        expect(party.members(100)).toEqual([]);
    });

    test('missing, paused and retreating peers abort a fight', () => {
        const party = new Party(names, 'one', 'one');
        names.forEach(name => party.receive(member(name, { stage: 'fight' }), 100));
        expect(party.unsafe(1, 100)).toBe(false);
        party.receive(member('four', { stage: 'retreat' }), 101);
        expect(party.unsafe(1, 101)).toBe(true);
        expect(party.unsafe(1, 20_000)).toBe(true);
    });

    test('a retreat cancels an already-issued descent release', () => {
        const party = new Party(names, 'one', 'one');
        names.forEach(name => party.receive(member(name), 100));
        party.accept(party.release('surface', 1, 100), 100);
        party.receive(member('four', { stage: 'retreat' }), 200);
        expect(party.released('surface', 1, 200)).toBe(false);
        party.receive(member('four'), 300);
        expect(party.release('surface', 1, 300)).toBeNull();
    });

    test('a restarted peer cannot use an old release', () => {
        const party = new Party(names, 'one', 'one');
        names.forEach(name => party.receive(member(name), 100));
        party.accept(party.release('surface', 1, 100), 100);
        party.receive(member('four', { session: 'restarted' }), 200);
        expect(party.released('surface', 1, 200)).toBe(false);
    });

    test('bank regrouping assigns a common next trip to a restarted client', () => {
        const leader = new Party(names, 'one', 'one');
        const restarted = new Party(names, 'four', 'four-new');
        for (const name of names) {
            const m = member(name, { stage: 'bank', tile: { x: 3308, z: 3120, level: 0 }, trip: name === 'four' ? 0 : 4, session: name === 'four' ? 'four-new' : name });
            leader.receive(m, 100);
            restarted.receive(m, 100);
        }
        const release = leader.release('bank', 5, 100);
        expect(release).not.toBeNull();
        restarted.accept(release, 100);
        expect(restarted.departure(0, 100)).toBe(5);
        expect(restarted.departure(5, 100)).toBeNull();
    });
});

describe('KQ combat policy', () => {
    test('selects mace crush and bow rapid even though ranged labels are not exposed', () => {
        expect(combatMode('melee', [{ mode: 0, label: '(Accurate)' }, { mode: 1, label: '(Aggressive)' }, { mode: 2, label: '(Controlled)' }, { mode: 3, label: '(Defensive)' }])).toBe(1);
        expect(combatMode('ranged', [{ mode: 0, label: '(Accurate)' }, { mode: 1, label: '(Rapid)' }, { mode: 3, label: '(Longrange)' }])).toBe(1);
        expect(combatMode('ranged', [])).toBe(1);
        expect(combatMode('melee', null)).toBeNull();
    });
    test('the flying form inherits a stale zero health bar and must still be attacked', () => {
        const tracker = new QueenTracker();
        expect(tracker.observe({ id: 1158, health: 0, totalHealth: 255 }).dead).toBe(true);
        expect(tracker.observe({ id: 1160, health: 0, totalHealth: 255 }).dead).toBe(false);
        expect(tracker.observe(null).killed).toBe(false);
        tracker.observe({ id: 1160, health: 180, totalHealth: 255 });
        expect(tracker.observe({ id: 1160, health: 0, totalHealth: 255 }).dead).toBe(true);
        expect(tracker.observe(null).killed).toBe(true);
        expect(tracker.observe(null).killed).toBe(false);
    });
    test('an unobserved health bar does not prevent the first attack', () => {
        expect(knownDead(0, 0)).toBe(false);
        expect(knownDead(0, 255)).toBe(true);
        expect(knownDead(10, 255)).toBe(false);
    });
    test('the corpse between forms is not a living queen or a kill', () => {
        expect(queenPhase(1158)).toBe('melee');
        expect(queenPhase(1159)).toBeNull();
        expect(queenPhase(1160)).toBe('ranged');
    });

    test('four players occupy the cardinal edges of the queen footprint', () => {
        const centre = { x: 3488, z: 9496, level: 0 };
        expect([0, 1, 2, 3].map(slot => combatTile(centre, 5, slot, 'melee'))).toEqual([
            { x: 3485, z: 9496, level: 0 }, { x: 3491, z: 9496, level: 0 },
            { x: 3488, z: 9499, level: 0 }, { x: 3488, z: 9493, level: 0 }
        ]);
    });

    test('ranged cross keeps every player outside the others five-tile splash radius', () => {
        const centre = { x: 3488, z: 9496, level: 0 };
        const tiles = [0, 1, 2, 3].map(slot => combatTile(centre, 5, slot, 'ranged'));
        expect(tiles).toEqual([
            { x: 3482, z: 9496, level: 0 }, { x: 3494, z: 9496, level: 0 },
            { x: 3488, z: 9502, level: 0 }, { x: 3488, z: 9490, level: 0 }
        ]);
        for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
            expect(Math.max(Math.abs(tiles[a].x - tiles[b].x), Math.abs(tiles[a].z - tiles[b].z))).toBeGreaterThan(5);
        }
    });

    test('counts another flying queen after respawn without leaving the chamber', () => {
        const tracker = new QueenTracker();
        for (let kill = 0; kill < 2; kill++) {
            tracker.observe({ id: 1158, health: 255, totalHealth: 255 });
            tracker.observe({ id: 1158, health: 0, totalHealth: 255 });
            expect(tracker.observe({ id: 1160, health: 0, totalHealth: 255 }).dead).toBe(false);
            tracker.observe({ id: 1160, health: 160, totalHealth: 255 });
            tracker.observe({ id: 1160, health: 0, totalHealth: 255 });
            expect(tracker.observe(null).killed).toBe(true);
        }
    });

    test('retreats before another max hit when food or protection is exhausted', () => {
        const healthy = { hp: 80, food: 10, prayer: 40, prayerDoses: 4, escape: true, arrows: 100 };
        expect(retreatReason(healthy)).toBeNull();
        expect(retreatReason({ ...healthy, hp: 31 })).toBeTruthy();
        expect(retreatReason({ ...healthy, food: 0 })).toBeTruthy();
        expect(retreatReason({ ...healthy, prayer: 8, prayerDoses: 0 })).toBeTruthy();
        expect(retreatReason({ ...healthy, escape: false })).toBeTruthy();
        expect(retreatReason({ ...healthy, arrows: 0 })).toBeTruthy();
    });
});

test('a respawn clears the prior kill time so the next kill can be counted in the same trip', () => {
    const tracker = new QueenTracker();
    tracker.observe({ id: 1158, health: 255, totalHealth: 255 }, 1000);
    tracker.observe({ id: 1160, health: 200, totalHealth: 255 }, 5000);
    tracker.observe({ id: 1160, health: 0, totalHealth: 255 }, 9000);
    tracker.observe(null, 10000);
    expect(tracker.killedAt).toBe(10000);
    expect(tracker.lastKillMs).toBe(9000);
    tracker.observe({ id: 1158, health: 255, totalHealth: 255 }, 70000);
    expect(tracker.killedAt).toBe(0);
    tracker.observe({ id: 1160, health: 200, totalHealth: 255 }, 75000);
    tracker.observe({ id: 1160, health: 0, totalHealth: 255 }, 79000);
    expect(tracker.observe(null, 80000).killed).toBe(true);
    expect(tracker.lastKillMs).toBe(10000);
});


test('team communication reports changes without logging every heartbeat', () => {
    const messages: string[] = [];
    const party = new Party(names, 'one', 'one', message => messages.push(message));
    party.receive(member('two'), 100);
    expect(messages).toHaveLength(1);
    party.receive(member('two', { tile: { x: 3227, z: 3108, level: 0 } }), 200);
    expect(messages).toHaveLength(1);
    party.receive(member('two', { stage: 'retreat', ready: false, reason: 'food reserve reached' }), 300);
    expect(messages.at(-1)).toContain('food reserve reached');
    expect(messages.at(-1)).toContain('two');
});

test('repeated release broadcasts produce one visible message', () => {
    const messages: string[] = [];
    const party = new Party(names, 'one', 'one', message => messages.push(message));
    const release = { stage: 'surface', trip: 1, sessions: names, at: 100 };
    party.accept(release, 100); party.accept(release, 200);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('surface');
    expect(party.messages).toEqual(messages);
});

test('lure anchors start beyond either forms attack range', () => {
    for (let x = 3464; x <= 3510; x++) {
        const queen = { x, z: 9498, level: 0 };
        const target = lureTile(queen);
        expect(Math.max(Math.abs(target.x - queen.x), Math.abs(target.z - queen.z)) - 2).toBeGreaterThan(15);
    }
});
