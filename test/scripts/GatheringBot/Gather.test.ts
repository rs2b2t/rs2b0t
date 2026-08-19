import { describe, expect, test } from 'bun:test';
import { Gather } from '#/bot/scripts/GatheringBot/GatheringBotTasks.js';
import Tile from '#/bot/geometry/Tile.js';

function makeBot() {
    const rejected = new Set<string>();
    const logs: string[] = [];
    return {
        rejected,
        logs,
        reject: (k: string) => rejected.add(k),
        log: (m: string) => logs.push(m),
        targetName: () => 'Yew'
    };
}

describe('Gather unreachable-resource banning', () => {
    // Why: a fenced tree the walker can never reach must stop re-walking after
    // two failed attempts and roll a different resource instead of looping.
    test('bans a tile only after two failed attempts', () => {
        const bot = makeBot();
        const gather = new Gather(bot as never);
        const tile = new Tile(3085, 3468, 0);
        const key = '3085,3468';

        (gather as unknown as { banOnRepeatGatherFail(k: string, t: Tile): void }).banOnRepeatGatherFail(key, tile);
        expect(bot.rejected.has(key)).toBe(false);

        (gather as unknown as { banOnRepeatGatherFail(k: string, t: Tile): void }).banOnRepeatGatherFail(key, tile);
        expect(bot.rejected.has(key)).toBe(true);
        expect(bot.logs.some(l => l.includes('banned'))).toBe(true);
    });

    test('a successful click clears the strike so a good tree is never banned', () => {
        const bot = makeBot();
        const gather = new Gather(bot as never);
        const tile = new Tile(3085, 3468, 0);
        const key = '3085,3468';

        (gather as unknown as { banOnRepeatGatherFail(k: string, t: Tile): void }).banOnRepeatGatherFail(key, tile);
        expect(bot.rejected.has(key)).toBe(false);
        // A later successful chop clears the counter (mimics executeMine deleting the key).
        (gather as unknown as { gatherClickFails: Map<string, number> }).gatherClickFails.delete(key);
        (gather as unknown as { banOnRepeatGatherFail(k: string, t: Tile): void }).banOnRepeatGatherFail(key, tile);
        expect(bot.rejected.has(key)).toBe(false);
    });
});
