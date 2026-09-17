import { expect, test } from 'bun:test';
import { Party } from '../../src/bot/scripts/JiveKQ/party.js';
import { approachQueen, pullQueen, QueenSearch } from '../../src/bot/scripts/JiveKQ/search.js';

const queen = { x: 3478, z: 9510, level: 0 };
const here = { x: 3508, z: 9493, level: 0 };

test('a lost queen is approached from the most recent sighting', () => {
    const search = new QueenSearch();
    const target = search.next(here, { id: 1160, tile: queen, at: 1000, engaged: false }, 1100, () => true)!;
    expect(Math.max(Math.abs(target.x - queen.x), Math.abs(target.z - queen.z))).toBe(6);
    expect(target.x).toBeLessThan(here.x);
});

test('an old sighting cannot keep the search pinned to an empty position', () => {
    const search = new QueenSearch();
    expect(search.next(here, { id: 1160, tile: queen, at: 1000, engaged: false }, 10000, () => true)).toEqual({ x: 3488, z: 9496, level: 0 });
});

test('reaching an empty waypoint continues a circuit of distinct chamber positions', () => {
    const search = new QueenSearch();
    let tile = here;
    const visited = new Set<string>();
    for (let i = 0; i < 6; i++) {
        tile = search.next(tile, null, 1000 + i * 1000, () => true)!;
        visited.add(`${tile.x},${tile.z}`);
    }
    expect(visited.size).toBe(6);
});

test('an unreachable waypoint uses nearby accessible ground and a stalled step advances', () => {
    const search = new QueenSearch();
    const usable = (p: typeof here) => !(p.x === 3488 && p.z === 9496);
    const first = search.next(here, null, 1000, usable);
    expect(first).not.toEqual({ x: 3488, z: 9496, level: 0 });
    expect(search.next(here, null, 9001, usable)).not.toEqual(first);
});

test('a search with no accessible floor does not issue a wall destination', () => {
    expect(new QueenSearch().next(here, null, 1000, () => false)).toBeNull();
    expect(approachQueen(queen, here, () => false)).toBeNull();
});

test('approach tiles stay outside the queen footprint and obey reachability', () => {
    const target = approachQueen(queen, here, p => p.x < queen.x)!;
    expect(target.x).toBeLessThan(queen.x);
    expect(Math.max(Math.abs(target.x - queen.x), Math.abs(target.z - queen.z))).toBe(6);
});

test('a pull goes beyond attack range along a valid body route to an open cross', () => {
    for (const phase of ['melee', 'ranged'] as const) {
        const target = pullQueen(queen, phase, p => p.z === queen.z - 2, () => true, () => true)!;
        expect(target.x).toBe(queen.x);
        expect(target.z).toBe(queen.z - 2 - (phase === 'melee' ? 18 : 13));
    }
});

test('a narrow blocked body route cannot be used even when the player can stand at its end', () => {
    expect(pullQueen(queen, 'ranged', () => true, () => false, () => true)).toBeNull();
    expect(pullQueen(queen, 'ranged', p => p.x > queen.x, (from, to) => to.x > from.x, () => true)).toEqual({ x: queen.x + 14, z: queen.z, level: 0 });
});

test('a stalled pull tries a different open direction', () => {
    const a = pullQueen(queen, 'ranged', () => true, () => true, () => true, 0);
    const b = pullQueen(queen, 'ranged', () => true, () => true, () => true, 1);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toEqual(b);
});

test('party messages preserve the observation time instead of refreshing old sightings', () => {
    const party = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    const member = { name: 'two', session: 'two', trip: 1, stage: 'fight', tile: here, ready: true, queen: { id: 1160, tile: queen, at: 1000, engaged: true } };
    party.receive(member, 2000);
    expect(party.members(2000)[0].queen).toEqual(member.queen);
    party.receive(member, 10000);
    expect(party.members(10000)[0].queen).toBeUndefined();
});

test('malformed, wrong-floor and future queen reports cannot direct the party', () => {
    for (const sighting of [
        { id: 1, tile: queen, at: 1000, engaged: false },
        { id: 1160, tile: { ...queen, level: 2 }, at: 1000, engaged: false },
        { id: 1160, tile: queen, at: 5000, engaged: false },
        { id: 1160, tile: queen, at: 1000, engaged: 'true' }
    ]) {
        const party = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
        party.receive({ name: 'two', session: 'two', trip: 1, stage: 'fight', tile: here, ready: true, queen: sighting }, 1000);
        expect(party.members(1000)[0].queen).toBeUndefined();
    }
});
