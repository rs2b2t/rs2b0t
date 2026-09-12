import { expect, test } from 'bun:test';
import { privateReport } from '../../e2e/jive-private-report.js';
import { parsePrivateFrame } from '../../e2e/jive-private-server.js';
import { privateHardCapture } from '../../e2e/jive-private-hard.js';
import type { PrivateEvent, PrivateFrame } from '../../e2e/jive-private-types.js';

const event = (values: Partial<PrivateEvent>): PrivateEvent => ({ at: 100, tick: 1, kind: 'tick', action: '', itemId: -1,
    inventory: [{ id: 385, count: 27 }], bank: [{ id: 145, count: 7 }], bankConfirmed: true, hp: 77, maxHp: 77,
    sharks: 27, used: 28, weaponId: -1, special: 1000, antipoisonDoses: 0, attack: 1, lostCity: false,
    clueHeld: false, status: 'collecting reward', tile: { x: 2946, z: 3369, level: 0 }, manifest: [], modalId: -1,
    ground: [], consumed: [], progress: null, ...values });

test('fails closed when the private observer is absent', () => {
    const report = privateReport({ scenario: 'reward', user: 'test', events: [], frames: [] });
    expect(report.passed).toBe(false);
});
test('rejects malformed authoritative frames', () => {
    expect(() => parsePrivateFrame({ at: 1, players: [] })).toThrow();
});
test('does not mistake preexisting bank potions for earned rewards', () => {
    const events = [event({ kind: 'inventory-action', action: 'Open', itemId: 3545 }),
        event({ at: 200, manifest: [{ id: 145, count: 9 }], modalId: 6960 }),
        event({ at: 300, kind: 'solved', inventory: [{ id: 145, count: 2 }] })];
    const frames: PrivateFrame[] = events.map(e => ({ at: e.at, tick: e.tick, fixture: 'fixture', guardians: [], players: [
        { username: 'test', hp: 77, inventory: e.inventory, bank: e.bank, trailStatus: 0, ground: [] }] }));
    const report = privateReport({ scenario: 'reward', user: 'test', events, frames });
    expect(report.passed).toBe(false);
    expect(report.reward?.violations).toContain('solved-before-accounted');
});
test('keeps an early departure failure after later reward delivery', () => {
    const events = [event({ kind: 'inventory-action', action: 'Open', itemId: 3545 }),
        event({ at: 200, manifest: [{ id: 145, count: 9 }], modalId: 6960 }),
        event({ at: 250, kind: 'departure' }), event({ at: 300, kind: 'solved', inventory: [{ id: 145, count: 9 }] })];
    const report = privateReport({ scenario: 'reward', user: 'test', events, frames: [] });
    expect(report.reward?.violations).toContain('left-before-accounted');
});

test('accepts nine earned potion units only after full-HP Shark space and server accounting', () => {
    const manifest = [{ id: 145, count: 3 }, { id: 157, count: 3 }, { id: 163, count: 3 }];
    const events = [event({ kind: 'inventory-action', action: 'Open', itemId: 3545 }),
        event({ at: 200, inventory: [{ id: 145, count: 1 }, { id: 385, count: 27 }], manifest, modalId: 6960 }),
        event({ at: 300, kind: 'eat-confirmed', sharks: 26, used: 27, inventory: [{ id: 145, count: 1 }, { id: 385, count: 26 }], consumed: [{ id: 385, count: 1 }] }),
        event({ at: 400, kind: 'solved', sharks: 19, inventory: [...manifest, { id: 385, count: 19 }], consumed: [{ id: 385, count: 8 }] })];
    const frames: PrivateFrame[] = events.map(e => ({ at: e.at, tick: e.tick, fixture: 'fixture', guardians: [], players: [
        { username: 'test', hp: 77, inventory: e.inventory, bank: e.bank, trailStatus: 0, ground: [] }] }));
    expect(privateReport({ scenario: 'reward', user: 'test', events, frames }).passed).toBe(true);
});

test('recognizes the guardian-specific casket without changing manifest requirements', () => {
    const manifest = [{ id: 145, count: 3 }, { id: 157, count: 3 }, { id: 163, count: 3 }];
    const events = [event({ kind: 'inventory-action', action: 'Open', itemId: 3549 }),
        event({ at: 200, manifest, modalId: 6960 })];
    const report = privateReport({ scenario: 'guardian', user: 'test', events, frames: [] });
    expect(report.rewardCapture.manifest).toEqual({ interfaceId: 6963, modalId: 6960, items: manifest });
    expect(report.passed).toBe(false);
});

test('rejects blocked acceptance if a guardian exists with unknown ownership', () => {
    const events = [event({ kind: 'solver-start', clueHeld: true }), event({ at: 200, kind: 'solver-end', clueHeld: true, status: 'hard kit: dds' })];
    const frames: PrivateFrame[] = events.map(e => ({ at: e.at, tick: e.tick, fixture: 'fixture', guardians: [
        { nid: 1, life: '1:1', name: 'Saradomin Wizard', hp: 120, owner: null, active: true }], players: [
        { username: 'test', hp: 77, inventory: e.inventory, bank: e.bank, trailStatus: 5, ground: [] }] }));
    expect(privateReport({ scenario: 'missing-dds', user: 'test', events, frames }).passed).toBe(false);
});

function guardianEpisode() {
    const start = event({ kind: 'solver-start', attack: 75, lostCity: true, weaponId: 861, sharks: 15, antipoisonDoses: 4,
        clueHeld: true, inventory: [{ id: 3544, count: 1 }, { id: 1231, count: 1 }, { id: 2448, count: 1 }, { id: 385, count: 15 }] });
    const armed = { ...start, weaponId: 1231 };
    const events = [start, { ...armed, at: 200, kind: 'inventory-action', action: 'Drink', itemId: 2448 },
        { ...armed, at: 300, kind: 'inventory-action', action: 'Dig', itemId: 952, antipoisonDoses: 3 },
        { ...armed, at: 400, kind: 'tick', hp: 50, antipoisonDoses: 3 },
        { ...armed, at: 500, kind: 'eat-confirmed', hp: 70, sharks: 14, special: 750, antipoisonDoses: 3 },
        { ...armed, at: 700, kind: 'inventory-action', action: 'Dig', itemId: 952, sharks: 14, antipoisonDoses: 3 },
        { ...start, at: 800, kind: 'tick', clueHeld: false }, { ...start, at: 900, kind: 'host-resume', clueHeld: false }];
    const frames: PrivateFrame[] = [350, 650].map(at => ({ at, tick: at, fixture: 'fixture', players: [],
        guardians: [{ nid: 1, life: '1:350', name: 'Saradomin Wizard', hp: at === 350 ? 120 : 0, active: true, owner: 'test' }] }));
    return { events, frames };
}

test('joins a real-death-shaped episode with the fifteen-to-fourteen bite and restoration', () => {
    const { events, frames } = guardianEpisode();
    expect(privateHardCapture(events, frames, 'test').passed).toBe(true);
});
test('never promotes client disappearance to authoritative guardian death', () => {
    const { events, frames } = guardianEpisode();
    expect(privateHardCapture(events, frames.slice(0, 1), 'test').passed).toBe(false);
});
test('rejects host resume before ranged restoration', () => {
    const { events, frames } = guardianEpisode();
    const earlyResume = event({ at: 750, kind: 'host-resume', weaponId: 1231 });
    const report = privateHardCapture([...events, earlyResume].sort((a, b) => a.at - b.at), frames, 'test');
    expect(report.violations).toContain('restoration-before-host-resume');
});
