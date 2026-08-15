import { describe, expect, test } from 'bun:test';
import {
    COAL_MINING_LEVEL,
    MINE_START_MS,
    MINE_STALL_MS,
    MINE_TRUCK,
    MAX_PULLS_PER_HAUL,
    MINE_TRUCK_STAND,
    SEERS_TRUCK,
    SEERS_TRUCK_STAND,
    TRUCK_MAX,
    classifyDeposit,
    classifyRemove,
    decide,
    mineWaitDone,
    truckFullAfterDeposit,
    truckEmptyAfterRemove,
    type MineView,
    type WorldView
} from '#/bot/scripts/CoalTrucks/CoalTrucksLogic.js';

describe('classifyDeposit', () => {
    test('whole stack accepted', () => {
        expect(classifyDeposit(['You put the coal in the truck.'])).toBe('all');
    });
    test('partial accept means the truck just hit the cap', () => {
        expect(classifyDeposit(['You put some of the coal in the truck.'])).toBe('partial');
    });
    test('"some" is not misread as "all" — the prefixes overlap', () => {
        expect(classifyDeposit(['You put some of the coal in the truck.'])).not.toBe('all');
    });
    test('already full', () => {
        expect(classifyDeposit(['The coal truck is full.'])).toBe('full');
    });
    test('wrong item is our bug, not a game state', () => {
        expect(classifyDeposit(["The coal truck isn't meant to transport that."])).toBe('wrong-item');
    });
    test('unrelated chatter classifies as none', () => {
        expect(classifyDeposit(['You manage to mine some coal.', 'Oh dear, you are dead!'])).toBe('none');
    });
    test('empty window classifies as none', () => {
        expect(classifyDeposit([])).toBe('none');
    });
    test('the truck line wins even when buried in unrelated chatter', () => {
        expect(classifyDeposit(['You manage to mine some coal.', 'The coal truck is full.'])).toBe('full');
    });
});

describe('classifyRemove', () => {
    test('took the remainder', () => {
        expect(classifyRemove(['You remove the coal from the truck.'])).toBe('all');
    });
    test('pack filled, truck still loaded', () => {
        expect(classifyRemove(['You remove some of the coal from the truck.'])).toBe('partial');
    });
    test('"some" is not misread as "all"', () => {
        expect(classifyRemove(['You remove some of the coal from the truck.'])).not.toBe('all');
    });
    test('truck empty', () => {
        expect(classifyRemove(['There is no coal left in the truck.'])).toBe('empty');
    });
    test('no free slots', () => {
        expect(classifyRemove(['You do not have enough inventory space!'])).toBe('no-space');
    });
    test('unrelated chatter classifies as none', () => {
        expect(classifyRemove(['You manage to mine some coal.'])).toBe('none');
    });
});

describe('truckFullAfterDeposit', () => {
    test('a partial or refused accept both mean the truck is at the cap', () => {
        expect(truckFullAfterDeposit('partial')).toBe(true);
        expect(truckFullAfterDeposit('full')).toBe(true);
    });
    test('a clean accept leaves room', () => {
        expect(truckFullAfterDeposit('all')).toBe(false);
    });
    test('an unread or malformed outcome is not evidence of a cap — never advance on doubt', () => {
        expect(truckFullAfterDeposit('none')).toBe(false);
        expect(truckFullAfterDeposit('wrong-item')).toBe(false);
    });
});

describe('truckEmptyAfterRemove', () => {
    test('both drained outcomes mean the truck is spent', () => {
        expect(truckEmptyAfterRemove('all')).toBe(true);
        expect(truckEmptyAfterRemove('empty')).toBe(true);
    });
    test('a partial pull leaves coal behind', () => {
        expect(truckEmptyAfterRemove('partial')).toBe(false);
    });
    test('no-space and none are not evidence of an empty truck', () => {
        expect(truckEmptyAfterRemove('no-space')).toBe(false);
        expect(truckEmptyAfterRemove('none')).toBe(false);
    });
});

const view = (over: Partial<WorldView> = {}): WorldView => ({
    phase: 'fill',
    packFull: false,
    coalHeld: 0,
    rockAvailable: true,
    truckEmpty: false,
    truckFull: false,
    pullsThisHaul: 0,
    hasPickaxe: true,
    atMine: true,
    ...over
});

