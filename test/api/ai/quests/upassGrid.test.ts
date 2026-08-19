import { afterAll, describe, expect, test } from 'bun:test';

import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { crossGrid } from '#/bot/api/ai/quests/defs/upass/grid.js';
import { pastGridTile } from '#/bot/api/ai/quests/defs/upass/areas.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Locs } from '#/bot/api/locs/Locs.js';
import { stalledApproach, stalledJourney } from '#/bot/api/ai/quests/defs/upass/stall.js';

// Why: `Player.tryInteract` returns early on `!canAccess()`, and `canAccess()` is `!busy()` — so the script an op-click is aimed at cannot run while the quest journal is held open. The grid crossing rides the portcullis lever's `oploc1`, whose `~forcemove` chain is what carries the player through, so the walk arrives with the journal up and the script waits: an oracle reading only "through the portcullis" cannot answer true until the journal comes down. This fake is that ordering and nothing else.

const GRID_APPROACH = { x: 2479, z: 9679, level: 0 };
const LEVER_STAND = { x: 2466, z: 9673, level: 0 };

const sim = {
    tile: { ...GRID_APPROACH },
    modal: false,
    walkingTo: null as { x: number; z: number } | null,
    pendingOp: false,
    ticks: 0,
    pulls: 0,
    onIdleTick: null as null | (() => void)
};

function reset(at: { x: number; z: number; level: number }): void {
    sim.tile = { ...at };
    sim.modal = false;
    sim.walkingTo = null;
    sim.pendingOp = false;
    sim.ticks = 0;
    sim.pulls = 0;
    sim.onIdleTick = null;
}

function step(): void {
    sim.ticks++;
    if (sim.walkingTo !== null) {
        sim.tile = {
            x: sim.tile.x + Math.sign(sim.walkingTo.x - sim.tile.x),
            z: sim.tile.z + Math.sign(sim.walkingTo.z - sim.tile.z),
            level: 0
        };
        if (sim.tile.x === sim.walkingTo.x && sim.tile.z === sim.walkingTo.z) {
            sim.walkingTo = null;
        }
        return;
    }
    if (sim.onIdleTick !== null) {
        sim.onIdleTick();
        return;
    }
    if (sim.pendingOp && !sim.modal && sim.tile.x === LEVER_STAND.x && sim.tile.z === LEVER_STAND.z) {
        sim.pendingOp = false;
        sim.pulls++;
        sim.tile = { x: sim.tile.x - 2, z: sim.tile.z + 4, level: 0 };
    }
}

const TICK_CAP = 500;

async function ticks(n: number): Promise<void> {
    for (let i = 0; i < n && sim.ticks < TICK_CAP; i++) {
        step();
    }
}

async function until(cond: () => boolean, maxTicks: number): Promise<boolean> {
    for (let i = 0; i < maxTicks && sim.ticks < TICK_CAP; i++) {
        if (cond()) return true;
        await ticks(1);
    }
    return cond();
}

const real = {
    delayTicks: Execution.delayTicks,
    delayUntil: Execution.delayUntil,
    delayUntilTicks: Execution.delayUntilTicks,
    tile: Game.tile,
    query: Locs.query,
    worldTile: reader.worldTile,
    modals: reader.modals,
    questStatuses: reader.questStatuses,
    ifButton: actions.ifButton,
    closeModal: actions.closeModal
};

Execution.delayTicks = ticks;
Execution.delayUntil = (cond: () => boolean, timeoutMs = 6000) => until(cond, Math.ceil(timeoutMs / 600));
Execution.delayUntilTicks = until;
Game.tile = (() => sim.tile) as typeof Game.tile;
reader.worldTile = (() => sim.tile) as typeof reader.worldTile;
reader.modals = (() => ({ main: sim.modal ? 1 : -1, side: -1, chat: -1 })) as typeof reader.modals;
reader.questStatuses = (() => [{ comId: 7, name: 'Underground Pass', colour: 0 }]) as typeof reader.questStatuses;
actions.ifButton = ((comId: number) => {
    if (comId !== 7) return false;
    sim.modal = true;
    return true;
}) as typeof actions.ifButton;
actions.closeModal = (() => {
    sim.modal = false;
    return true;
}) as typeof actions.closeModal;
Locs.query = (() => {
    const q = {
        where: () => q,
        action: () => q,
        within: () => q,
        // Why: the op-click routes the player to the lever and leaves the interaction pending, which is the
        // half of it the client can see.
        nearest: () => ({
            interact: async (): Promise<boolean> => {
                sim.walkingTo = { x: LEVER_STAND.x, z: LEVER_STAND.z };
                sim.pendingOp = true;
                return true;
            }
        })
    };
    return q;
}) as unknown as typeof Locs.query;

