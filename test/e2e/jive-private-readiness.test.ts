import { afterEach, beforeEach, expect, setSystemTime, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as fixture from '../../e2e/jive-private-fixture.js';
import { candidateRoot, privateEngine } from '../../e2e/jive-private-boundary.mjs';

const now = 1800000000000;
const user = 'jcfixture';
let root: string;
let server: string;
const client = {
    trailStatus: 0, hp: 77, lostCity: true,
    levels: { attack: 75, strength: 75, defence: 75, hitpoints: 77, prayer: 70 },
    inventory: [{ id: 3544, count: 1 }, { id: 385, count: 20 }, { id: 2448, count: 1 }],
    bank: { error: null, items: [] }, worn: [{ id: 861, count: 1 }],
};
const player = { username: user, hp: 77, trailStatus: 133, inventory: client.inventory, bank: [], ground: [] };
const frame = { at: now - 100, tick: 240, engine: privateEngine, candidate: candidateRoot,
    fixture: 'a'.repeat(64), players: [player], guardians: [] };
const observation = () => ({ server, user, since: now - 200 });

beforeEach(() => {
    setSystemTime(now);
    root = mkdtempSync(join(tmpdir(), 'private-readiness-'));
    server = join(root, 'observer.jsonl');
    writeFileSync(server, JSON.stringify(frame) + '\n');
});
afterEach(() => { setSystemTime(); rmSync(root, { recursive: true, force: true }); });

test('accepts server133 with client0 when the sole-account frame follows setup', async () => {
    const result = await fixture.verifyPrivateClue(client, 'missing-dds', observation());
    expect(result).toBeUndefined();
});

test.each([0, 5, 128, 132, 149, 261, false, null, undefined])('rejects incorrect or missing full server trail state %s', async trailStatus => {
    writeFileSync(server, JSON.stringify({ ...frame, players: [{ ...player, trailStatus }] }) + '\n');
    await expect(fixture.verifyPrivateClue({ ...client, trailStatus: 133 }, 'missing-dds', observation())).rejects.toThrow();
});

test.each([
    { ...frame, at: now - 1000 },
    { ...frame, at: now - 201 },
    { ...frame, at: now + 1 },
    { ...frame, players: [] },
    { ...frame, players: [{ ...player, username: 'other' }] },
    { ...frame, players: [player, { ...player, username: 'other' }] },
    { ...frame, engine: '/shared/engine' },
    { ...frame, candidate: '/other/candidate' },
])('rejects stale, pre-setup, future or incorrectly attested frames %#', async invalid => {
    writeFileSync(server, JSON.stringify(invalid) + '\n');
    await expect(fixture.verifyPrivateClue(client, 'missing-dds', observation())).rejects.toThrow();
});

test.each(['', JSON.stringify(frame), '{broken}\n'])('rejects empty, incomplete or malformed traces %#', async trace => {
    writeFileSync(server, trace);
    await expect(fixture.verifyPrivateClue(client, 'missing-dds', observation())).rejects.toThrow();
});

test('rejects a missing observer file', async () => {
    await expect(fixture.verifyPrivateClue(client, 'missing-dds', { ...observation(), server: join(root, 'absent') })).rejects.toThrow();
});

test('rejects a latest mismatch even when an earlier frame matches', async () => {
    writeFileSync(server, [frame, { ...frame, at: now, players: [{ ...player, trailStatus: 0 }] }].map(f => JSON.stringify(f) + '\n').join(''));
    await expect(fixture.verifyPrivateClue(client, 'missing-dds', observation())).rejects.toThrow();
});

test.each([
    { ...client, hp: 76 },
    { ...client, lostCity: false },
    { ...client, levels: { ...client.levels, attack: 74 } },
    { ...client, bank: { error: 'unconfirmed', items: [] } },
    { ...client, inventory: [{ id: 3544, count: 1 }, { id: 385, count: 14 }, { id: 2448, count: 1 }] },
    { ...client, worn: [] },
])('preserves client fixture checks for transmitted state %#', async invalid => {
    await expect(fixture.verifyPrivateClue(invalid, 'missing-dds', observation())).rejects.toThrow();
});
