import { expect, test } from 'bun:test';
import { decide } from '#/bot/api/ai/quests/defs/deathplateau/index.js';
import { DP_FLAG, DP_STAGE } from '#/bot/api/ai/quests/defs/deathplateau/journal.js';
import { DEATH_ITEM, TILE } from '#/bot/api/ai/quests/defs/deathplateau/areas.js';
import { Game } from '#/bot/api/game/Game.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import Tile from '#/bot/geometry/Tile.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

test('scouting enters the trigger zone instead of stopping south of it', async () => {
    let tile = TILE.TENZING_BACK;
    const restores = [
        stubProps(Game, { tile: () => tile }),
        stubProps(reader, { locs: () => [], modals: () => ({ main: -1, chat: -1, side: -1 }) }),
        stubProps(Execution, { delayTicks: async () => {}, delayUntil: async check => check() }),
        stubProps(Traversal, { walkResilient: async (dest, options) => {
            tile = new Tile(dest.x, dest.z - (options?.radius ?? 0), dest.level);
            return true;
        } })
    ];
    try {
        const stage = DP_STAGE.UNLOCKED_DOOR;
        const step = decide({
            journal: 'inProgress', stage,
            progress: { stage, flags: new Set([DP_FLAG.SABA, DP_FLAG.TENZING, DP_FLAG.SMITHY,
                DP_FLAG.ENTRANCE_CERT, DP_FLAG.GIVEN_CERT, DP_FLAG.SUPPLIES, DP_FLAG.GOT_MAP]) },
            inv: new Map([['secret way map', 1], ['combination', 1]]),
            invIds: new Map([[DEATH_ITEM.SECRET_MAP.id, 1], [DEATH_ITEM.COMBINATION.id, 1]]),
            worn: new Set(), bank: new Map(), bankKnown: true, bankCoins: 0, noProgress: 0, tile
        });
        expect(step.kind).toBe('custom');
        if (step.kind !== 'custom') throw new Error('expected the scout step');
        expect(await step.run(() => {})).toBe(true);
        expect(tile.x).toBeGreaterThanOrEqual(2864);
        expect(tile.x).toBeLessThan(2872);
        expect(tile.z).toBeGreaterThanOrEqual(3608);
        expect(tile.z).toBeLessThan(3616);
    } finally {
        for (const restore of restores.reverse()) restore();
    }
});