describe('decide — the last pull is not worth the trip', () => {
    // A 120 truck drains in 4 full packs plus a ~12 remainder; that last 102-tile round
    // trip for 12 coal loses money. The remainder rides to the next cycle.
    test('keeps pulling below the cap', () => {
        expect(decide(view({ phase: 'drain', pullsThisHaul: MAX_PULLS_PER_HAUL - 1 })))
            .toEqual({ kind: 'remove' });
    });
    test('heads home once the pull budget is spent, even with coal still in the truck', () => {
        expect(decide(view({ phase: 'drain', pullsThisHaul: MAX_PULLS_PER_HAUL })))
            .toEqual({ kind: 'travel-to-mine' });
    });
    test('banks what is carried before heading home on a spent budget', () => {
        expect(decide(view({ phase: 'drain', pullsThisHaul: MAX_PULLS_PER_HAUL, coalHeld: 27 })))
            .toEqual({ kind: 'bank' });
    });
    test('an empty truck still ends the haul early', () => {
        expect(decide(view({ phase: 'drain', truckEmpty: true, pullsThisHaul: 1 })))
            .toEqual({ kind: 'travel-to-mine' });
    });
    test('four is the measured optimum, not an arbitrary cap', () => {
        expect(MAX_PULLS_PER_HAUL).toBe(4);
    });
});

describe('decide — topping the pack up on a capped truck', () => {
    // The haul costs the same six bank hops whether the pack holds 17 or 27, so the
    // coal mined between the cap and departure is free.
    test('keeps mining once the truck is capped but the pack is not', () => {
        expect(decide(view({ truckFull: true, coalHeld: 17 }))).toEqual({ kind: 'mine' });
    });
    // Why: the truck is capped, so a carried pack can only go to the bank — routing via the truck stand costs 196 tiles against 156.
    test('heads for the bank, not the truck, once both are full', () => {
        expect(decide(view({ truckFull: true, packFull: true, coalHeld: 27 }))).toEqual({ kind: 'bank' });
    });
    test('does not deposit again into a capped truck', () => {
        expect(decide(view({ truckFull: true, packFull: true, coalHeld: 27 }))).not.toEqual({ kind: 'deposit' });
    });
    test('banks a part load rather than carrying it past the bank to the truck', () => {
        expect(decide(view({ truckFull: true, rockAvailable: false, coalHeld: 17 })))
            .toEqual({ kind: 'bank' });
    });
    test('only heads for the truck once empty-handed', () => {
        expect(decide(view({ truckFull: true, rockAvailable: false, coalHeld: 0 })))
            .toEqual({ kind: 'travel-to-seers' });
    });
    test('a capped truck away from the mine, empty-handed, goes to unload', () => {
        expect(decide(view({ truckFull: true, atMine: false, coalHeld: 0 }))).toEqual({ kind: 'travel-to-seers' });
    });
    test('still outranked by a missing pickaxe', () => {
        expect(decide(view({ truckFull: true, packFull: true, hasPickaxe: false }))).toEqual({ kind: 'bank' });
    });
});

describe('decide — pickaxe outranks every phase', () => {
    // Why: ~maxme grants stats and never gear, so a bot reaches the mine with no pickaxe and no message.
    test('no pickaxe banks instead of mining', () => {
        expect(decide(view({ hasPickaxe: false }))).toEqual({ kind: 'bank' });
    });
    test('no pickaxe banks even mid-run', () => {
        expect(decide(view({ phase: 'run', hasPickaxe: false }))).toEqual({ kind: 'bank' });
    });
    test('no pickaxe banks even with a full pack', () => {
        expect(decide(view({ packFull: true, hasPickaxe: false }))).toEqual({ kind: 'bank' });
    });
});

describe('decide — getting back to the mine', () => {
    // Without this the bot idles at the bank forever after fetching a pickaxe:
    // findRock is leashed to the mine, so rockAvailable is false and it waits.
    test('walks to the mine when the fill phase starts away from it', () => {
        expect(decide(view({ atMine: false }))).toEqual({ kind: 'travel-to-mine' });
    });
    test('a full pack away from the mine still walks back first', () => {
        expect(decide(view({ atMine: false, packFull: true }))).toEqual({ kind: 'travel-to-mine' });
    });
    test('being away from the mine does not disturb the drain phase', () => {
        expect(decide(view({ phase: 'drain', atMine: false }))).toEqual({ kind: 'remove' });
    });
});

describe('decide — fill', () => {
    test('mines while there is room and a rock', () => {
        expect(decide(view())).toEqual({ kind: 'mine' });
    });
    test('deposits once the pack is full', () => {
        expect(decide(view({ packFull: true }))).toEqual({ kind: 'deposit' });
    });
    test('a full pack deposits even with no rock left', () => {
        expect(decide(view({ packFull: true, rockAvailable: false }))).toEqual({ kind: 'deposit' });
    });
    test('waits for respawn rather than depositing a part load', () => {
        expect(decide(view({ rockAvailable: false, coalHeld: 12 }))).toEqual({ kind: 'await-rocks' });
    });
});

