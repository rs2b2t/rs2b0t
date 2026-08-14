import { describe, expect, test } from 'bun:test';

import { defById } from '#/bot/api/ai/quests/defs/index.js';
import { IMP_BEADS, IMP_FIELD, IMP_SPAWNS, MIZGOG, decide, gatherBead, impcatcher, nearestReachable, pickImp, type ImpCandidate } from '#/bot/api/ai/quests/defs/impcatcher.js';
import { pickPreferred } from '#/bot/api/ai/quests/exec/primitives.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

interface SnapOpts {
    inv?: [string, number][];
    invIds?: [number, number][];
    bank?: [string, number][];
    bankIds?: [number, number][];
    bankKnown?: boolean;
}

const snap = (journal: string, opts: SnapOpts = {}): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(opts.inv ?? []),
    invIds: new Map(opts.invIds ?? []),
    worn: new Set(),
    noProgress: 0,
    bankCoins: 0,
    bank: new Map(opts.bank ?? []),
    bankIds: new Map(opts.bankIds ?? []),
    bankKnown: opts.bankKnown ?? true
});

const allBeads = (): [string, number][] => IMP_BEADS.map(bead => [bead.name.toLowerCase(), 1] as [string, number]);

describe('impcatcher decide', () => {
    test('complete -> done', () => {
        expect(decide(snap('complete')).kind).toBe('done');
    });

    test('unknown -> wait, never a restart of a finished quest', () => {
        const step = decide(snap('unknown'));
        expect(step.kind).toBe('wait');
    });

    test('notStarted -> talk to Wizard Mizgog', () => {
        const step = decide(snap('notStarted'));
        expect(step.kind === 'talk' && step.stop.npc).toBe('Wizard Mizgog');
    });

    test('all four beads held -> hand them to Mizgog', () => {
        const step = decide(snap('inProgress', { inv: allBeads() }));
        expect(step.kind === 'talk' && step.stop.npc).toBe('Wizard Mizgog');
    });

    test('one bead short -> farm imps rather than walk to Mizgog', () => {
        const step = decide(snap('inProgress', { inv: allBeads().slice(1) }));
        expect(step.kind).toBe('custom');
    });

    test('beads counted by object id when the name map is empty', () => {
        const byId = IMP_BEADS.map(bead => [bead.id, 1] as [number, number]);
        const step = decide(snap('inProgress', { invIds: byId }));
        expect(step.kind === 'talk' && step.stop.npc).toBe('Wizard Mizgog');
    });
});

describe('impcatcher gatherBead', () => {
    test('an unread bank is scanned before a walk to the imps', () => {
        const step = gatherBead(snap('inProgress', { bankKnown: false }));
        expect(step.kind).toBe('scanBank');
    });

    test('banked beads are withdrawn by id before any imp is killed', () => {
        const step = gatherBead(snap('inProgress', {
            bankKnown: true,
            bank: [['red bead', 1], ['white bead', 2]],
            bankIds: [[1470, 1], [1476, 2]]
        }));
        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items.map(item => item.id).sort()).toEqual([1470, 1476]);
        expect(step.kind === 'withdraw' && step.items.every(item => item.qty === 1)).toBe(true);
    });

    test('a bead already held is not withdrawn again', () => {
        const step = gatherBead(snap('inProgress', {
            bankKnown: true,
            inv: [['red bead', 1]],
            invIds: [[1470, 1]],
            bank: [['red bead', 3]],
            bankIds: [[1470, 3]]
        }));
        expect(step.kind).toBe('custom');
    });

    test('the farm step names the beads still outstanding', () => {
        const step = gatherBead(snap('inProgress', {
            inv: [['black bead', 1], ['red bead', 1]],
            invIds: [[1474, 1], [1470, 1]]
        }));
        expect(step.kind === 'custom' && step.name).toContain('White bead');
        expect(step.kind === 'custom' && step.name).toContain('Yellow bead');
        expect(step.kind === 'custom' && step.name).not.toContain('Red bead');
    });
});

