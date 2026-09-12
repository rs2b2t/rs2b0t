import { expect, test } from 'bun:test';
import { assessBlackRange } from '../../e2e/jivedragons-black-contract.js';

const dragon = { nid: 7, life: 1, x: 2834, z: 9821, hp: 190, active: true, stands: [{ x: 2836, z: 9817, gap: 4, los: true }] };
const npc = { index: 7, origin: { x: 2834, z: 9821 }, combat: false, me: false, other: false, gap: 4, los: true, networkGap: 4, networkLos: true, settledAge: 0, skipRemaining: 0 };
const event = { kind: 'npc-action', action: 'Attack', index: 7, at: 100, tile: { x: 2836, z: 9817 }, anchor: { x: 2836, z: 9817 },
    npcs: [npc], ground: [], engaged: null, hp: 99 };

for (const gap of [8, 10]) test(`rejects rendered gap6 Attack when authoritative gap is ${gap}`, () => {
    const frames = [0, 200].map(at => ({ at, dragons: [{ ...dragon, stands: [{ ...dragon.stands[0], gap }] }] }));
    const result = assessBlackRange([{ ...event, npcs: [{ ...npc, gap: 6 }] }], frames, 'candidate');
    expect(result.unsafeAttacks).toHaveLength(1);
});
for (const gap of [8, 10]) test(`does not call rendered gap6 ready when authoritative gap is ${gap}`, () => {
    const frames = [0, 200, 400, 600].map(at => ({ at, dragons: [{ ...dragon, stands: [{ ...dragon.stands[0], gap }] }] }));
    const events = [100, 300, 500].map(at => ({ ...event, at, kind: 'idle', npcs: [{ ...npc, gap: 6, networkGap: gap, networkLos: true }] }));
    expect(assessBlackRange(events, frames, 'candidate').readinessDelays).toHaveLength(0);
});

test('permits actual Attack within two decisions for a moving latest gap4 target', () => {
    const moving = { ...npc, gap: 8, networkGap: 4, networkLos: true, settledAge: 0 };
    const events = [{ ...event, kind: 'idle', npcs: [moving] }, { ...event, at: 300, npcs: [moving] }];
    const frames = [0, 200, 400].map(at => ({ at, dragons: [dragon] }));
    const result = assessBlackRange(events, frames, 'candidate');
    expect(result.attacks).toBe(1);
    expect(result.readinessDelays).toHaveLength(0);
    expect(result.unsafeAttacks).toHaveLength(0);
});

test('rejects switching away from an authoritative living owned target', () => {
    const frames = [0, 200, 400].map(at => ({ at, dragons: [dragon, { ...dragon, nid: 8 }] }));
    const result = assessBlackRange([event, { ...event, at: 300, index: 8, npcs: [{ ...npc, index: 8 }] }], frames, 'candidate');
    expect(result.ownedChanges).toHaveLength(1);
});

test('accepts moving latest gap4 readiness despite lagged rendered gap8', () => {
    const events = [100, 300, 500].map(at => ({ ...event, kind: 'idle', at,
        npcs: [{ ...npc, gap: 8, networkGap: 4, networkLos: true }] }));
    const frames = [0, 200, 400, 600].map(at => ({ at, dragons: [dragon] }));
    expect(assessBlackRange(events, frames, 'candidate').readinessDelays).toHaveLength(1);
});

test('rejects Take when the attacked spawn is alive despite cleared client combat state', () => {
    const events = [event, { ...event, kind: 'ground-action', action: 'Take', item: 'Rune arrow', at: 300, index: undefined }];
    const frames = [0, 200, 400].map(at => ({ at, dragons: [dragon] }));
    const result = assessBlackRange(events, frames);
    expect(result.prekillTakes).toHaveLength(1);
});
test('rejects food Drop while the authoritative owned spawn is alive', () => {
    const events = [event, { ...event, at: 300, kind: 'inventory-action', action: 'Drop', item: 'Shark' }];
    const frames = [0, 200, 400].map(at => ({ at, dragons: [dragon] }));
    expect(assessBlackRange(events, frames, 'candidate').fightPreemptions).toHaveLength(1);
});

test('does not treat a new life at the same index as the previous victim', () => {
    const events = [event, { ...event, kind: 'ground-action', action: 'Take', item: 'Rune arrow', at: 500 }];
    const frames = [{ at: 0, dragons: [dragon] }, { at: 200, dragons: [{ ...dragon, hp: 0 }] },
        { at: 400, dragons: [{ ...dragon, life: 2 }] }, { at: 600, dragons: [{ ...dragon, life: 2 }] }];
    const result = assessBlackRange(events, frames);
    expect(result.prekillTakes).toHaveLength(0);
});

test('reports missing authoritative timing rather than accepting client disappearance', () => {
    const result = assessBlackRange([event], []);
    expect(result.passed).toBe(false);
    expect(result.unjoinedActions).toBe(1);
});

test('rejects three eligible scheduled decisions without an Attack', () => {
    const events = [100, 300, 500].map(at => ({ ...event, kind: 'idle', at, action: undefined }));
    const frames = [0, 200, 400, 600].map(at => ({ at, dragons: [dragon] }));
    const result = assessBlackRange(events, frames);
    expect(result.readinessDelays).toHaveLength(1);
});

test('does not demand a new Attack during an owned attack gap', () => {
    const events = [event, ...[300, 500, 700].map(at => ({ ...event, kind: 'idle', at, action: undefined, engaged: 7 }))];
    const frames = [0, 200, 400, 600, 800].map(at => ({ at, dragons: [dragon] }));
    const result = assessBlackRange(events, frames);
    expect(result.readinessDelays).toHaveLength(0);
});

