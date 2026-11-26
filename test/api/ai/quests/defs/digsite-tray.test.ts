import { expect, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { DIG_ID, DIG_TILE } from '#/bot/api/ai/quests/defs/digsite/areas.js';
import { takePanningTray } from '#/bot/api/ai/quests/defs/digsite/supplies.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { GroundItem } from '#/bot/api/model/GroundItem.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

for (const spawnTick of [0, 4, Infinity]) {
    test(`checks for the panning tray through its respawn window (spawn tick ${spawnTick})`, async () => {
        let tick = 0;
        let taken = 0;
        const restores = [
            stubProps(Game, { tile: () => DIG_TILE.TRAY_SPAWN_STAND }),
            stubProps(Inventory, { countById: id => id === DIG_ID.TRAY_EMPTY ? taken : 0 }),
            stubProps(reader, { groundItems: () => tick < spawnTick ? [] : [{
                id: DIG_ID.TRAY_EMPTY, name: 'Panning tray', count: 1, distance: 1,
                tile: DIG_TILE.TRAY_SPAWN_STAND, ops: ['Take']
            }] }),
            stubProps(GroundItem.prototype, { interact: () => { taken++; return true; } }),
            stubProps(Execution, { delayTicks: async n => { tick += n; }, delayUntil: async check => check() })
        ];
        try {
            expect(await takePanningTray(() => {})).toBe(Number.isFinite(spawnTick));
            expect(taken).toBe(Number.isFinite(spawnTick) ? 1 : 0);
            expect(tick).toBe(Math.min(spawnTick, 6));
        } finally {
            for (const restore of restores.reverse()) restore();
        }
    });
}
