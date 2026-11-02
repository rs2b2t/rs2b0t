import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type GroundItemSnapshot, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Banking } from '#/bot/api/bank/Banking.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { GroundItem } from '#/bot/api/grounditems/GroundItems.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Reach } from '#/bot/api/walking/Reach.js';
import { Navigator } from '#/bot/event/webwalk/Navigator.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import Tile from '#/bot/geometry/Tile.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import WanderLooter from '#/bot/scripts/WanderLooter/WanderLooter.js';
import {
    IdleBank,
    LootDrops,
    Wander
} from '#/bot/scripts/WanderLooter/WanderLooterTasks.js';

const PUMPKIN_ID = 1959;
const TILE = { x: 3200, z: 3200, level: 0 };

const pumpkin = (x = TILE.x, z = TILE.z): GroundItemSnapshot => ({
    id: PUMPKIN_ID,
    name: 'Pumpkin',
    count: 1,
    ops: ['Take'],
    tile: { x, z, level: 0 },
    distance: Math.max(Math.abs(x - TILE.x), Math.abs(z - TILE.z))
});

const held = (): InvItemSnapshot => ({
    id: PUMPKIN_ID,
    name: 'Pumpkin',
    count: 1,
    slot: 0,
    comId: 3214,
    ops: []
});

let active: WanderLooter | undefined;
afterEach(() => {
    active?.disposeSubscriptions();
    Sustain.set(null);
    mock.restore();
});

async function scenario() {
    const world = { ground: [pumpkin()], pack: [] as InvItemSnapshot[], now: 1_000, hp: 10 };
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue({ ...TILE });
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    spyOn(Execution, 'delayTicks').mockImplementation(async () => {});
    spyOn(reader, 'groundItems').mockImplementation(() => world.ground);
    spyOn(reader, 'inventory').mockImplementation(() => world.pack);
    spyOn(reader, 'inventorySize').mockReturnValue(28);
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(reader, 'equipment').mockReturnValue([]);
    spyOn(reader, 'worldTile').mockReturnValue({ ...TILE });
    spyOn(reader, 'toLocal').mockImplementation((x, z) => ({ lx: x - 3180, lz: z - 3180 }));
    spyOn(reader, 'collisionFlags').mockReturnValue(0);
    spyOn(Skills, 'effective').mockImplementation(() => world.hp);
    spyOn(Skills, 'level').mockReturnValue(10);
    spyOn(Skills, 'hpFraction').mockReturnValue(1);
    spyOn(Sustain, 'set').mockImplementation(() => {});
    spyOn(Inventory, 'free').mockReturnValue(28);
    spyOn(Inventory, 'used').mockImplementation(() => world.pack.length);
    spyOn(Date, 'now').mockImplementation(() => world.now);
    const take = spyOn(GroundItem.prototype, 'interact').mockImplementation(() => false);

    const finish: string[] = [];
    const bot = new WanderLooter();
    active = bot;
    bot.bindFinish(reason => { finish.push(reason); });
    bot.bindLog(() => {});
    bot.settings = new SettingsBag({
        loot: ['Pumpkin'],
        foodWithdraw: 0,
        bankAtLootSlots: 28,
        quitAfterMinutes: 10
    });
    await bot.onStart();
    return { world, bot, take, finish };
}

test('a successful pickup resets the idle timer', async () => {
    const { world, bot, take } = await scenario();
    take.mockImplementation(() => {
        world.pack.push(held());
        world.ground = [];
        return true;
    });
    world.now = 50_000;
    bot.lastLootAt = 1_000;

    await new LootDrops(bot).execute();

    expect(bot.lastLootAt).toBe(50_000);
    expect(world.pack).toHaveLength(1);
});

test('unreachable loot is blacklisted immediately for its item and tile', async () => {
    const { bot } = await scenario();
    spyOn(Reach, 'entityOp').mockResolvedValue('unreachable');

    await new LootDrops(bot).execute();

    expect(bot.blacklist.blocked(PUMPKIN_ID, TILE)).toBe(true);
});

test('ambiguous failures blacklist after 30 seconds of the same stuck item', async () => {
    const { world, bot } = await scenario();
    const loot = new LootDrops(bot);

    await loot.execute();
    expect(bot.blacklist.blocked(PUMPKIN_ID, TILE)).toBe(false);

    world.now += 30_000;
    await loot.execute();
    expect(bot.blacklist.blocked(PUMPKIN_ID, TILE)).toBe(true);
});

test('damage before looting blacklists that item and tile', async () => {
    const { world, bot } = await scenario();
    bot.observeHealth();
    world.hp = 8;
    bot.observeHealth();
    world.hp = 10;

    await new LootDrops(bot).execute();

    expect(bot.blacklist.blocked(PUMPKIN_ID, TILE)).toBe(true);
});

test('damage while looting blacklists that item and tile', async () => {
    const { world, bot, take } = await scenario();
    take.mockImplementation(() => {
        world.hp = 8;
        world.pack.push(held());
        world.ground = [];
        return true;
    });

    await new LootDrops(bot).execute();

    expect(bot.blacklist.blocked(PUMPKIN_ID, TILE)).toBe(true);
});

test('damage soon after looting blacklists the pickup location', async () => {
    const { world, bot, take } = await scenario();
    take.mockImplementation(() => {
        world.pack.push(held());
        world.ground = [];
        return true;
    });
    await new LootDrops(bot).execute();
    expect(bot.blacklist.blocked(PUMPKIN_ID, TILE)).toBe(false);

    world.hp = 8;
    bot.observeHealth();

    expect(bot.blacklist.blocked(PUMPKIN_ID, TILE)).toBe(true);
});

test('wander validation falls through to the door-aware pathfinder', async () => {
    const { bot } = await scenario();
    spyOn(Reachability, 'walkable').mockReturnValue(false);
    const find = spyOn(Navigator, 'findPath').mockResolvedValue({ ok: true, waypoints: [], cost: 0, expanded: 1, hops: [] });

    expect(await bot.canWalkTo(new Tile(TILE.x + 30, TILE.z))).toBe(true);
    expect(find).toHaveBeenCalledTimes(1);
});

test('a wander with no navigable target does not walk blindly', async () => {
    const { bot } = await scenario();
    const walk = spyOn(Traversal, 'walkResilient').mockResolvedValue(true);
    spyOn(bot, 'canWanderTo').mockReturnValue(false);

    await new Wander(bot).execute();

    expect(walk).not.toHaveBeenCalled();
});

test('idle timeout banks instead of stopping and restarts the timer', async () => {
    const { world, bot, finish } = await scenario();
    const bank = spyOn(Banking, 'bankNearest').mockResolvedValue(true);
    spyOn(Bank, 'close').mockResolvedValue(true);
    bot.lastLootAt = world.now - 600_000;

    await new IdleBank(bot).execute();

    expect(finish).toEqual([]);
    expect(bank).toHaveBeenCalledTimes(1);
    expect(bot.lastLootAt).toBe(world.now);
});