describe('decide — run', () => {
    // The truck is capped when the run starts, so the carried pack cannot go into it.
    // Touching the truck first and doubling back to the bank costs 196 against 156.
    test('banks the carried pack before going anywhere near the truck', () => {
        expect(decide(view({ phase: 'run', coalHeld: 27 }))).toEqual({ kind: 'bank' });
    });
    test('a part load is still banked first', () => {
        expect(decide(view({ phase: 'run', coalHeld: 1 }))).toEqual({ kind: 'bank' });
    });
    test('empty-handed, it heads for the truck to start draining', () => {
        expect(decide(view({ phase: 'run', coalHeld: 0 }))).toEqual({ kind: 'travel-to-seers' });
    });
});

describe('decide — drain', () => {
    test('banks what is carried before pulling more', () => {
        expect(decide(view({ phase: 'drain', coalHeld: 28 }))).toEqual({ kind: 'bank' });
    });
    test('banks leftovers carried in from the fill phase', () => {
        expect(decide(view({ phase: 'drain', coalHeld: 20, packFull: false }))).toEqual({ kind: 'bank' });
    });
    test('never removes with a full pack — the engine refuses it', () => {
        expect(decide(view({ phase: 'drain', packFull: true, coalHeld: 28 }))).toEqual({ kind: 'bank' });
    });
    test('removes when empty-handed and the truck still holds coal', () => {
        expect(decide(view({ phase: 'drain' }))).toEqual({ kind: 'remove' });
    });
    test('heads back once the truck is spent and nothing is carried', () => {
        expect(decide(view({ phase: 'drain', truckEmpty: true }))).toEqual({ kind: 'travel-to-mine' });
    });
    test('banks the last load before heading back', () => {
        expect(decide(view({ phase: 'drain', truckEmpty: true, coalHeld: 14 }))).toEqual({ kind: 'bank' });
    });
});

const mining = (over: Partial<MineView> = {}): MineView => ({
    gained: false,
    packFull: false,
    animating: false,
    interrupted: false,
    ...over
});

describe('mineWaitDone — a swing that stops without a yield must end the wait', () => {
    // Why: another player taking the rock stops the swing without a coal gain, a full pack, an event or a dialog, so a success-only wait burns the full MINE_STALL_MS.
    test('the swing stopping with no coal ends the wait', () => {
        expect(mineWaitDone('sustain', mining({ animating: false }))).toBe(true);
    });
    test('a swing still running with no coal keeps waiting', () => {
        expect(mineWaitDone('sustain', mining({ animating: true }))).toBe(false);
    });
    test('a yield ends the wait even mid-swing', () => {
        expect(mineWaitDone('sustain', mining({ animating: true, gained: true }))).toBe(true);
    });
});

describe('mineWaitDone — the start stage cannot spin', () => {
    // Why: the swing takes a tick or two to begin after the click, so a bare `!animating` check is true the instant the wait starts and the loop re-clicks forever.
    test('waits for the swing to begin rather than reporting done immediately', () => {
        expect(mineWaitDone('start', mining({ animating: false }))).toBe(false);
    });
    test('the swing beginning ends the start wait', () => {
        expect(mineWaitDone('start', mining({ animating: true }))).toBe(true);
    });
    test('a yield that beats the animation still ends the start wait', () => {
        expect(mineWaitDone('start', mining({ gained: true }))).toBe(true);
    });
});

describe('mineWaitDone — interrupts outrank both stages', () => {
    test('a pending random event or dialog ends either stage', () => {
        expect(mineWaitDone('start', mining({ interrupted: true }))).toBe(true);
        expect(mineWaitDone('sustain', mining({ animating: true, interrupted: true }))).toBe(true);
    });
    test('a full pack ends either stage', () => {
        expect(mineWaitDone('start', mining({ packFull: true }))).toBe(true);
        expect(mineWaitDone('sustain', mining({ animating: true, packFull: true }))).toBe(true);
    });
});

describe('mineWaitDone — the bounds are a backstop, not the normal path', () => {
    test('the start bound is short: it only covers click-to-swing', () => {
        expect(MINE_START_MS).toBeLessThanOrEqual(3000);
    });
    test('the stall bound stays well above the start bound', () => {
        expect(MINE_STALL_MS).toBeGreaterThan(MINE_START_MS);
    });
});

describe('constants match the engine content', () => {
    test('truck cap and coal level come from coal_truck.constant and mine.dbrow', () => {
        expect(TRUCK_MAX).toBe(120);
        expect(COAL_MINING_LEVEL).toBe(30);
    });
    test('each stand is adjacent to its truck', () => {
        expect(MINE_TRUCK_STAND.distanceTo(MINE_TRUCK)).toBe(1);
        expect(SEERS_TRUCK_STAND.distanceTo(SEERS_TRUCK)).toBe(1);
    });
});
