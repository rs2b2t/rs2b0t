import { describe, expect, test } from 'bun:test';

import { defById } from '#/bot/api/ai/quests/defs/index.js';
import { IMP_BEADS, IMP_FIELD, IMP_SPAWNS, IMP_STAND, MIZGOG, decide, gatherBead, idleProgress, impCensus, searchTarget, tallyNames, impcatcher, nearestReachable, pickImp, type ImpCandidate } from '#/bot/api/ai/quests/defs/impcatcher.js';
import { pickPreferred } from '#/bot/api/ai/quests/exec/primitives.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

const MAINLAND = { x: 3093, z: 3243, level: 0 };
/** Mid-transit between Draynor and Ardougne: the leg with no bank on it. */
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

    // Why: the imp drop table is unconditional, and the strip is 625 of walking and two ship fares from Mizgog, so gathering first spends that once instead of twice.
    test('notStarted with no beads -> farm first, so the tower is one trip', () => {
        expect(decide(snap('notStarted')).kind).toBe('custom');
    });

    test('notStarted holding every bead -> talk to Wizard Mizgog', () => {
        const step = decide(snap('notStarted', { inv: allBeads() }));
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

    // Why: twenty bots that all pick the nearest imp queue on the same one; a random pick spreads them over the strip.
    test('every valid imp gets picked over many rolls, not only the nearest', () => {
        const field = [imp(1, 2625, 3203, 20), imp(2, 2633, 3222, 4), imp(3, 2639, 3230, 12)];
        const chosen = new Set<number>();
        for (let roll = 0; roll < 60; roll++) {
            const pick = pickImp(field, anywhere, () => (roll * 37 % 101) / 101);
            if (pick) { chosen.add(pick.index); }
        }
        expect([...chosen].sort()).toEqual([1, 2, 3]);
    });

    test('a single valid imp is picked whatever the roll', () => {
        const only = imp(7, 2633, 3222, 4);
        expect(pickImp([only], anywhere, () => 0.9)?.index).toBe(7);
        expect(pickImp([only], anywhere, () => 0.1)?.index).toBe(7);
    });

    test('an imp outside the field belongs to another spawn cluster', () => {
        expect(pickImp([imp(1, 2845, 3175, 2)], anywhere)).toBeNull();
    });

    test('an imp on another level is never in the field', () => {
        expect(pickImp([{ index: 1, tile: { x: 2633, z: 3222, level: 1 }, distance: 2, contested: false }], anywhere)).toBeNull();
    });

    test('an imp another player is fighting is left alone', () => {
        expect(pickImp([imp(1, 2633, 3222, 2, true)], anywhere)).toBeNull();
    });

    // Why: an imp teleports up to 20 tiles, which lands some of them behind scenery where every walk answers "unreachable".
    test('a nearer imp on an unreachable tile loses to a reachable one', () => {
        const walled = imp(1, 2629, 3233, 3);
        const open = imp(2, 2633, 3222, 18);
        const reachable = (tile: { x: number; z: number; z2?: number }): boolean => tile.z !== 3233;
        expect(pickImp([walled, open], reachable)?.index).toBe(2);
    });

    test('no reachable imp gives no target rather than a doomed walk', () => {
        expect(pickImp([imp(1, 2633, 3222, 3)], () => false)).toBeNull();
    });
});

