import { GameMessages } from '#/bot/api/chatbox/gameMessages.js';
import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { watchtower, decide } from '#/bot/api/ai/quests/defs/watchtower/index.js';
import { WT_LOC } from '#/bot/api/ai/quests/defs/watchtower/areas.js';
import { crossEastGate, goldGateNeedsPayment } from '#/bot/api/ai/quests/defs/watchtower/gutanoth.js';
import { Navigator } from '#/bot/event/webwalk/Navigator.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Loc } from '#/bot/api/locs/Locs.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';

afterEach(() => { mock.restore(); GameMessages.reset(); });
function fixture(cave: boolean) {
    const state = { tile: cave ? { x: 2530, z: 9440, level: 0 } : { x: 2550, z: 3030, level: 0 }, opened: 0, refuse: false };
    spyOn(Game, 'tile').mockImplementation(() => state.tile);
    spyOn(Inventory, 'items').mockReturnValue([]);
    spyOn(reader, 'locs').mockImplementation(() => [{
        id: state.tile.z > 9000 ? WT_LOC.CAVE_OUT[5] : WT_LOC.GATE_EAST, typecode: 0,
        name: 'Exit', tile: state.tile, distance: 1, ops: [state.tile.z > 9000 ? 'Leave' : 'Open']
    }]);
    spyOn(Loc.prototype, 'interact').mockImplementation(async (_op) => {
        state.opened++;
        if (state.refuse) {
            GameMessages.record('The guard pushes you outside the city.');
            state.tile = { x: 2510, z: 3050, level: 0 };
            return true;
        }
        state.tile = state.tile.z > 9000 ? { x: 2529, z: 3013, level: 0 }
            : state.tile.z < 3029 ? { x: 2550, z: 3030, level: 0 } : { x: 2549, z: 3027, level: 0 };
        return true;
    });
    spyOn(Navigator, 'findPath').mockImplementation(async () => state.tile.z < 3029 ? { ok: true, waypoints: [], hops: [], cost: 1, expanded: 0 } : { ok: false, reason: 'unreachable', expanded: 0 });
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    spyOn(Execution, 'delayTicks').mockResolvedValue();
    spyOn(Traversal, 'walkResilient').mockResolvedValue(true);
    return state;
}

test('a paid east gate opens without sourcing another gold bar', async () => {
    const state = fixture(false);
    expect(await crossEastGate(() => {}, true)).toBe(true);
    expect(state.opened).toBe(1);
    expect(state.tile.z).toBeLessThan(3029);
});

test('bank recovery leaves cave six and its sealed east-gate component in one step', async () => {
    const state = fixture(true);
    const step = watchtower.recover?.(state.tile);
    expect(step?.kind).toBe('custom');
    if (step?.kind !== 'custom') return;
    expect(await step.run(() => {})).toBe(true);
    expect(state.opened).toBe(2);
    expect(watchtower.resumeAt?.(state.tile)).toBe(false);
});

test('a resumed stage-six trip discovers the paid gate without a cached unlock', async () => {
    const state = fixture(false);
    expect(await crossEastGate(() => {})).toBe(true);
    expect(state.opened).toBe(1);
});


test('a refused gate is remembered so a missing gold bar parks instead of retrying passage', async () => {
    const state = fixture(false);
    spyOn(Game, 'myName').mockReturnValue('watchtower-unpaid-gate-test');
    state.refuse = true;
    expect(await crossEastGate(() => {})).toBe(false);
    expect(goldGateNeedsPayment()).toBe(true);
    const step = decide({ journal: 'inProgress', stage: 6,
        progress: { stage: 6, flags: new Set(['learning-skavid', 'learned-nod', 'learned-ig', 'learned-ar', 'learned-cur']) },
        inv: new Map(), invIds: new Map([[2376, 1], [33, 1]]), worn: new Set(), bankKnown: true, bank: new Map(), bankIds: new Map(), bankCoins: 0, noProgress: 0,
        tile: state.tile, freeSlots: 26 });
    expect(step.kind).toBe('wait');
    expect(step.kind === 'wait' && step.reason).toContain('Gold bar');
    spyOn(Game, 'myName').mockReturnValue('watchtower-different-account');
    expect(goldGateNeedsPayment()).toBeUndefined();
});
