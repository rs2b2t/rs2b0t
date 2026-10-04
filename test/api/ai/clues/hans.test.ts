import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { ClueExecutor } from '#/bot/api/ai/clues/ClueExecutor.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Game } from '#/bot/api/game/Game.js';
import { Npc } from '#/bot/api/model/Npc.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Reach } from '#/bot/api/walking/Reach.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { DirectNavigator } from '#/bot/event/webwalk/DirectNavigator.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import Tile from '#/bot/geometry/Tile.js';

const spot = new Tile(3221, 3218, 0);
let tick: number;
let energy: number;
let running: boolean;
let pending: boolean;
let clue: number;
let here: Tile;
let hans: Tile | null;
let dialogue: boolean;
let clickedAt: number | null;
let advance: () => void;
let walks: Tile[];
let clicks: { tick: number; energy: number; running: boolean; distance: number }[];

beforeEach(() => {
    ClueExecutor.resetSession();
    tick = 0; energy = 10; running = false; pending = false; clue = 2681;
    here = new Tile(3240, 3218, 0); hans = new Tile(3202, 3205, 0);
    dialogue = false; clickedAt = null; advance = () => {}; walks = []; clicks = [];
    spyOn(Game, 'tile').mockImplementation(() => here);
    spyOn(reader, 'worldTile').mockImplementation(() => here);
    spyOn(Game, 'energy').mockImplementation(() => energy);
    spyOn(Game, 'tick').mockImplementation(() => tick);
    spyOn(Game, 'runEnabled').mockImplementation(() => running);
    spyOn(actions, 'setRun').mockImplementation(on => { running = on; return true; });
    spyOn(EventSignal, 'pending').mockImplementation(() => pending);
    spyOn(Sustain, 'run').mockResolvedValue();
    spyOn(reader, 'inventory').mockImplementation(() => clue ? [{ id: clue, name: 'Clue scroll', count: 1, slot: 0, comId: 3214, ops: ['Read'] }] : []);
    spyOn(reader, 'npcs').mockImplementation(() => hans ? [{ id: 0, index: 1, name: 'Hans', level: 0, size: 1, anim: -1,
        tile: hans, distance: here.distanceTo(hans), ops: ['Talk-to'], inCombat: false, health: 10, totalHealth: 10, faceEntity: -1 }] : []);
    spyOn(ChatDialog, 'isOpen').mockImplementation(() => dialogue);
    spyOn(ChatDialog, 'canContinue').mockImplementation(() => dialogue);
    spyOn(ChatDialog, 'continue').mockImplementation(async () => { clue = 0; dialogue = false; pending = true; return true; });
    spyOn(Execution, 'delayTicks').mockImplementation(async n => { for (let i = 0; i < n; i++) { tick++; advance(); } });
    spyOn(Execution, 'delayUntil').mockImplementation(async fn => fn());
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async (fn, ticks) => {
        for (let i = 0; i < ticks && !fn(); i++) await Execution.delayTicks(1);
        return fn();
    });
    spyOn(Reachability, 'canReach').mockReturnValue(true);
    spyOn(Traversal, 'walkResilient').mockImplementation(async dest => {
        if (pending) return false;
        here = Tile.from(dest); walks.push(here); return true;
    });
    spyOn(DirectNavigator, 'walk').mockImplementation(dest => { here = Tile.from(dest); walks.push(here); return true; });
    spyOn(Reach, 'npcDialog').mockResolvedValue('retry');
    spyOn(Npc.prototype, 'interact').mockImplementation(function (this: Npc) {
        clicks.push({ tick, energy, running, distance: here.distanceTo(this.tile()) });
        clickedAt = tick;
        return true;
    });
});
afterEach(() => { mock.restore(); ClueExecutor.resetSession(); });

