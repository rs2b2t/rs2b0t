import { expect, test } from 'bun:test';
import { installKbdDoseTrace, type KbdDoseSource } from '../../e2e/jivekbd-dose-trace.js';

const surface = { x: 3017, z: 3848, level: 0 };
const dungeon = { x: 3069, z: 10255, level: 0 };

function fixture(drinkAntipoison: () => Promise<boolean>) {
    const tile = { ...surface };
    const bot = { drinkAntipoison };
    const source: KbdDoseSource = {
        __rs2b0t: { Game: { tile: () => tile } },
        rs2b0t: { host: { tickCount: 100 }, runner: { bot } }
    };
    installKbdDoseTrace(source);
    return { bot, source, move() { Object.assign(tile, dungeon); } };
}

test('retains the confirmed surface location when the ladder is used before the next poll', async () => {
    const h = fixture(async () => true);
    await h.bot.drinkAntipoison();
    h.move();
    expect(h.source.__rs2b0t.Game.tile()).toEqual(dungeon);
    expect(h.source.__jiveKbdDoseTrace?.events).toEqual([{ at: expect.any(Number), tick: 100, tile: surface }]);
});

test('does not claim a dose until consumption succeeds', async () => {
    const done = Promise.withResolvers<boolean>();
    const h = fixture(() => done.promise);
    const pending = h.bot.drinkAntipoison();
    expect(h.source.__jiveKbdDoseTrace?.events).toEqual([]);
    done.resolve(false);
    expect(await pending).toBe(false);
    expect(h.source.__jiveKbdDoseTrace?.events).toEqual([]);
});

test('records an underground dose as underground instead of claiming surface protection', async () => {
    const h = fixture(async () => true);
    h.move();
    await h.bot.drinkAntipoison();
    expect(h.source.__jiveKbdDoseTrace?.events[0].tile).toEqual(dungeon);
});

test('restores the original method without changing the successful result', async () => {
    const drink = async () => true;
    const h = fixture(drink);
    expect(await h.bot.drinkAntipoison()).toBe(true);
    h.source.__jiveKbdDoseTrace?.restore();
    expect(h.bot.drinkAntipoison).toBe(drink);
    await h.bot.drinkAntipoison();
    expect(h.source.__jiveKbdDoseTrace?.events).toHaveLength(1);
});