test('rejects an Attack on another players claim', () => {
    const result = assessBlackRange([{ ...event, npcs: [{ ...npc, other: true, combat: true }] }],
        [0, 200].map(at => ({ at, dragons: [dragon] })));
    expect(result.friendlySteals).toHaveLength(1);
});

test('fails empty evidence instead of passing vacuously', () => {
    const result = assessBlackRange([], []);
    expect(result.passed).toBe(false);
});

test('does not count equipment or eating tasks as attack-ready decisions', () => {
    const events = [100, 300, 500].map(at => ({ ...event, kind: 'decision', at, action: undefined, status: 'equipping Rune arrow' }));
    const frames = [0, 200, 400, 600].map(at => ({ at, dragons: [dragon] }));
    expect(assessBlackRange(events, frames).readinessDelays).toHaveLength(0);
});

test('does not credit a death after the captured run ended', () => {
    const frames = [{ at: 0, dragons: [dragon] }, { at: 200, dragons: [dragon] }, { at: 1000, dragons: [{ ...dragon, hp: 0 }] }];
    expect(assessBlackRange([event], frames).kills).toBe(0);
});

test('keeps an observed Fight engagement across a respawn-boundary Attack sample', () => {
    const events = [event, ...[300, 500, 700].map(at => ({ ...event, at, kind: 'idle', action: undefined, engaged: 7 }))];
    const frames = [{ at: 0, dragons: [{ ...dragon, hp: 0, active: false }] },
        ...[200, 400, 600, 800].map(at => ({ at, dragons: [{ ...dragon, life: 2 }] }))];
    expect(assessBlackRange(events, frames).readinessDelays).toHaveLength(0);
});
test('does not demand a new target while the previous death still awaits completion', () => {
    const events = [100, 300, 500].map(at => ({ ...event, at, kind: 'idle', action: undefined, engaged: 7, lootTarget: 7,
        npcs: [npc, { ...npc, index: 8 }] }));
    const frames = [0, 200, 400, 600].map(at => ({ at, dragons: [{ ...dragon, hp: 0 }, { ...dragon, nid: 8 }] }));
    expect(assessBlackRange(events, frames).readinessDelays).toHaveLength(0);
});

for (const itemCount of [1, 2, 3]) test(`rejects Blue Rune pile${itemCount} even when separate piles total4 or more`, () => {
    const capture = { ...event, site: 'blue', kind: 'ground-action', action: 'Take', item: 'Rune arrow', itemCount,
        ground: [{ name: 'Rune arrow', count: itemCount }, { name: 'Rune arrow', count: 4 }] };
    const result = assessBlackRange([capture], [0, 200].map(at => ({ at, dragons: [dragon] })), 'candidate');
    expect(result.smallArrowTakes).toHaveLength(1);
});
for (const itemCount of [4, 5]) test(`permits Blue Rune pile${itemCount} after death when no victim is owned`, () => {
    const capture = { ...event, site: 'blue', kind: 'ground-action', action: 'Take', item: 'Rune arrow', itemCount };
    const result = assessBlackRange([capture], [0, 200].map(at => ({ at, dragons: [dragon] })), 'candidate');
    expect(result.smallArrowTakes).toHaveLength(0);
});
test('rejects missing pile quantity rather than guessing from nearby stacks', () => {
    const capture = { ...event, site: 'blue', kind: 'ground-action', action: 'Take', item: 'Rune arrow' };
    const result = assessBlackRange([capture], [0, 200].map(at => ({ at, dragons: [dragon] })), 'candidate');
    expect(result.smallArrowTakes).toHaveLength(1);
});
for (const network of [{ networkGap: undefined, networkLos: undefined }, { networkGap: 7, networkLos: true },
    { networkGap: 6, networkLos: false }]) test(`rejects Attack without safe latest-network evidence ${JSON.stringify(network)}`, () => {
    const result = assessBlackRange([{ ...event, npcs: [{ ...npc, ...network }] }],
        [0, 200].map(at => ({ at, dragons: [dragon] })), 'candidate');
    expect(result.unsafeAttacks).toHaveLength(1);
});
test('rejects leashing a far unowned dragon even without an Attack', () => {
    const capture = { ...event, kind: 'leash-start', npcs: [{ ...npc, networkGap: 8 }] };
    const result = assessBlackRange([capture], [0, 200].map(at => ({ at, dragons: [dragon] })), 'candidate');
    expect(result.unsafeLeashes).toHaveLength(1);
});
test('does not flag an owned-fight leash as new far-target acquisition', () => {
    const capture = { ...event, at: 300, kind: 'leash-start', engaged: 7, npcs: [{ ...npc, networkGap: 8 }] };
    const result = assessBlackRange([event, capture], [0, 200, 400].map(at => ({ at, dragons: [dragon] })), 'candidate');
    expect(result.unsafeLeashes).toHaveLength(0);
});
test('does not demand an Attack from rendered readiness when latest-network evidence is absent', () => {
    const captures = [100, 300, 500].map(at => ({ ...event, at, kind: 'idle',
        npcs: [{ ...npc, networkGap: undefined, networkLos: undefined }] }));
    const result = assessBlackRange(captures, [0, 200, 400, 600].map(at => ({ at, dragons: [dragon] })), 'candidate');
    expect(result.readinessDelays).toHaveLength(0);
});
