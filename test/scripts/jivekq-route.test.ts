import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { actions, reader } from '../../src/bot/adapter/ClientAdapter.js';
import { Execution } from '../../src/bot/api/execution/Execution.js';
import { Game } from '../../src/bot/api/game/Game.js';
import { Skills } from '../../src/bot/api/skills/Skills.js';
import { ChatDialog } from '../../src/bot/api/ui/dialogue/ChatDialog.js';
import { Input } from '../../src/bot/input/Input.js';
import { camelot, descend, duelArena, pass } from '../../src/bot/scripts/JiveKQ/route.js';

afterEach(() => mock.restore());

test('crossing Shantay discards the disclaimer and preserves a spare pass', async () => {
    let disclaimer = true;
    spyOn(Game, 'tile').mockReturnValue({ x: 3304, z: 3116, level: 0 });
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(reader, 'inventory').mockImplementation(() => [
        { id: 1854, count: 1, slot: 0, comId: 3214, name: 'Shantay pass', ops: [null, null, null, null, 'Drop'] },
        ...(disclaimer ? [{ id: 1848, count: 1, slot: 1, comId: 3214, name: 'Shantay disclaimer', ops: ['Read', null, null, null, 'Drop'] }] : [])
    ]);
    const drop = spyOn(Input, 'heldOp').mockImplementation(id => { expect(id).toBe(1848); disclaimer = false; return true; });
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async condition => condition());
    expect(await pass(() => {})).toBe(true);
    expect(disclaimer).toBe(false);
    expect(drop).toHaveBeenCalledTimes(1);
});

test('an unconfirmed disclaimer drop retries before continuing the desert route', async () => {
    spyOn(Game, 'tile').mockReturnValue({ x: 3304, z: 3116, level: 0 });
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(reader, 'inventory').mockReturnValue([{ id: 1848, count: 1, slot: 1, comId: 3214, name: 'Shantay disclaimer', ops: ['Read', null, null, null, 'Drop'] }]);
    const drop = spyOn(Input, 'heldOp').mockReturnValue(true);
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async condition => condition());
    expect(await pass(() => {})).toBe(false);
    expect(await pass(() => {})).toBe(false);
    expect(drop).toHaveBeenCalledTimes(2);
});

test('the combat escape casts Camelot without opening a ring dialogue', async () => {
    let tile = { x: 3493, z: 9493, level: 0 };
    spyOn(Game, 'tile').mockImplementation(() => tile);
    spyOn(Skills, 'effective').mockReturnValue(49);
    const spells: string[] = [];
    spyOn(Game, 'teleport').mockImplementation(async name => { spells.push(name); return true; });
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async condition => {
        tile = { x: 2757, z: 3478, level: 0 };
        return condition();
    });
    expect(await camelot()).toBe(true);
    expect(spells).toEqual(['Camelot']);
});

test('a ring dialogue cancelled by an attack returns to survival checks within three ticks', async () => {
    let elapsed = 0;
    spyOn(Game, 'tile').mockReturnValue({ x: 3493, z: 9493, level: 0 });
    spyOn(Skills, 'effective').mockReturnValue(49);
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(reader, 'inventory').mockReturnValue([{ id: 2552, count: 1, slot: 0, comId: 3214, name: 'Ring of dueling(8)', ops: ['Wear', null, null, 'Rub'] }]);
    spyOn(Input, 'heldOp').mockReturnValue(true);
    spyOn(ChatDialog, 'options').mockReturnValue([]);
    spyOn(Execution, 'delayUntil').mockImplementation(async (condition, ms = 6000) => {
        if (condition()) return true;
        elapsed += ms;
        return false;
    });
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async (condition, ticks) => {
        if (condition()) return true;
        elapsed += ticks * 200;
        return false;
    });
    expect(await duelArena()).toBe(false);
    expect(elapsed).toBeGreaterThan(0);
    expect(elapsed).toBeLessThanOrEqual(600);
});

test('a ring prompt arriving with a critical hit returns to healing before teleporting', async () => {
    let hp = 49;
    let options: { text: string; comId: number }[] = [];
    let selected = false;
    spyOn(Game, 'tile').mockReturnValue({ x: 3493, z: 9493, level: 0 });
    spyOn(Skills, 'effective').mockImplementation(() => hp);
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(reader, 'inventory').mockReturnValue([{ id: 2552, count: 1, slot: 0, comId: 3214, name: 'Ring of dueling(8)', ops: ['Wear', null, null, 'Rub'] }]);
    spyOn(Input, 'heldOp').mockReturnValue(true);
    spyOn(reader, 'chatOptions').mockImplementation(() => options);
    spyOn(actions, 'ifButton').mockImplementation(() => { selected = true; return true; });
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async condition => {
        hp = 18;
        options = [{ text: 'Al Kharid Duel Arena.', comId: 123 }];
        return condition();
    });
    expect(await duelArena()).toBe(false);
    expect(selected).toBe(false);
});

test('an existing ring option completes the teleport without rubbing again', async () => {
    let tile = { x: 3493, z: 9493, level: 0 };
    spyOn(Game, 'tile').mockImplementation(() => tile);
    spyOn(Skills, 'effective').mockReturnValue(70);
    spyOn(reader, 'chatOptions').mockReturnValue([{ text: 'Al Kharid Duel Arena.', comId: 123 }]);
    spyOn(actions, 'ifButton').mockImplementation(() => { tile = { x: 3315, z: 3235, level: 0 }; return true; });
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async condition => condition());
    expect(await duelArena()).toBe(true);
});

test('incoming damage interrupts the arrival wait so the caller can heal', async () => {
    let hp = 59;
    let elapsed = 0;
    spyOn(Game, 'tile').mockReturnValue({ x: 3493, z: 9493, level: 0 });
    spyOn(Skills, 'effective').mockImplementation(() => hp);
    spyOn(reader, 'chatOptions').mockReturnValue([{ text: 'Al Kharid Duel Arena.', comId: 123 }]);
    spyOn(actions, 'ifButton').mockReturnValue(true);
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async (condition, ticks) => {
        for (let i = 0; i < ticks; i++) {
            if (condition()) return true;
            elapsed++;
            hp = 28;
        }
        return condition();
    });
    expect(await duelArena()).toBe(false);
    expect(elapsed).toBe(1);
});

test('an unacknowledged rope click retries without a five-second backoff', async () => {
    let tile = { x: 3226, z: 3108, level: 0 };
    let clicks = 0;
    let elapsed = 0;
    spyOn(Game, 'tile').mockImplementation(() => tile);
    spyOn(reader, 'locs').mockReturnValue([{ id: 3828, name: 'Tunnel entrance', tile: { x: 3226, z: 3106, level: 0 }, distance: 2, ops: ['Climb-down'], typecode: 1 }]);
    spyOn(reader, 'toLocal').mockReturnValue({ lx: 50, lz: 50 });
    spyOn(Input, 'interactLoc').mockImplementation(() => {
        if (++clicks === 2) tile = { x: 3483, z: 9510, level: 2 };
        return true;
    });
    spyOn(Execution, 'delayUntil').mockImplementation(async (condition, ms = 6000) => {
        if (condition()) return true;
        elapsed += ms;
        return false;
    });
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async (condition, ticks) => {
        if (condition()) return true;
        elapsed += ticks * 600;
        return false;
    });
    expect(await descend('surface')).toBe(false);
    expect(await descend('surface')).toBe(true);
    expect(elapsed).toBeLessThan(3000);
});
