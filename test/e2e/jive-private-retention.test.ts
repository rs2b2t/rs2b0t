import { expect, test } from 'bun:test';
import { privateHardCapture } from '../../e2e/jive-private-hard.js';
import { privateReport } from '../../e2e/jive-private-report.js';
import { parsePrivateFrame } from '../../e2e/jive-private-server.js';
import type { PrivateEvent, PrivateFrame } from '../../e2e/jive-private-types.js';

const user = 'jc-retention';
function episode() {
    const clue = { id: 3544, count: 1 };
    const base: PrivateEvent = { at: 1000, tick: 1, kind: 'solver-start', action: '', itemId: -1,
        inventory: [clue, { id: 2448, count: 1 }, { id: 385, count: 20 }], bank: [], bankConfirmed: true,
        hp: 77, maxHp: 77, sharks: 20, used: 22, weaponId: 861, special: 1000, antipoisonDoses: 4,
        attack: 75, lostCity: true, clueHeld: true, status: 'idle', tile: { x: 2946, z: 3369, level: 0 },
        manifest: [], modalId: -1, ground: [], consumed: [], progress: null };
    const events: PrivateEvent[] = [base, { ...base, at: 1100, kind: 'solver-end', status: 'hard kit: dds' },
        { ...base, at: 1200, kind: 'host-resume', inventory: [], bank: [clue], clueHeld: false },
        { ...base, at: 1300, kind: 'tick', inventory: [], bank: [clue], clueHeld: false }];
    const frames: PrivateFrame[] = [950, 1050, 1150, 1250, 1350].map(at => ({ at, tick: at, fixture: 'fixture', guardians: [], players: [
        { username: user, hp: 77, inventory: at < 1150 ? [clue] : [], bank: at < 1150 ? [] : [clue], trailStatus: 133, ground: [] }] }));
    return { events, frames };
}

test('accepts observed refusal with one clue transferred to the same account bank', () => {
    const { events, frames } = episode();
    const report = privateReport({ scenario: 'missing-dds', user, events, frames });
    expect(report.passed).toBe(true);
});

test('rejects authoritative loss even when the client still claims the clue', () => {
    const { events, frames } = episode();
    const claimed = events.map(e => ({ ...e, clueHeld: true }));
    const lost = frames.map(f => ({ ...f, players: f.players.map(p => ({ ...p, inventory: [], bank: [] })) }));
    expect(privateHardCapture(claimed, lost, user).passed).toBe(false);
});

test('rejects a transient authoritative loss between otherwise retained client samples', () => {
    const { events, frames } = episode();
    const f = frames[2];
    const gap = { ...f, at: 1160, players: f.players.map(p => ({ ...p, inventory: [], bank: [] })) };
    const restored = { ...f, at: 1190 };
    expect(privateHardCapture(events, [...frames, gap, restored].sort((a, b) => a.at - b.at), user).passed).toBe(false);
});

test.each(['absent', 'stale', 'wrong-account', 'missing-account'])('rejects %s authoritative retention', mode => {
    const { events, frames } = episode();
    const changed = mode === 'absent' ? [] : frames.map(f => mode === 'stale' ? { ...f, at: f.at - 1000 }
        : { ...f, players: mode === 'missing-account' ? [] : f.players.map(p => ({ ...p, username: 'foreign' })) });
    expect(privateHardCapture(events.map(e => ({ ...e, clueHeld: true })), changed, user).passed).toBe(false);
});

test('does not count a foreign bank clue alongside an empty intended account', () => {
    const { events, frames } = episode();
    const foreign = frames.map(f => ({ ...f, players: [
        { ...f.players[0], inventory: [], bank: [] }, { ...f.players[0], username: 'foreign', inventory: [], bank: [{ id: 3544, count: 1 }] }] }));
    expect(privateHardCapture(events, foreign, user).passed).toBe(false);
});

test('rejects missing bank observations at the frame parser boundary', () => {
    const raw = { at: 1000, tick: 1, fixture: 'fixture', guardians: [], players: [
        { username: user, hp: 77, inventory: [], trailStatus: 133, ground: [] }] };
    expect(() => parsePrivateFrame(raw)).toThrow();
});

test('rejects absent refusal despite retained account quantity', () => {
    const { events, frames } = episode();
    expect(privateHardCapture(events.filter(e => e.kind !== 'solver-end'), frames, user).passed).toBe(false);
});

test('rejects a dig despite retained account quantity', () => {
    const { events, frames } = episode();
    expect(privateReport({ scenario: 'missing-dds', user, events: [...events, { ...events[3], kind: 'inventory-action', action: 'Dig', itemId: 952 }], frames }).passed).toBe(false);
});

test('rejects a guardian despite retained account quantity', () => {
    const { events, frames } = episode();
    frames[2] = { ...frames[2], guardians: [{ nid: 1, life: '1:1150', name: 'Saradomin Wizard', hp: 120, owner: user, active: true }] };
    expect(privateReport({ scenario: 'missing-dds', user, events, frames }).passed).toBe(false);
});

test('rejects explicit clue drop even if sampled frames claim retention', () => {
    const { events, frames } = episode();
    expect(privateHardCapture([...events, { ...events[3], kind: 'inventory-action', action: 'Drop', itemId: 3544 }], frames, user).passed).toBe(false);
});

test('does not count an owned ground clue as bank retention', () => {
    const { events, frames } = episode();
    const ground = frames.map(f => ({ ...f, players: f.players.map(p => ({ ...p, inventory: [], bank: [], ground: [{ id: 3544, count: 1, owned: true }] })) }));
    expect(privateHardCapture(events, ground, user).passed).toBe(false);
});