// Why: "no imp within 40 tiles" cannot tell an empty scene from a filter eating every candidate, and the two have different fixes.
describe('impcatcher impCensus', () => {
    const imp = (x: number, z: number, contested = false): ImpCandidate =>
        ({ index: x, tile: { x, z, level: 0 }, distance: 5, contested });

    test('each filter is counted separately', () => {
        const census = impCensus(
            [imp(2625, 3203), imp(2633, 3222, true), imp(3011, 3314), imp(2639, 3230)],
            tile => tile.x !== 2639
        );
        expect(census).toEqual({ scene: 4, inField: 3, free: 2, reachable: 1, nearestRefused: 5 });
    });

    test('an empty scene reads as zero everywhere', () => {
        expect(impCensus([], () => true)).toEqual({ scene: 0, inField: 0, free: 0, reachable: 0, nearestRefused: null });
    });

    // Why: a refusal 45 tiles off is the scene probe running out of BFS budget; one at 5 tiles is an obstacle in the scene, and the two need different fixes.
    test('the closest refused candidate reports its distance', () => {
        const far: ImpCandidate = { index: 1, tile: { x: 2625, z: 3203, level: 0 }, distance: 45, contested: false };
        const near: ImpCandidate = { index: 2, tile: { x: 2633, z: 3222, level: 0 }, distance: 6, contested: false };
        expect(impCensus([far, near], () => false).nearestRefused).toBe(6);
    });

    test('nothing refused reports no distance', () => {
        const ok: ImpCandidate = { index: 1, tile: { x: 2633, z: 3222, level: 0 }, distance: 6, contested: false };
        expect(impCensus([ok], () => true).nearestRefused).toBeNull();
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
    const drop = (id: number, x: number, distance: number) => ({ id, tile: { x, z: 3222, level: 0 }, distance });

    test('the nearest drop wins', () => {
        expect(nearestReachable([drop(1470, 2625, 9), drop(1472, 2633, 2)], () => true)?.id).toBe(1472);
    });

    // Why: another player's kill can leave a bead behind scenery, and walking at it burns the step's budget.
    test('a nearer drop on an unreachable tile loses to a reachable one', () => {
        const reachable = (tile: { x: number }): boolean => tile.x !== 2650;
        expect(nearestReachable([drop(1470, 2650, 1), drop(1472, 2633, 20)], reachable)?.id).toBe(1472);
    });

    test('nothing reachable gives nothing', () => {
        expect(nearestReachable([drop(1470, 2650, 1)], () => false)).toBeNull();
    });
});

// Why: the idle wait reports its result as the step's success, so anything in it that is true without work being available loops the step at ~20ms and the watchdog parks the quest after eight identical snapshots.
describe('impcatcher idleProgress', () => {
    const target = { index: 1, tile: { x: 2633, z: 3222, level: 0 }, distance: 4, contested: false };

    test('a fightable imp is progress', () => {
        expect(idleProgress(target, false)).toBe(true);
    });

    test('no imp is not progress, whatever else is happening', () => {
        expect(idleProgress(null, false)).toBe(false);
    });

    test('a pending random event hands the tick back rather than claiming progress', () => {
        expect(idleProgress(target, true)).toBe(false);
    });
});

// Why: imps roam far enough that standing still watches empty ground, so an idle bot sweeps the strip instead.
describe('impcatcher searchTarget', () => {
    const middle = { x: IMP_STAND.x, z: IMP_STAND.z, level: 0 };
    /** Feeds `searchTarget` a fixed sequence so a case is deterministic. */
    const rolls = (...values: number[]): (() => number) => {
        let i = 0;
        return () => values[i++ % values.length];
    };

    test('the sweep stays inside the field from every corner of it', () => {
        const corners = [
            { x: IMP_FIELD.minX, z: IMP_FIELD.minZ, level: 0 },
            { x: IMP_FIELD.maxX, z: IMP_FIELD.minZ, level: 0 },
            { x: IMP_FIELD.minX, z: IMP_FIELD.maxZ, level: 0 },
            { x: IMP_FIELD.maxX, z: IMP_FIELD.maxZ, level: 0 }
        ];
        for (const corner of corners) {
            for (let roll = 0; roll < 16; roll++) {
                const target = searchTarget(corner, rolls(roll / 16, (roll * 7) % 16 / 16));
                expect(target.x >= IMP_FIELD.minX && target.x <= IMP_FIELD.maxX, `${target.x}`).toBe(true);
                expect(target.z >= IMP_FIELD.minZ && target.z <= IMP_FIELD.maxZ, `${target.z}`).toBe(true);
                expect(target.level).toBe(0);
            }
        }
    });

    test('a sweep from the middle is a move worth walking', () => {
        for (let roll = 0; roll < 16; roll++) {
            const target = searchTarget(middle, rolls(roll / 16, 0.5));
            expect(target.distanceTo(middle), `roll ${roll}`).toBeGreaterThan(4);
        }
    });

    test('different directions go to different places', () => {
        const north = searchTarget(middle, rolls(0.25, 0.5));
        const south = searchTarget(middle, rolls(0.75, 0.5));
        expect(`${north.x},${north.z}`).not.toBe(`${south.x},${south.z}`);
    });

    // Why: the field is a rectangle with no terrain in it, so a heading can aim at a tile the walker cannot reach and burn its budget finding out.
    test('an unreachable heading is re-rolled rather than walked at', () => {
        const target = searchTarget(middle, rolls(0.1, 0.5, 0.6, 0.5), tile => tile.z !== 3230);
        expect(target.z).not.toBe(3230);
    });

    test('when nothing nearby is reachable the sweep falls back to the stand', () => {
        expect(searchTarget(middle, rolls(0.1, 0.5), () => false)).toBe(IMP_STAND);
    });

    test('with no reachability probe every heading is taken as given', () => {
        const target = searchTarget(middle, rolls(0.25, 0.5));
        expect(target.distanceTo(middle)).toBeGreaterThan(4);
    });

    test('from off the strip the sweep heads back to the stand', () => {
        expect(searchTarget({ x: 3093, z: 3243, level: 0 }, rolls(0.5, 0.5))).toBe(IMP_STAND);
    });

    test('no known position heads to the stand', () => {
        expect(searchTarget(null, rolls(0.5, 0.5))).toBe(IMP_STAND);
    });
});

// Why: the stand is where the bot returns from off-strip, and the sweep radiates from it.
describe('impcatcher IMP_STAND', () => {
    test('one stand covers every spawn inside the search radius', () => {
        for (const spawn of IMP_SPAWNS) {
            expect(IMP_STAND.distanceTo({ x: spawn.x, z: spawn.z, level: spawn.level }), `${spawn.x},${spawn.z}`).toBeLessThanOrEqual(25);
        }
    });

    test('the stand is inside the field it searches', () => {
        expect(IMP_STAND.x >= IMP_FIELD.minX && IMP_STAND.x <= IMP_FIELD.maxX).toBe(true);
        expect(IMP_STAND.z >= IMP_FIELD.minZ && IMP_STAND.z <= IMP_FIELD.maxZ).toBe(true);
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

    test('every south-Ardougne imp spawn lies inside the searched field', () => {
        expect([...IMP_SPAWNS].map(tile => [tile.x, tile.z]).sort()).toEqual(
            [[2625, 3203], [2625, 3217], [2629, 3233], [2630, 3210], [2632, 3202], [2633, 3222], [2633, 3243], [2639, 3206], [2639, 3230]].sort()
        );
        for (const tile of IMP_SPAWNS) {
            expect(tile.x >= IMP_FIELD.minX && tile.x <= IMP_FIELD.maxX, `${tile.x}`).toBe(true);
            expect(tile.z >= IMP_FIELD.minZ && tile.z <= IMP_FIELD.maxZ, `${tile.z}`).toBe(true);
        }
    });
});
