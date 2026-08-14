import { describe, expect, test } from 'bun:test';

import { defById } from '#/bot/api/ai/quests/defs/index.js';
import { IMP_BEADS, IMP_FIELD, IMP_SPAWNS, MIZGOG, PATROL_RING, decide, gatherBead, impCensus, tallyNames, impcatcher, nearestReachable, nextPatrolTarget, pickImp, type ImpCandidate } from '#/bot/api/ai/quests/defs/impcatcher.js';
import { pickPreferred } from '#/bot/api/ai/quests/exec/primitives.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';
import type Tile from '#/bot/geometry/Tile.js';

const MAINLAND = { x: 3093, z: 3243, level: 0 };
const KARAMJA = { x: 2845, z: 3175, level: 0 };

interface SnapOpts {
    inv?: [string, number][];
    invIds?: [number, number][];
    bank?: [string, number][];
    bankIds?: [number, number][];
    bankKnown?: boolean;
    bankCoins?: number;
    freeSlots?: number;
    tile?: { x: number; z: number; level: number };
}

/** Coins ride along unless a case sets them: a bot mid-quest is carrying the ship fare. */
const withCoins = (inv: [string, number][] | undefined): [string, number][] =>
    inv === undefined || inv.some(([name]) => name === 'coins') ? (inv ?? [['coins', 1000]]) : [...inv, ['coins', 1000]];

const snap = (journal: string, opts: SnapOpts = {}): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(withCoins(opts.inv)),
    invIds: new Map(opts.invIds ?? []),
    worn: new Set(),
    noProgress: 0,
    bankCoins: opts.bankCoins ?? 1_000_000,
    bank: new Map(opts.bank ?? []),
    bankIds: new Map(opts.bankIds ?? []),
    bankKnown: opts.bankKnown ?? true,
    freeSlots: opts.freeSlots ?? 20,
    tile: opts.tile ?? MAINLAND
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

    // Why: the ship charges 30 coins each way, and a float topped up on every tick sails the bot home for the fare it has spent, forever.
    test('a coin top-up happens on the mainland, before the crossing', () => {
        const step = gatherBead(snap('inProgress', { inv: [['coins', 0]], tile: MAINLAND }));
        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0].name).toBe('Coins');
    });

    test('short of coins on Karamja, keep farming rather than sail back for the fare', () => {
        const step = gatherBead(snap('inProgress', { inv: [['coins', 0]], tile: KARAMJA }));
        expect(step.kind).toBe('custom');
    });

    test('coins in hand on the mainland go straight to the farm', () => {
        expect(gatherBead(snap('inProgress', { inv: [['coins', 1000]], tile: MAINLAND })).kind).toBe('custom');
    });

    test('an empty bank account farms rather than parking on a withdrawal it cannot make', () => {
        const step = gatherBead(snap('inProgress', { inv: [['coins', 0]], bankCoins: 0, tile: MAINLAND }));
        expect(step.kind).toBe('custom');
    });

    test('a full pack is banked, keeping the beads and the fare', () => {
        const step = gatherBead(snap('inProgress', { freeSlots: 0, tile: MAINLAND }));
        expect(step.kind).toBe('deposit');
        expect(step.kind === 'deposit' && step.keep).toContain('coins');
        expect(step.kind === 'deposit' && step.keepIds).toEqual(expect.arrayContaining([1470, 1472, 1474, 1476]));
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
        const far = imp(1, 2832, 3170, 20);
        const near = imp(2, 2857, 3179, 4);
        expect(pickImp([far, near], anywhere)?.index).toBe(2);
    });

    test('an imp outside the field belongs to another spawn cluster', () => {
        expect(pickImp([imp(1, 3011, 3314, 2)], anywhere)).toBeNull();
    });

    test('an imp on another level is never in the field', () => {
        expect(pickImp([{ index: 1, tile: { x: 2832, z: 3170, level: 1 }, distance: 2, contested: false }], anywhere)).toBeNull();
    });

    test('an imp another player is fighting is left alone', () => {
        expect(pickImp([imp(1, 2832, 3170, 2, true)], anywhere)).toBeNull();
    });

    // Why: an imp teleports up to 20 tiles, which lands some of them on the volcano where every walk answers "unreachable".
    test('a nearer imp on an unreachable tile loses to a reachable one', () => {
        const onVolcano = imp(1, 2850, 3175, 3);
        const open = imp(2, 2832, 3170, 18);
        const reachable = (tile: { x: number; z: number }): boolean => tile.x !== 2850;
        expect(pickImp([onVolcano, open], reachable)?.index).toBe(2);
    });

    test('no reachable imp gives no target rather than a doomed walk', () => {
        expect(pickImp([imp(1, 2850, 3175, 3)], () => false)).toBeNull();
    });
});

// Why: "no imp within 40 tiles" cannot tell an empty scene from a filter eating every candidate, and the two have different fixes.
describe('impcatcher impCensus', () => {
    const imp = (x: number, z: number, contested = false): ImpCandidate =>
        ({ index: x, tile: { x, z, level: 0 }, distance: 5, contested });

    test('each filter is counted separately', () => {
        const census = impCensus(
            [imp(2832, 3170), imp(2857, 3179, true), imp(3011, 3314), imp(2850, 3175)],
            tile => tile.x !== 2850
        );
        expect(census).toEqual({ scene: 4, inField: 3, free: 2, reachable: 1 });
    });

    test('an empty scene reads as zero everywhere', () => {
        expect(impCensus([], () => true)).toEqual({ scene: 0, inField: 0, free: 0, reachable: 0 });
    });
});

