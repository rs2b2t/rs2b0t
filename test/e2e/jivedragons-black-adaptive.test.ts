import { expect, test } from 'bun:test';
import { assessAdaptiveStand, assessAlternateFights } from '../../e2e/jivedragons-black-adaptive.js';

const before = { anchor: 0, moving: false, owned: false, stands: [
    { x: 2836, z: 9817, gap: 5, los: false }, { x: 2835, z: 9817, gap: 5, los: false }, { x: 2834, z: 9817, gap: 5, los: true }
] };
test('accepts western only when body2837,9822 makes it the ready existing stand', () => {
    expect(assessAdaptiveStand(before, 2)).toEqual([]);
    expect(assessAdaptiveStand(before, 1)).toContain('alternate-not-ready');
});
test('requires nearer middle when body2837,9823 makes both alternates ready', () => {
    const pose = { ...before, stands: before.stands.map(s => ({ ...s, gap: 6, los: s.x !== 2836 })) };
    expect(assessAdaptiveStand(pose, 1)).toEqual([]);
    expect(assessAdaptiveStand(pose, 2)).toContain('nearer-ready-stand');
});
test('keeps selected anchor latched while moving', () => {
    expect(assessAdaptiveStand({ ...before, anchor: 2, moving: true }, 1)).toContain('anchor-unlatched');
});
test('does not rotate an owned target or a ready current anchor', () => {
    expect(assessAdaptiveStand({ ...before, owned: true }, 2)).toContain('owned-anchor-changed');
    expect(assessAdaptiveStand({ ...before, stands: before.stands.map(s => ({ ...s, los: true })) }, 2)).toContain('ready-anchor-changed');
});
test('rejects row9818 even with clear LOS', () => {
    expect(assessAdaptiveStand({ ...before, stands: before.stands.map(s => ({ ...s, z: 9818 })) }, 2)).toContain('outside-existing-stands');
});
test('requires three unique authoritative fights without walkouts or melee hits', () => {
    const fight = { nid: 7, life: 1, anchorX: 2834, anchorZ: 9817, authoritativeDeath: true, attackWalkouts: 0, meleeHits: 0 };
    expect(assessAlternateFights([fight, fight, fight]).passed).toBe(false);
    const fights = [1, 2, 3].map(life => ({ ...fight, life }));
    expect(assessAlternateFights(fights).passed).toBe(true);
    expect(assessAlternateFights([...fights, { ...fight, meleeHits: 1 }]).passed).toBe(false);
    expect(assessAlternateFights([...fights, { ...fight, attackWalkouts: 1 }]).passed).toBe(false);
});
