import { afterEach, expect, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Loc } from '#/bot/api/locs/Locs.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { Game } from '#/bot/api/game/Game.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { SolveClue } from '#/bot/api/ai/clues/SolveClue.js';
import { ClueExecutor } from '#/bot/api/ai/clues/ClueExecutor.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import Tile from '#/bot/geometry/Tile.js';
import { scenario, restoreScenario } from './scheduler.fixture.js';

afterEach(restoreScenario);

async function clueScenario() {
    const fixture = await scenario('taverley-blue', 'range', { solveClues: true });
    const task = fixture.task('SolveClue');
    if (!(task instanceof SolveClue)) throw new Error('Missing clue task');
    spyOn(task, 'validate').mockRestore();
    spyOn(Inventory, 'items').mockReturnValue([new InvItem({ id: 3490, name: 'Clue scroll', count: 1, slot: 0, comId: 1, ops: ['Read'] })]);
    return { ...fixture, clue: task };
}

test('does not hand off an early clue while the victim is alive', async () => {
    const fixture = await clueScenario();
    await fixture.engage();
    expect(fixture.fight.blocksLoot()).toBe(true);
    expect(fixture.clue.validate()).toBe(false);
});

test('does not hand off a clue while safe food return is pending', async () => {
    const fixture = await clueScenario();
    fixture.bot.lootRun = { food: [] };
    expect(fixture.clue.validate()).toBe(false);
});

test('hands off after fight and loot finish without changing emergency or ammo priority', async () => {
    const fixture = await clueScenario();
    expect(fixture.clue.validate()).toBe(true);
    const tasks = fixture.bot['tasks'];
    expect(tasks.indexOf(fixture.task('GearEquip'))).toBeLessThan(tasks.indexOf(fixture.clue));
    expect(tasks.indexOf(fixture.task('PanicBank'))).toBeLessThan(tasks.indexOf(fixture.clue));
    expect(tasks.indexOf(fixture.task('Retreat'))).toBeLessThan(tasks.indexOf(fixture.clue));
});

test.each(['teleport', 'missing runes', 'failed teleport', 'failed egress'])('uses existing %s egress before the preferred Falador bank', async mode => {
    const fixture = await clueScenario();
    let here = new Tile(2900, 9800, 0);
    const events: string[] = [];
    const upkeep = async (): Promise<void> => {};
    Sustain.set(upkeep);
    spyOn(reader, 'locs').mockImplementation(() => mode === 'failed egress' ? [] : [{
        id: 2623, typecode: 0, name: 'Gate', ops: ['Open'], tile: new Tile(2923, 9803, 0), distance: 0
    }]);
    spyOn(Loc.prototype, 'interact').mockImplementation(async () => {
        events.push('gate');
        here = new Tile(2924, 9803, 0);
        return true;
    });
    spyOn(Game, 'tile').mockImplementation(() => here);
    spyOn(Skills, 'level').mockReturnValue(99);
    spyOn(Inventory, 'count').mockReturnValue(mode === 'missing runes' || mode === 'failed egress' ? 0 : 100);
    spyOn(Game, 'teleport').mockImplementation(async () => {
        expect(Sustain.hook).toBe(upkeep);
        events.push('teleport');
        if (mode === 'failed teleport') return false;
        here = new Tile(2965, 3379, 0);
        return true;
    });
    spyOn(Traversal, 'walkResilient').mockImplementation(async tile => {
        expect(Sustain.hook).toBe(upkeep);
        events.push(`walk:${tile.x},${tile.z}`);
        if (mode === 'failed egress') return false;
        here = Tile.from(tile);
        return true;
    });
    spyOn(Bank, 'openNearest').mockImplementation(async () => {
        events.push(`open:${here.x},${here.z}`);
        return false;
    });
    await fixture.clue.execute();
    expect(events).not.toContain('walk:3094,3493');
    expect(fixture.clue['bankedThisSolve']).toBe(false);
    if (mode === 'failed egress') {
        expect(events).toEqual(['walk:2923,9803', 'walk:2923,9803']);
        expect(events.some(event => event.startsWith('open:'))).toBe(false);
    } else {
        expect(events.at(-1)).toBe('open:2946,3369');
        expect(events.at(-2)).toBe('walk:2946,3369');
        expect(events.length).toBeGreaterThan(2);
    }
});

test('Jive deposits corpse loot at Falador before invoking the clue executor without combat restock', async () => {
    const fixture = await clueScenario();
    let here = new Tile(2900, 9800, 0);
    let pack = [3490, 536].map((id, slot) => new InvItem({ id, slot, name: id === 3490 ? 'Clue scroll' : 'Dragon bones', count: 1, comId: 1, ops: ['Read'] }));
    const events: string[] = [];
    const withdrawals: string[] = [];
    spyOn(Game, 'tile').mockImplementation(() => here);
    spyOn(Inventory, 'items').mockImplementation(() => pack);
    spyOn(Inventory, 'count').mockReturnValue(100);
    spyOn(Game, 'teleport').mockImplementation(async () => { events.push('exit'); here = new Tile(2965, 3379, 0); return true; });
    spyOn(Traversal, 'walkResilient').mockImplementation(async tile => { here = Tile.from(tile); events.push(`walk:${here.x},${here.z}`); return true; });
    spyOn(Bank, 'isOpen').mockReturnValue(true);
    spyOn(reader, 'bankSnapshotReady').mockReturnValue(true);
    spyOn(Bank, 'openNearest').mockImplementation(async () => { events.push(`open:${here.x},${here.z}`); return true; });
    spyOn(Bank, 'depositAllMatching').mockImplementation(async predicate => {
        events.push('deposit');
        pack = pack.filter(item => !predicate(item.name ?? '', item.id));
    });
    spyOn(Bank, 'withdraw').mockImplementation(async name => { withdrawals.push(name); return false; });
    spyOn(Bank, 'withdrawX').mockImplementation(async name => { withdrawals.push(name); return false; });
    spyOn(ClueExecutor, 'solveHeldClue').mockImplementation(async () => {
        expect(pack.map(item => item.id)).toEqual([3490]);
        events.push('solve');
        return 'yield';
    });
    await fixture.clue.execute();
    expect(events).toEqual(['exit', 'walk:2946,3369', 'open:2946,3369', 'deposit', 'solve']);
    expect(fixture.bot.bankTrips).toBe(0);
    expect(withdrawals).not.toContain('Rune arrow');
});
