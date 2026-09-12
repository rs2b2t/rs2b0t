import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { fillCrate } from '#/bot/api/ai/quests/defs/piratestreasure/karamja.js';
import * as crate from '#/bot/api/ai/quests/defs/piratestreasure/crate.js';
import * as prompts from '#/bot/api/ai/quests/exec/prompts.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Locs, Loc } from '#/bot/api/locs/Locs.js';

afterEach(() => mock.restore());

test('fills ten bananas with only one free inventory slot', async () => {
    let held = 0;
    let packed = 0;
    spyOn(crate, 'searchBananaCrate').mockImplementation(async () => ({ rum: false, bananas: packed }));
    spyOn(Inventory, 'countById').mockImplementation(id => id === 1963 ? held : 0);
    spyOn(Inventory, 'isFull').mockImplementation(() => held === 1);
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    spyOn(Sustain, 'run').mockResolvedValue();
    spyOn(Traversal, 'walkResilient').mockResolvedValue(true);
    spyOn(prompts, 'settleScene').mockResolvedValue();
    spyOn(prompts, 'useOnLoc').mockImplementation(async () => {
        held--;
        packed++;
        return true;
    });
    const query = Locs.query();
    spyOn(Locs, 'query').mockReturnValue(query);
    const pick = mock(async () => {
        expect(held).toBe(0);
        held++;
        return true;
    });
    const tree = new Loc({ typecode: 0, id: 2073, name: 'Banana Tree', tile: { x: 2926, z: 3160, level: 0 }, ops: ['Search'], distance: 1 });
    spyOn(tree, 'interact').mockImplementation(pick);
    spyOn(query, 'nearest').mockReturnValue(tree);
    expect(await fillCrate(() => {})).toBe(true);
    expect(packed).toBe(10);
    expect(pick).toHaveBeenCalledTimes(10);
});
