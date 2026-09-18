import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'fflate';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import Tile from '#/bot/geometry/Tile.js';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { fountainKey } from '#/bot/api/ai/quests/defs/witchshouse/garden.js';
import { decide } from '#/bot/api/ai/quests/defs/witchshouse/index.js';
import { WH_OBJ, WH_TILE } from '#/bot/api/ai/quests/defs/witchshouse/areas.js';
import { WH_STAGE } from '#/bot/api/ai/quests/defs/witchshouse/journal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Npcs } from '#/bot/api/npcs/Npcs.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

test('a missing patrol snapshot never starts an unguarded fountain run', async () => {
    let walks = 0;
    const restores = [
        stubProps(Game, { tile: () => ({ x: 2909, z: 3460, level: 0 }) }),
        stubProps(Inventory, { countById: () => 0 }),
        stubProps(Npcs, { all: () => [] }),
        stubProps(Execution, { delayTicks: async () => {} }),
        stubProps(Traversal, { walkResilient: async () => { walks++; return false; } })
    ];
    try {
        expect(await fountainKey(() => {})).toBe(false);
        expect(walks).toBe(0);
    } finally {
        for (const restore of restores.reverse()) restore();
    }
});

test('a recovered ball leaves the garden safely before walking to the boy', () => {
    const step = decide({ journal: 'inProgress', stage: WH_STAGE.DEFEATED,
        inv: new Map([['ball', 1]]), invIds: new Map([[WH_OBJ.BALL, 1]]), worn: new Set(),
        bank: new Map(), bankKnown: true, bankCoins: 0, noProgress: 0, tile: WH_TILE.BALL });
    expect(step.kind).toBe('custom');
    expect(step.kind === 'custom' && step.name).toContain('garden');
});

import { gardenLegs, GARDEN_ENTRY, FOUNTAIN_STAND, GARDEN_SHED, safeCrossing, sheltered, walkGarden, observeWitch, type PatrolObservation } from '#/bot/api/ai/quests/defs/witchshouse/patrol.js';
import { DirectNavigator } from '#/bot/event/webwalk/DirectNavigator.js';

const patrol = (tick: number) => ({ x: 2904 + (tick % 52 <= 26 ? tick % 52 : 52 - tick % 52), z: 3463, level: 0 });

for (const [from, to] of [[GARDEN_ENTRY, FOUNTAIN_STAND], [FOUNTAIN_STAND, GARDEN_SHED], [GARDEN_SHED, GARDEN_ENTRY]]) {
    test(`walking ${from.x},${from.z} to ${to.x},${to.z} stays safe at every patrol phase`, () => {
        const legs = gardenLegs(from, to)!;
        expect(legs).not.toBeNull();
        for (let phase = 0; phase < 52; phase++) {
            let tick = phase;
            for (const leg of legs) {
                let waited = 0;
                let observation: PatrolObservation | null = null;
                while (waited < 120) {
                    observation = observeWitch(observation, Math.abs(patrol(tick).x - leg[0].x) <= 15 ? patrol(tick) : null, tick);
                    if (safeCrossing(leg, observation)) break;
                    expect(sheltered(leg[0])).toBe(true);
                    tick++;
                    waited++;
                }
                expect(waited).toBeLessThan(120);
                for (const point of leg.slice(1)) {
                    tick++;
                    const witch = patrol(tick);
                    expect(sheltered(point) || Math.max(Math.abs(point.x - witch.x), Math.abs(point.z - witch.z)) > 3).toBe(true);
                }
                expect(sheltered(leg.at(-1)!)).toBe(true);
            }
        }
    });
}

test('hedge gaps and the south-east corner are not waiting places', () => {
    expect(sheltered({ x: 2912, z: 3460, level: 0 })).toBe(false);
    expect(sheltered({ x: 2916, z: 3466, level: 0 })).toBe(false);
    expect(sheltered({ x: 2932, z: 3460, level: 0 })).toBe(false);
});

