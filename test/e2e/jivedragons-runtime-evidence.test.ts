import { expect, test } from 'bun:test';
import { candidateRuntimeEvidence } from '../../e2e/jivedragons-runtime-evidence.js';
import { assessAlternateFights } from '../../e2e/jivedragons-black-adaptive.js';

const atSafe = { x: 2836, z: 9817 };
const sample = { at: 100, kind: 'tick', tile: atSafe, anchor: atSafe, anchorIndex: 0, npcs: [], engaged: null,
    used: 28, sharks: 1, hpFraction: 1, panicHp: 0.3, retreatHp: 0.5, foodReserve: 4, requiredSupplies: true,
    inventory: [], equipment: [], ground: [] };
test('normalizes last-food room from actual inventory deltas', () => {
    const events = [{ ...sample, kind: 'inventory-action', action: 'Drop', item: 'Shark' }, { ...sample, at: 200, used: 27, sharks: 0 }];
    expect(candidateRuntimeEvidence(events, []).capacity[0]?.roomConfirmed).toBe(true);
});
test('rejects leaving with last food unrecovered without emergency', () => {
    const events = [{ ...sample, kind: 'inventory-action', action: 'Drop', item: 'Shark' },
        { ...sample, at: 200, used: 27, sharks: 0 }, { ...sample, at: 300, sharks: 0, tile: { x: 2965, z: 3380 } }];
    expect(candidateRuntimeEvidence(events, []).violations).toContain('last-food-exit-before-recovery');
});
test('does not invent network coverage from old rendered-only captures', () => {
    expect(candidateRuntimeEvidence([sample], []).networkObserved).toBe(false);
});
test('joins three alternate fights to authoritative lifetimes and player positions', () => {
    const anchor = { x: 2834, z: 9817 };
    const events = [0, 600, 1200].flatMap(base => [100, 300, 400].map(offset => ({ ...sample, at: base + offset,
        tile: anchor, anchor, hp: 99, playerName: 'proof', kind: offset === 100 ? 'npc-action' : 'tick', action: 'Attack', index: 7,
        npcs: [{ index: 7, size: 4, networkOrigin: { x: 2837, z: 9822 }, networkTile: { x: 2839, z: 9824 }, networkGap: 5,
            networkLos: true, routeLength: 1, other: false, combat: false }] })));
    const frames = [0, 600, 1200].flatMap((base, index) => [0, 200, 400].map(offset => ({ at: base + offset,
        players: [{ username: 'proof', ...anchor, hp: 99 }],
        dragons: [{ nid: 7, life: index + 1, hp: offset === 400 ? 0 : 190, active: true, stands: [{ ...anchor, gap: 5, los: true }] }] })));
    const result = candidateRuntimeEvidence(events, frames);
    expect(assessAlternateFights(result.fights).passed).toBe(true);
    expect(result.networkObserved).toBe(true);
    expect(result.movingReadyAttacks).toBe(3);
    const walkout = frames.map(f => f.at === 200 ? { ...f, players: [{ username: 'proof', x: 2834, z: 9818, hp: 99 }] } : f);
    expect(assessAlternateFights(candidateRuntimeEvidence(events, walkout).fights).passed).toBe(false);
});
test('does not lose last-food tracking to a stale inventory sample', () => {
    const events = [{ ...sample, kind: 'inventory-action', action: 'Drop', item: 'Shark' }, { ...sample, at: 150 },
        { ...sample, at: 200, sharks: 0, used: 27 }, { ...sample, at: 300, kind: 'decision', task: 'BankRun', sharks: 0 }];
    expect(candidateRuntimeEvidence(events, []).violations).toContain('last-food-exit-before-recovery');
});
test('allows a true emergency after freeing the last food', () => {
    const events = [{ ...sample, kind: 'inventory-action', action: 'Drop', item: 'Shark' },
        { ...sample, at: 200, sharks: 0, used: 27 }, { ...sample, at: 300, sharks: 0, hpFraction: 0.2, tile: { x: 2965, z: 3380 } }];
    expect(candidateRuntimeEvidence(events, []).violations).toEqual([]);
});
test('normalizes an actual PanicBank escape even after a slot was freed', () => {
    const decision = { ...sample, kind: 'decision', task: 'PanicBank', used: 27, sharks: 0, hpFraction: 0.2 };
    const result = candidateRuntimeEvidence([decision, { ...decision, at: 300, kind: 'tick', tile: { x: 2965, z: 3380 } }], []);
    expect(result.capacity[0]?.escaped).toBe(true);
    expect(result.capacity[0]?.full).toBe(false);
});
test('does not credit a potion-freed slot as food-capacity proof', () => {
    const events = [{ ...sample, kind: 'inventory-action', action: 'Drink', item: 'Ranging potion(1)' }, { ...sample, at: 200, used: 27 }];
    expect(candidateRuntimeEvidence(events, []).capacity).toEqual([]);
});
