import { afterEach, expect, spyOn, test } from 'bun:test';
import { GroundItem } from '#/bot/api/grounditems/GroundItems.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import Tile from '#/bot/geometry/Tile.js';
import { held, lootScenario } from './loot.fixture.js';
import { restoreScenario } from './scheduler.fixture.js';

afterEach(restoreScenario);

for (const change of ['shrink', 'replace', 'disappear', 'stable']) {
    test(`Rune pile is rechecked at Take when movement makes it ${change}`, async () => {
        const { world, bot, anchor, corpse, drop, task, fight, state, dragon, engage } = await lootScenario({}, 'taverley-blue');
        state.npcs = [dragon];
        await engage();
        const pile = drop(892, corpse, 4);
        state.npcs = [];
        await fight.execute();
        spyOn(Reachability, 'canReach').mockReturnValue(false);
        spyOn(Traversal, 'walkResilient').mockImplementation(async tile => {
            world.here = Tile.from(tile);
            if (world.here.equals(corpse)) {
                if (change === 'shrink') pile.count = 3;
                if (change === 'replace' || change === 'disappear') world.ground.splice(0);
                if (change === 'replace') drop(892, corpse, 3);
            }
            return true;
        });
        const takes = spyOn(GroundItem.prototype, 'interact');

        await task('LootCorpse').execute();

        expect(takes.mock.calls.filter(([action]) => action === 'Take')).toHaveLength(change === 'stable' ? 1 : 0);
        expect(world.pack.find(item => item.id === 892)?.count).toBe(change === 'stable' ? 104 : 100);
        expect(world.here).toEqual(anchor);
        expect(bot.lootRun).toBeNull();
        expect(task('LootCorpse').validate()).toBe(false);
    });
}

for (const count of [1, 3, 4, 9]) {
    test(`blue ranged Rune pile ${count} is eligible only at four per pile after death`, async () => {
        const { world, drop, task, fight, state, dragon, engage } = await lootScenario({}, 'taverley-blue');
        state.npcs = [dragon];
        await engage();
        drop(892, undefined, count);
        expect(task('LootCorpse').validate()).toBe(false);

        state.npcs = [];
        await fight.execute();
        await task('LootCorpse').execute();

        expect(world.events.filter(e => e.action === 'Take' && e.id === 892)).toHaveLength(count >= 4 ? 1 : 0);
        expect(task('LootCorpse').validate()).toBe(false);
    });
}

test('separate small Rune piles do not sum or prevent return and food reclaim', async () => {
    const { world, bot, anchor, corpse, drop, task } = await lootScenario({}, 'taverley-blue');
    world.pack.splice(0, 1);
    world.here = corpse;
    drop(892, corpse, 3);
    drop(892, new Tile(corpse.x + 1, corpse.z, 0), 3);
    drop(379, anchor);
    bot.lootRun = { food: [{ id: 379, tile: anchor }] };

    await task('LootCorpse').execute();

    expect(world.events.map(e => [e.action, e.id])).toEqual([['Walk', -1], ['Take', 379]]);
    expect(world.here).toEqual(anchor);
    expect(bot.lootRun).toBeNull();
    expect(task('LootCorpse').validate()).toBe(false);
    expect(task('FreeSlot').validate()).toBe(false);
});

for (const [site, style] of [['taverley-black', 'range'], ['taverley-blue', 'melee'], ['taverley-blue', 'mage']]) {
    test(`${site} ${style} keeps single Rune piles eligible`, async () => {
        const { world, drop, task } = await lootScenario({ loot: ['Rune arrow'] }, site, style);
        drop(892);

        await task('LootCorpse').execute();

        expect(world.events.filter(e => e.action === 'Take' && e.id === 892)).toHaveLength(1);
    });
}

test('small Rune piles preserve bones then burial then hide then other loot in a full pack', async () => {
    const { world, drop, run } = await lootScenario({ loot: ['Dragonhide', 'Coins'] }, 'taverley-blue');
    world.pack[0] = held(995, 10);
    drop(892, undefined, 3);
    drop(995, undefined, 1);
    drop(1747);
    drop(536);

    await run(5);

    expect(world.events.filter(e => e.action === 'Take' || e.action === 'Bury').map(e => [e.action, e.id]))
        .toEqual([['Take', 536], ['Bury', 536], ['Take', 1747], ['Take', 995]]);
});