for (const id of [2681, 2792]) {
    test.each([25, 30])(`Hans clue ${id} waits for a late patrol and dialogue after %s ticks`, async delay => {
        clue = id;
        advance = () => {
            if (tick >= 150) hans = new Tile(3221, 3219, 0);
            if (clickedAt !== null && tick - clickedAt >= delay) dialogue = true;
        };
        expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');
        expect(clue).toBe(0);
        expect(clicks).toHaveLength(1);
        expect(clicks[0].tick).toBeGreaterThanOrEqual(150);
        expect(clicks[0].energy).toBe(10);
        expect(here).toEqual(spot);
        expect(walks.every(t => t.equals(spot))).toBe(true);
    });
}

test('low energy waits without chasing or spending the clue reset', async () => {
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');
    expect(tick).toBeGreaterThanOrEqual(200);
    expect(clue).toBe(2681);
    expect(clicks).toEqual([]);
    expect(here).toEqual(spot);
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');
    expect(clue).toBe(2681);
    expect(ClueExecutor.current?.target).toEqual(spot);
});

test('repeated adjacent dialogue failures share one patrol wait budget', async () => {
    hans = new Tile(3221, 3219, 0);
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');
    expect(tick).toBeGreaterThanOrEqual(200);
    expect(tick).toBeLessThanOrEqual(201);
    expect(clue).toBe(2681);
    expect(here).toEqual(spot);
});

test('high energy allows a bounded chase after waiting and enables run first', async () => {
    energy = 60;
    advance = () => { if (clickedAt !== null && tick - clickedAt >= 25) dialogue = true; };
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');
    expect(clue).toBe(0);
    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toMatchObject({ energy: 60, running: true });
    expect(clicks[0].tick).toBeGreaterThanOrEqual(200);
});

test.each(['energy', 'timeout', 'lost'] as const)('an unsuccessful chase returns to the wait spot after %s', async reason => {
    energy = 60;
    advance = () => {
        if (clickedAt === null) return;
        here = new Tile(3210, 3205, 0);
        if (reason === 'energy') energy = 19;
        if (reason === 'lost') hans = null;
    };
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');
    expect(clue).toBe(2681);
    expect(clicks).toHaveLength(1);
    expect(here).toEqual(spot);
    expect(tick - clicks[0].tick).toBeLessThanOrEqual(41);
});

test('a nearby Hans behind an obstacle is not clicked from the waiting spot', async () => {
    hans = new Tile(3221, 3219, 0);
    spyOn(Reachability, 'canReach').mockReturnValue(false);
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');
    expect(clicks).toEqual([]);
    expect(here).toEqual(spot);
});

test.each([30, 200])('a runtime event at tick %s interrupts the wait without chasing or abandoning', async eventTick => {
    energy = 60;
    advance = () => { if (tick === eventTick) pending = true; };
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');
    expect(tick).toBe(eventTick);
    expect(actions.setRun).not.toHaveBeenCalled();
    expect(clicks).toEqual([]);
    expect(clue).toBe(2681);
});

test('failing to enable run does not start a chase', async () => {
    energy = 60;
    spyOn(actions, 'setRun').mockReturnValue(false);
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');
    expect(clicks).toEqual([]);
    expect(clue).toBe(2681);
});

test('a nearby Hans walking away cancels the approach and resumes waiting at low energy', async () => {
    hans = new Tile(3221, 3219, 0);
    advance = () => {
        if (tick === 1) { here = new Tile(3221, 3219, 0); hans = new Tile(3219, 3225, 0); }
    };
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');
    expect(clicks).toHaveLength(1);
    expect(DirectNavigator.walk).toHaveBeenCalledWith(spot);
    expect(here).toEqual(spot);
    expect(clue).toBe(2681);
});

test('a runtime event during a chase prevents return movement from competing with it', async () => {
    energy = 60;
    advance = () => { if (clickedAt !== null) pending = true; };
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');
    expect(clicks).toHaveLength(1);
    expect(DirectNavigator.walk).not.toHaveBeenCalled();
    expect(clue).toBe(2681);
});