test('a stalled crossing stops before another leg is issued', async () => {
    const walks: { x: number; z: number }[] = [];
    const here = { x: 2909, z: 3460, level: 0 };
    let sample = 14;
    const restores = [
        stubProps(Game, { tile: () => here, tick: () => sample }),
        stubProps(Npcs, { all: () => [{ id: 896, networkTile: () => patrol(sample) }] as never }),
        stubProps(DirectNavigator, { walk: tile => { walks.push(tile); return true; } }),
        stubProps(Execution, { delayTicks: async () => { sample++; }, delayUntilTicks: async () => false })
    ];
    try {
        expect(await walkGarden(FOUNTAIN_STAND, () => {})).toBe(false);
        expect(walks).toHaveLength(2);
        expect(walks.at(-1)).toEqual(here);
    } finally {
        for (const restore of restores.reverse()) restore();
    }
});


test('a mid-gap stall retreats to a hedge before another patrol wait', async () => {
    let here = { x: 2909, z: 3460, level: 0 };
    let destination = { ...here };
    let stoppedTicks = 0;
    let sample = 14;
    const walks: { x: number; z: number }[] = [];
    const tick = async () => {
        sample++;
        if (here.x === 2912 && stoppedTicks < 2) { stoppedTicks++; return; }
        here = { ...here, x: here.x + Math.sign(destination.x - here.x) };
    };
    const restores = [
        stubProps(Game, { tile: () => here, tick: () => sample }),
        stubProps(Npcs, { all: () => [{ id: 896, networkTile: () => patrol(sample) }] as never }),
        stubProps(DirectNavigator, { walk: tile => { walks.push(tile); destination = { ...tile }; return true; } }),
        stubProps(Execution, { delayTicks: tick, delayUntilTicks: async (check, ticks) => {
            for (let i = 0; i < ticks && !check(); i++) await tick();
            return check();
        } })
    ];
    try {
        expect(await walkGarden(FOUNTAIN_STAND, () => {})).toBe(false);
        expect(walks).toHaveLength(2);
        expect(sheltered(here)).toBe(true);
        expect(here.x).toBe(2909);
    } finally {
        for (const restore of restores.reverse()) restore();
    }
});


test('stationary, missing, jumped and skipped observations invalidate the heading', () => {
    const first = observeWitch(null, patrol(10), 10);
    const moving = observeWitch(first, patrol(11), 11)!;
    expect(moving.direction).toBe(1);
    expect(observeWitch(moving, moving.tile, 12)?.direction).toBe(0);
    expect(observeWitch(moving, null, 12)).toBeNull();
    expect(observeWitch(null, patrol(40), 40)?.direction).toBe(0);
    expect(observeWitch(moving, patrol(13), 12)?.direction).toBe(0);
    expect(observeWitch(moving, patrol(12), 13)?.direction).toBe(0);
});


test.skipIf(!existsSync('out/collision.lcnav.gz'))('every planned corridor tile is walkable in the map', () => {
    const finder = new PathFinder(gunzipSync(readFileSync('out/collision.lcnav.gz')));
    for (const tile of gardenLegs(GARDEN_ENTRY, FOUNTAIN_STAND)!.flat()) {
        expect(finder.walkable(tile.x, tile.z, tile.level)).toBe(true);
    }
});


test('server movement does not look stalled while the sprite lags behind', async () => {
    const sprite = { x: 2909, z: 3460, level: 0 };
    let server = { ...sprite };
    let destination = { ...server };
    let tick = 14;
    const walks: { x: number; z: number }[] = [];
    const restores = [
        stubProps(Game, { tile: () => sprite, tick: () => tick }),
        stubProps(reader, { serverTile: () => server }),
        stubProps(Npcs, { all: () => [{ id: 896, networkTile: () => patrol(tick) }] as never }),
        stubProps(DirectNavigator, { walk: tile => { walks.push(tile); destination = { ...tile }; return true; } }),
        stubProps(Execution, { delayTicks: async () => {
            tick++;
            server = { ...server, x: server.x + Math.sign(destination.x - server.x) };
        } })
    ];
    try {
        expect(await walkGarden(new Tile(2915, 3460, 0), () => {})).toBe(true);
        expect(walks).toHaveLength(1);
        expect(server.x).toBe(2915);
        expect(sprite.x).toBe(2909);
    } finally {
        for (const restore of restores.reverse()) restore();
    }
});
