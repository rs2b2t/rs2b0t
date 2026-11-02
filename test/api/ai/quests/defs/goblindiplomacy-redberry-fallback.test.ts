import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { acquireRedberries } from '#/bot/api/ai/quests/defs/goblindiplomacy/redberries.js';
import * as steps from '#/bot/api/ai/quests/exec/steps.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';

afterEach(() => mock.restore());

for (const shopStock of [0, 1]) {
    test(`gathers missing berries when Wydin only has ${shopStock}`, async () => {
        let held = 0;
        spyOn(Inventory, 'count').mockImplementation(name => name === 'Redberries' ? held : 1000);
        spyOn(Inventory, 'isFull').mockReturnValue(false);
        spyOn(Game, 'tile').mockReturnValue({x: 3014, z: 3204, level: 0});
        spyOn(EventSignal, 'pending').mockReturnValue(false);
        spyOn(Sustain, 'run').mockResolvedValue(undefined);
        spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
        spyOn(steps, 'executeStep').mockImplementation(async step => {
            if (step.kind === 'buy') held = Math.max(held, shopStock);
            if (step.kind === 'grabGround') held++;
            return true;
        });
        expect(await acquireRedberries(() => {})).toBe(true);
        expect(held).toBe(3);
    });
}
