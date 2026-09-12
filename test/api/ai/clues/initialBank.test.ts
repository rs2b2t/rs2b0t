import { afterEach, beforeEach, expect, spyOn, test, mock } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { SolveClue, type SolveClueHost } from '#/bot/api/ai/clues/SolveClue.js';
import { ClueExecutor } from '#/bot/api/ai/clues/ClueExecutor.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Loc } from '#/bot/api/locs/Locs.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import Tile from '#/bot/geometry/Tile.js';

const clue: InvItemSnapshot = { id: 3490, name: 'Clue scroll (easy)', count: 1, slot: 0, comId: 1, ops: ['Read'] };
let pack: InvItemSnapshot[];
let here: Tile;
let events: string[];
let open: boolean;
let rejectOpen: boolean;
let rejectDeposit: boolean;
const upkeep = async (): Promise<void> => {};
const host: SolveClueHost = {
    log: () => {}, setStatus: () => {}, isFood: n => n === 'Lobster',
    foodName: () => '', foodWithdraw: () => 20, useTeleports: () => false, restorePrayer: () => false
};

beforeEach(() => {
    pack = [clue, { ...clue, id: 536, name: 'Dragon bones', slot: 1 }];
    here = new Tile(2900, 9800, 0);
    events = [];
    open = false;
    rejectOpen = false;
    rejectDeposit = false;
    Sustain.set(upkeep);
    spyOn(reader, 'inventory').mockImplementation(() => pack);
    spyOn(reader, 'bankSideItems').mockImplementation(() => pack);
    spyOn(reader, 'bankComId').mockImplementation(() => open ? 1 : -1);
    spyOn(reader, 'bankSnapshotReady').mockReturnValue(true);
    spyOn(reader, 'bankItems').mockReturnValue([]);
    spyOn(Game, 'tile').mockImplementation(() => here);
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    spyOn(Traversal, 'walkResilient').mockImplementation(async tile => {
        here = Tile.from(tile);
        events.push(`walk:${here.x},${here.z}`);
        return true;
    });
    spyOn(Bank, 'openNearest').mockImplementation(async () => {
        events.push(`open:${here.x},${here.z}`);
        open = !rejectOpen;
        return open;
    });
    spyOn(Bank, 'depositAllMatching').mockImplementation(async predicate => {
        events.push('deposit');
        if (!rejectDeposit) pack = pack.filter(item => !predicate(item.name ?? '', item.id));
    });
    spyOn(Bank, 'withdraw').mockReturnValue(false);
    spyOn(Bank, 'withdrawX').mockResolvedValue(false);
    spyOn(ClueExecutor, 'solveHeldClue').mockImplementation(async () => {
        events.push('solve');
        return 'yield';
    });
});
afterEach(() => { mock.restore(); Sustain.set(null); });

async function prepareInitialBank(): Promise<boolean> {
    expect(Sustain.hook).toBe(upkeep);
    events.push('exit');
    here = new Tile(2946, 3369, 0);
    return true;
}

test('keeps the clue and deposits loot before solving at the caller bank', async () => {
    const task = new SolveClue({ ...host, prepareInitialBank });
    await task.execute();
    expect(events).toEqual(['exit', 'open:2946,3369', 'deposit', 'solve']);
    expect(pack).toEqual([clue]);
    expect(task['bankedThisSolve']).toBe(true);
    expect(Sustain.hook).toBe(upkeep);
});

test('blocks solving and banking when initial preparation fails even without a known tile', async () => {
    spyOn(Game, 'tile').mockReturnValue(null);
    const task = new SolveClue({ ...host, prepareInitialBank: async () => false });
    await task.execute();
    expect(events).toEqual([]);
    expect(task['bankedThisSolve']).toBe(false);
    expect(pack[0]).toEqual(clue);
    expect(Sustain.hook).toBe(upkeep);
});

test.each(['open', 'deposit'])('blocks solving and keeps the clue when %s fails', async failure => {
    rejectOpen = failure === 'open';
    rejectDeposit = failure === 'deposit';
    const task = new SolveClue({ ...host, prepareInitialBank });
    await task.execute();
    expect(events).not.toContain('solve');
    expect(task['bankedThisSolve']).toBe(false);
    expect(pack[0]).toEqual(clue);
});

test('keeps the default nearest-bank route for a generic caller', async () => {
    const task = new SolveClue(host);
    await task.execute();
    expect(events).toEqual(['walk:3094,3493', 'open:3094,3493', 'deposit', 'solve']);
});

test('keeps the legacy no-known-bank behavior for a generic caller', async () => {
    spyOn(Game, 'tile').mockReturnValue(null);
    await new SolveClue(host).execute();
    expect(events).toEqual(['solve']);
});

test('uses the default bank for a mid-trail restock without repeating caller preparation', async () => {
    const task = new SolveClue({ ...host, foodName: () => 'Lobster', prepareInitialBank });
    task['bankedThisSolve'] = true;
    await task.execute();
    expect(events).toEqual(['walk:3094,3493', 'open:3094,3493', 'deposit', 'solve']);
});

test.each([true, false])('requires an actual open bank after the booth interaction succeeds=%s', async succeeds => {
    spyOn(Bank, 'openNearest').mockRestore();
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(reader, 'locs').mockImplementation(() => [{
        id: 2213, typecode: 0, name: 'Bank booth', ops: ['Use-quickly'], tile: here, distance: 0
    }]);
    spyOn(Loc.prototype, 'interact').mockImplementation(async () => {
        expect(here).toEqual(new Tile(2946, 3369, 0));
        open = succeeds;
        return true;
    });
    const task = new SolveClue({ ...host, prepareInitialBank });
    await task.execute();
    expect(events.includes('solve')).toBe(succeeds);
    expect(task['bankedThisSolve']).toBe(succeeds);
    expect(pack[0]).toEqual(clue);
});

test('restores Entrana gear at the default bank without caller preparation', async () => {
    spyOn(Bank, 'close').mockImplementation(async () => { open = false; return true; });
    spyOn(ClueExecutor, 'solveHeldClue').mockImplementation(async () => { events.push('solve'); return 'abandon'; });
    const task = new SolveClue({ ...host, prepareInitialBank });
    task['bankedThisSolve'] = true;
    task['strippedGear'] = ['Rune platebody'];
    await task.execute();
    expect(events).toEqual(['solve', 'walk:3094,3493', 'open:3094,3493']);
});

test('blocks the initial handoff when the bank opens without a ready snapshot', async () => {
    spyOn(reader, 'bankSnapshotReady').mockReturnValue(false);
    const task = new SolveClue({ ...host, prepareInitialBank });
    await task.execute();
    expect(events).toEqual(['exit', 'open:2946,3369']);
    expect(task['bankedThisSolve']).toBe(false);
    expect(pack[0]).toEqual(clue);
});

test('returns hard reward preparation to the initial Falador bank without repeating its hook', async () => {
    spyOn(Bank, 'close').mockImplementation(async () => { open = false; return true; });
    spyOn(ClueExecutor, 'solveHeldClue').mockImplementation(async (_log, rewards) => {
        pack = [{ ...clue, id: 2724, name: 'Casket' }];
        here = new Tile(3200, 3200, 0);
        expect(await rewards?.prepare?.(2724)).toBe(true);
        return 'yield';
    });
    const task = new SolveClue({ ...host, prepareInitialBank });
    await task.execute();
    expect(events).toEqual(['exit', 'open:2946,3369', 'deposit', 'walk:2946,3369', 'open:2946,3369', 'deposit']);
    expect(pack.map(i => i.id)).toEqual([2724]);
    expect(Sustain.hook).toBe(upkeep);
});