// Why: zero imps in the scene reads the same whether the spawns are dead or the zone never streamed, and the neighbours tell those apart.
describe('impcatcher tallyNames', () => {
    test('names are counted and ordered by how many there are', () => {
        expect(tallyNames(['Scorpion', 'Monkey', 'Scorpion', 'Snake', 'Scorpion', 'Monkey'])).toBe('Scorpion x3, Monkey x2, Snake');
    });

    test('an empty scene says so rather than printing nothing', () => {
        expect(tallyNames([])).toBe('nothing');
    });

    test('unnamed entries are not silently dropped', () => {
        expect(tallyNames([null, 'Imp'])).toBe('?, Imp');
    });
});

describe('impcatcher nearestReachable', () => {
    const drop = (id: number, x: number, distance: number) => ({ id, tile: { x, z: 3175, level: 0 }, distance });

    test('the nearest drop wins', () => {
        expect(nearestReachable([drop(1470, 2832, 9), drop(1472, 2840, 2)], () => true)?.id).toBe(1472);
    });

    // Why: another player's kill can leave a bead on the volcano, and walking at it burns the step's budget.
    test('a nearer drop on an unreachable tile loses to a reachable one', () => {
        const reachable = (tile: { x: number }): boolean => tile.x !== 2850;
        expect(nearestReachable([drop(1470, 2850, 1), drop(1472, 2832, 20)], reachable)?.id).toBe(1472);
    });

    test('nothing reachable gives nothing', () => {
        expect(nearestReachable([drop(1470, 2850, 1)], () => false)).toBeNull();
    });
});

// Why: the volcano fills the middle of the ring, so no one tile stands within reach of all eight spawns.
describe('impcatcher nextPatrolTarget', () => {
    const at = (tile: Tile) => ({ x: tile.x, z: tile.z, level: tile.level });

    test('no known position starts the ring at its first spawn', () => {
        expect(nextPatrolTarget(null)).toBe(IMP_SPAWNS[0]);
    });

    test('standing on a spawn advances to the next one round the volcano', () => {
        expect(nextPatrolTarget(at(IMP_SPAWNS[0]))).toBe(IMP_SPAWNS[1]);
        expect(nextPatrolTarget(at(IMP_SPAWNS[3]))).toBe(IMP_SPAWNS[4]);
    });

    test('the ring wraps, so every spawn is visited rather than two ping-ponging', () => {
        expect(nextPatrolTarget(at(IMP_SPAWNS[IMP_SPAWNS.length - 1]))).toBe(IMP_SPAWNS[0]);
    });

    test('off the ring, head for the nearest spawn rather than the next in order', () => {
        const fromTheMusaDock = nextPatrolTarget({ x: 2956, z: 3146, level: 0 });
        expect([fromTheMusaDock.x, fromTheMusaDock.z]).toEqual([2857, 3179]);
    });

    // Why: (2857,3179) and (2859,3177) are two tiles apart, and a walk whose radius already covers the target returns "arrived" without moving, so the ring never advances and the watchdog parks the quest.
    test('the next target is always far enough away to be a move', () => {
        for (const spawn of IMP_SPAWNS) {
            const target = nextPatrolTarget(at(spawn));
            expect(target.distanceTo(at(spawn)), `${spawn.x},${spawn.z} -> ${target.x},${target.z}`).toBeGreaterThan(4);
        }
    });

    test('walking the ring in order reaches every stop on it', () => {
        const visited = new Set<string>();
        let target = nextPatrolTarget(null);
        for (let step = 0; step < PATROL_RING.length; step++) {
            visited.add(`${target.x},${target.z}`);
            target = nextPatrolTarget(at(target));
        }
        expect(visited.size).toBe(PATROL_RING.length);
    });

    test('every spawn is on the ring or within sight of a stop on it', () => {
        for (const spawn of IMP_SPAWNS) {
            const nearest = Math.min(...PATROL_RING.map(stop => stop.distanceTo(at(spawn))));
            expect(nearest, `${spawn.x},${spawn.z}`).toBeLessThanOrEqual(4);
        }
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

    // Why: the engine's own provisioning restores the coin float every tick, which turns a 30-coin fare into a round trip across the sea.
    test('the module owns its inventory, so nothing else tops the fare up mid-farm', () => {
        expect(impcatcher.ownsInventory).toBe(true);
    });

    test('Mizgog stands on the top floor of the Wizards Tower', () => {
        expect(MIZGOG.anchor.level).toBe(2);
        expect([MIZGOG.anchor.x, MIZGOG.anchor.z]).toEqual([3103, 3163]);
    });

    test('every Karamja volcano imp spawn lies inside the searched field', () => {
        expect([...IMP_SPAWNS].map(tile => [tile.x, tile.z]).sort()).toEqual(
            [[2832, 3170], [2832, 3177], [2837, 3184], [2841, 3163], [2849, 3186], [2850, 3165], [2857, 3179], [2859, 3177]].sort()
        );
        for (const tile of IMP_SPAWNS) {
            expect(tile.x >= IMP_FIELD.minX && tile.x <= IMP_FIELD.maxX, `${tile.x}`).toBe(true);
            expect(tile.z >= IMP_FIELD.minZ && tile.z <= IMP_FIELD.maxZ, `${tile.z}`).toBe(true);
        }
    });
});
