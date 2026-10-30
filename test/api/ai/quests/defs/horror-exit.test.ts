import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type WorldTile } from '#/bot/adapter/ClientAdapter.js';
import { exitAfterQuest } from '#/bot/api/ai/quests/defs/horror/dungeon.js';
import { horror } from '#/bot/api/ai/quests/defs/horror/index.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Loc } from '#/bot/api/locs/Locs.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';

afterEach(() => mock.restore());

function cavern(landing: WorldTile | null) {
    const state: { tile: WorldTile | null } = { tile: { x: 2520, z: 9995, level: 1 } };
    spyOn(Game, 'tile').mockImplementation(() => state.tile);
    spyOn(Game, 'setAutoRetaliate').mockReturnValue(true);
    spyOn(Traversal, 'walkResilient').mockImplementation(async (tile, options) => {
        if (tile.x === 2509 && tile.z === 3636 && options?.radius === 0) state.tile = tile;
        if (tile.x === 2522 && tile.z === 3594 && state.tile?.z === 3635) state.tile = tile;
        return true;
    });
    spyOn(Execution, 'delayTicks').mockResolvedValue();
    spyOn(Execution, 'delayUntil').mockImplementation(async condition => condition());
    spyOn(reader, 'locs').mockReturnValue([
        { id: 4485, typecode: 0, name: 'Iron ladder', ops: ['Climb'], tile: { x: 2515, z: 10006, level: 1 }, distance: 11 },
        { id: 4412, typecode: 0, name: 'Iron ladder', ops: ['Climb'], tile: { x: 2519, z: 9994, level: 1 }, distance: 1 },
        { id: 4545, typecode: 0, name: 'Doorway', ops: ['Walk-through'], tile: { x: 2509, z: 3636, level: 0 }, distance: 6 },
        { id: 4541, typecode: 0, name: 'Staircase', ops: ['Climb', 'Climb-up', 'Climb-down'], tile: { x: 2506, z: 3640, level: 1 }, distance: 6 },
        { id: 4542, typecode: 0, name: 'Staircase', ops: ['Climb-down'], tile: { x: 2506, z: 3640, level: 2 }, distance: 6 }
    ]);
    spyOn(Loc.prototype, 'interact').mockImplementation(function(this: Loc, action) {
        if (this.name === 'Staircase' && action === 'Climb-down' && state.tile?.level === this.tile().level) {
            state.tile = { x: 2506, z: 3642, level: state.tile.level - 1 };
            return true;
        }
        if (this.name === 'Doorway' && action === 'Walk-through' && state.tile?.x === 2509 && state.tile.z === 3636) {
            state.tile = { x: 2509, z: 3635, level: 0 };
            return true;
        }
        if (this.id !== 4412 || action !== 'Climb') return false;
        state.tile = landing;
        return true;
    });
    return state;
}

test('recovers a completed Horror cavern before another quest can bank', async () => {
    const state = cavern({ x: 2510, z: 3644, level: 0 });
    const step = horror.recover?.({ x: 2520, z: 9995, level: 1 });
    expect(step?.kind).toBe('custom');
    if (step?.kind !== 'custom') return;
    expect(await step.run(() => {})).toBe(true);
    expect(state.tile).toEqual({ x: 2522, z: 3594, level: 0 });
});

test.each([
    { x: 2515, z: 10001, level: 1 },
    { x: 2519, z: 9995, level: 1 }
])('recovers the completion landing and exit approach at %j', tile => {
    expect(horror.recover?.(tile)?.kind).toBe('custom');
});

test.each([
    { x: 2510, z: 3644, level: 0 },
    { x: 2519, z: 4619, level: 1 },
    { x: 2519, z: 9995, level: 0 },
    { x: 2495, z: 9995, level: 1 },
    { x: 2560, z: 9995, level: 1 },
    { x: 2519, z: 9983, level: 1 },
    { x: 2519, z: 10048, level: 1 },
    { x: 3200, z: 10000, level: 1 }
])('does not divert other areas into the Horror exit at %j', tile => {
    expect(horror.recover?.(tile)).toBeNull();
});

test('does not treat a missing tile during the ladder transition as a successful exit', async () => {
    cavern(null);
    expect(await exitAfterQuest(() => {})).toBe(false);
});

test('waits for the ladder teleport before restoring retaliation can cancel the climb', async () => {
    const state = cavern(null);
    let climbing = false;
    spyOn(Loc.prototype, 'interact').mockImplementation(function(this: Loc) {
        if (this.name === 'Doorway' && state.tile?.z === 3636) {
            state.tile = { x: 2509, z: 3635, level: 0 };
            return true;
        }
        climbing = true;
        return true;
    });
    spyOn(Game, 'setAutoRetaliate').mockImplementation(on => {
        if (on) climbing = false;
        return true;
    });
    spyOn(Execution, 'delayUntil').mockImplementation(async condition => {
        await Promise.resolve();
        if (climbing) {
            state.tile = { x: 2510, z: 3644, level: 0 };
            climbing = false;
        }
        return condition();
    });
    expect(await exitAfterQuest(() => {})).toBe(true);
    expect(state.tile).toEqual({ x: 2522, z: 3594, level: 0 });
});

test.each([0, 1, 2])('completed Horror resumes on lighthouse floor %i and reaches the mainland', async level => {
    const state = cavern(null);
    state.tile = { x: 2511, z: 3642, level };
    spyOn(Quests, 'status').mockReturnValue('complete');
    const step = horror.recover?.(state.tile);
    expect(step?.kind).toBe('custom');
    if (step?.kind !== 'custom') return;
    expect(await step.run(() => {})).toBe(true);
    expect(state.tile).toEqual({ x: 2522, z: 3594, level: 0 });
});

test.each([0, 1, 2])('active Horror keeps control of repaired lighthouse floor %i', level => {
    spyOn(Quests, 'status').mockReturnValue('inProgress');
    expect(horror.recover?.({ x: 2510, z: 3642, level })).toBeNull();
});

test.each([{ x: 2509, z: 3635, level: 0 }, { x: 2505, z: 3636, level: 0 }, { x: 2510, z: 3642, level: 3 }])('does not recover outside the lighthouse at %j', tile => {
    spyOn(Quests, 'status').mockReturnValue('complete');
    expect(horror.recover?.(tile)).toBeNull();
});

test('does not walk to the Horror ladder from an unrelated dungeon', async () => {
    spyOn(Game, 'tile').mockReturnValue({ x: 3200, z: 10000, level: 1 });
    const walk = spyOn(Traversal, 'walkResilient').mockResolvedValue(false);
    spyOn(Game, 'setAutoRetaliate').mockReturnValue(true);
    expect(await exitAfterQuest(() => {})).toBe(true);
    expect(walk).not.toHaveBeenCalled();
});