afterAll(() => {
    Execution.delayTicks = real.delayTicks;
    Execution.delayUntil = real.delayUntil;
    Execution.delayUntilTicks = real.delayUntilTicks;
    Game.tile = real.tile;
    Locs.query = real.query;
    reader.worldTile = real.worldTile;
    reader.modals = real.modals;
    reader.questStatuses = real.questStatuses;
    actions.ifButton = real.ifButton;
    actions.closeModal = real.closeModal;
});

describe('a stalled walk whose oracle waits on a script', () => {
    test('stops when the walk does, rather than sitting out the timeout under a modal nothing can run', async () => {
        reset(GRID_APPROACH);
        const lines: string[] = [];

        // Why: an inventory oracle is the shape every corridor goal uses — the orb pickup, the furnace, the well. None of them can come true while the journal is up, so once the walk stops there is nothing left to wait for.
        const carried = await stalledApproach({
            send: async () => {
                sim.walkingTo = { x: LEVER_STAND.x, z: LEVER_STAND.z };
                sim.pendingOp = true;
                return true;
            },
            what: 'a script the modal will not let run',
            arrived: () => sim.pulls > 0,
            hold: true,
            log: m => lines.push(m)
        });

        expect(carried).toBe(false);
        expect(sim.tile).toEqual({ x: LEVER_STAND.x, z: LEVER_STAND.z, level: 0 });
        expect(lines.filter(l => l.includes('never reached the far side'))).toEqual([]);
        expect(sim.ticks).toBeLessThan(30);
    }, 60_000);
});

describe('a journey whose goal is an op script', () => {
    test('drops the journal at the goal and finishes it, rather than reporting nothing steps there', async () => {
        reset({ x: LEVER_STAND.x + 4, z: LEVER_STAND.z, level: 0 });
        const lines: string[] = [];
        const ORB = { x: LEVER_STAND.x, z: LEVER_STAND.z };

        // Why: the orb pickups, the furnace and the well are all this shape — the op-click walks the character
        // onto the goal, the journal goes up for that walk, and the Take cannot run until it comes down again.
        sim.onIdleTick = () => {
            if (sim.pendingOp && !sim.modal && sim.tile.x === ORB.x && sim.tile.z === ORB.z) {
                sim.pendingOp = false;
                sim.pulls++;
            }
        };
        const reached = await stalledJourney({
            goal: {
                inRange: () => true,
                arrived: () => sim.pulls > 0,
                what: 'the Orb of light',
                send: async () => {
                    sim.walkingTo = { ...ORB };
                    sim.pendingOp = true;
                    return true;
                }
            },
            nextStone: () => null,
            log: m => lines.push(m)
        });

        expect(reached).toBe(true);
        expect(sim.pulls).toBe(1);
        expect(sim.modal).toBe(false);
        expect(lines.filter(l => l.includes('steps toward'))).toEqual([]);
        expect(sim.ticks).toBeLessThan(30);
    }, 60_000);
});

describe('the spiked grid crossing', () => {
    test('lets the lever fire and carries the player through, without waiting out the stall timeout', async () => {
        reset(GRID_APPROACH);
        const lines: string[] = [];

        const crossed = await crossGrid(m => lines.push(m));

        expect(crossed).toBe(true);
        expect(pastGridTile(sim.tile)).toBe(true);
        expect(sim.pulls).toBe(1);
        expect(sim.modal).toBe(false);
        expect(lines.filter(l => l.includes('never reached the far side'))).toEqual([]);
        expect(lines.filter(l => l.includes('recovering'))).toEqual([]);
        expect(sim.ticks).toBeLessThan(40);
    }, 60_000);
});
