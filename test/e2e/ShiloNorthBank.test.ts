import { expect, test } from 'bun:test';
import { assessNorthTrip, type NorthSample } from '../../e2e/fisher-shilo/north-contract.js';
import { parseNorthServer, verifyNorthServer } from '../../e2e/fisher-shilo/north-server.js';
import { CASES } from '../../e2e/manifest.js';

const sample = (patch: Partial<NorthSample>): NorthSample => ({
    at: 0, tick: 1, x: 2852, z: 2954, level: 0, fish: 0, used: 2, xp: 100,
    bankOpen: false, bankFish: 0, ...patch
});
const trip = [
    sample({}), sample({ x: 2832, z: 2973 }), sample({ x: 2850, z: 2977, fish: 1, xp: 150 }),
    sample({ x: 2850, z: 2977, fish: 26, used: 28, xp: 1400 }),
    sample({ x: 2832, z: 2973, fish: 26, used: 28, xp: 1400 }),
    sample({ bankOpen: true, bankFish: 26, xp: 1400 }),
    sample({ x: 2832, z: 2973, xp: 1400 }),
    sample({ x: 2850, z: 2977, fish: 1, xp: 1450 })
].map((value, index) => ({ ...value, tick: index * 20 + 1 }));

test('accepts full north catch, bank deposit, and second north catch via bridge', () => {
    expect(assessNorthTrip(trip)).toBe('pass');
});
test('rejects one catch without bank return', () => {
    expect(assessNorthTrip(trip.slice(0, 3))).toBe('pending');
});
test('rejects catches on the south bank', () => {
    expect(() => assessNorthTrip([sample({}), sample({ fish: 1, xp: 150 })])).toThrow('south');
});
test('rejects a north teleport rather than normal movement', () => {
    expect(() => assessNorthTrip([sample({}), sample({ z: 2977 })])).toThrow('jump');
});

const server = Array.from({ length: 20 }, (_, tick) => ({ at: tick * 200, tick,
    spots: [{ x: 2850, z: 2976, level: 0 }, { x: 2855, z: 2977, level: 0 }, { x: 2860, z: 2976, level: 0 }],
    player: { x: 2852, z: 2954, level: 0 } }));
test('accepts stationary server spots and normal player positions', () => {
    expect(() => verifyNorthServer(server)).not.toThrow();
});
test('rejects a migrated south spot in authoritative observations', () => {
    const rows = server.map((row, i) => i === 10 ? { ...row, spots: [{ x: 2855, z: 2973, level: 0 }] } : row);
    expect(() => verifyNorthServer(rows)).toThrow('stationary');
});
test('rejects player teleport in authoritative observations', () => {
    const rows = server.map((row, i) => i === 10 ? { ...row, player: { x: 2855, z: 2978, level: 0 } } : row);
    expect(() => verifyNorthServer(rows)).toThrow('teleport');
});
test('parses only the named test player from the server boundary', () => {
    const text = JSON.stringify({ at: 1, tick: 1, spots: [], players: [{ username: 'test', x: 1, z: 2, level: 0 }] });
    expect(parseNorthServer(text, 'test')[0]?.player).toEqual({ x: 1, z: 2, level: 0 });
});
test('keeps the private-world scenario out of automatic suites', () => {
    expect(CASES.find(entry => entry.id === 'shilo-north-bank-live')?.manual).toBe(true);
});