describe('impcatcher pickImp', () => {
    const imp = (index: number, x: number, z: number, distance: number, contested = false): ImpCandidate =>
        ({ index, tile: { x, z, level: 0 }, distance, contested });
    const anywhere = (): boolean => true;

    test('the nearest in-field imp wins', () => {
        const far = imp(1, 3009, 3307, 20);
        const near = imp(2, 3011, 3314, 4);
        expect(pickImp([far, near], anywhere)?.index).toBe(2);
    });

    test('an imp outside the field belongs to another spawn cluster', () => {
        expect(pickImp([imp(1, 3205, 3355, 2)], anywhere)).toBeNull();
    });

    test('an imp on another level is never in the field', () => {
        expect(pickImp([{ index: 1, tile: { x: 3011, z: 3314, level: 1 }, distance: 2, contested: false }], anywhere)).toBeNull();
    });

    test('an imp another player is fighting is left alone', () => {
        expect(pickImp([imp(1, 3011, 3314, 2, true)], anywhere)).toBeNull();
    });

    // Why: an imp teleports up to 20 tiles, which lands some of them inside the Falador wall where every walk answers "unreachable".
    test('a nearer imp on an unreachable tile loses to a reachable one', () => {
        const walled = imp(1, 2992, 3332, 3);
        const open = imp(2, 3011, 3314, 18);
        const reachable = (tile: { x: number; z: number }): boolean => tile.x !== 2992;
        expect(pickImp([walled, open], reachable)?.index).toBe(2);
    });

    test('no reachable imp gives no target rather than a doomed walk', () => {
        expect(pickImp([imp(1, 2992, 3332, 3)], () => false)).toBeNull();
    });
});

describe('impcatcher nearestReachable', () => {
    const drop = (id: number, x: number, distance: number) => ({ id, tile: { x, z: 3311, level: 0 }, distance });

    test('the nearest drop wins', () => {
        expect(nearestReachable([drop(1470, 3009, 9), drop(1472, 3011, 2)], () => true)?.id).toBe(1472);
    });

    // Why: another player's kill can leave a bead inside the wall, and walking at it burns the step's budget.
    test('a nearer drop on an unreachable tile loses to a reachable one', () => {
        const reachable = (tile: { x: number }): boolean => tile.x !== 2992;
        expect(nearestReachable([drop(1470, 2992, 1), drop(1472, 3011, 20)], reachable)?.id).toBe(1472);
    });

    test('nothing reachable gives nothing', () => {
        expect(nearestReachable([drop(1470, 2992, 1)], () => false)).toBeNull();
    });
});

describe('impcatcher module wiring', () => {
    test('the four beads are the record items, by unique object id', () => {
        expect(IMP_BEADS.map(bead => bead.id).sort()).toEqual([1470, 1472, 1474, 1476]);
        expect(impcatcher.record.items.map(item => item.name).sort())
            .toEqual(IMP_BEADS.map(bead => bead.name).sort());
    });

    test('every gather key is a record item name, so the engine can dispatch each', () => {
        const keys = Object.keys(impcatcher.gather ?? {}).sort();
        expect(keys).toEqual(impcatcher.record.items.map(item => item.name.toLowerCase()).sort());
    });

    // Why: `pickPreferred` matches by substring, and Mizgog's third option ends with his first option verbatim.
    test('the prefer list survives both of Mizgog quest-start option pages', () => {
        const opener = ['Give me a quest!', "Most of your friends are pretty quiet aren't they?"];
        const polite = ['Give me a quest please.', 'Give me a quest or else!', 'Just stop messing around and give me a quest!'];
        expect(pickPreferred(opener, [...MIZGOG.prefer])).toBe('Give me a quest!');
        expect(pickPreferred(polite, [...MIZGOG.prefer])).toBe('Give me a quest please.');
    });

    test('the engine can resolve the module from the record id', () => {
        expect(defById('imp')).toBe(impcatcher);
    });

    test('Mizgog stands on the top floor of the Wizards Tower', () => {
        expect(MIZGOG.anchor.level).toBe(2);
        expect([MIZGOG.anchor.x, MIZGOG.anchor.z]).toEqual([3103, 3163]);
    });

    test('every Falador south-gate imp spawn lies inside the searched field', () => {
        expect(IMP_SPAWNS.map(tile => [tile.x, tile.z])).toEqual([[3009, 3307], [3011, 3314], [3015, 3314]]);
        for (const tile of IMP_SPAWNS) {
            expect(tile.x >= IMP_FIELD.minX && tile.x <= IMP_FIELD.maxX, `${tile.x}`).toBe(true);
            expect(tile.z >= IMP_FIELD.minZ && tile.z <= IMP_FIELD.maxZ, `${tile.z}`).toBe(true);
        }
    });
});
