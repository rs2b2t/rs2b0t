import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type GroundItemSnapshot, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { GroundItem } from '#/bot/api/grounditems/GroundItems.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import { Reach } from '#/bot/api/walking/Reach.js';
import AutoFighter from '#/bot/scripts/AutoFighter/AutoFighter.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { CollisionFlag } from '#/client/dash3d/CollisionFlag.js';

const bone = (x = 3111): GroundItemSnapshot => ({ id: 532, name: 'Big bones', count: 1, ops: ['Take'], tile: { x, z: 9832, level: 0 }, distance: x - 3110 });
const held = (id: number, count = 1): InvItemSnapshot => ({ id, name: id === 995 ? 'Coins' : 'Big bones', count, slot: 0, comId: 3214, ops: [] });

let active: AutoFighter | undefined;
afterEach(() => { active?.disposeSubscriptions(); mock.restore(); });

async function scenario(leashRadius = 12) {
    const world = { ground: [bone()], pack: [] as InvItemSnapshot[], now: 1000, blocked: false };
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue({ x: 3110, z: 9832, level: 0 });
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    spyOn(reader, 'groundItems').mockImplementation(() => world.ground);
    spyOn(reader, 'inventory').mockImplementation(() => world.pack);
    spyOn(reader, 'inventorySize').mockReturnValue(28);
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(reader, 'equipment').mockReturnValue([]);
    spyOn(Game, 'inCombat').mockReturnValue(false);
    spyOn(Skills, 'xp').mockReturnValue(0);
    spyOn(Sustain, 'set').mockImplementation(() => {});
    spyOn(Execution, 'delayTicks').mockImplementation(async () => {});
    spyOn(Inventory, 'free').mockReturnValue(20);
    spyOn(Inventory, 'used').mockImplementation(() => world.pack.length);
    spyOn(reader, 'worldTile').mockReturnValue({ x: 3110, z: 9832, level: 0 });
    spyOn(reader, 'toLocal').mockImplementation((x, z) => ({ lx: x - 3080, lz: z - 9800 }));
    spyOn(reader, 'collisionFlags').mockImplementation((x, z) => x < 0 || z < 0 || x >= 104 || z >= 104 ? null : world.blocked && x === 31 && z === 32 ? CollisionFlag.SQ_BLOCKED : 0);
    spyOn(Date, 'now').mockImplementation(() => world.now);
    const attempts: number[] = [];
    const take = spyOn(GroundItem.prototype, 'interact').mockImplementation(function (this: GroundItem) { attempts.push(this.tile().x); return false; });
    const bot = new AutoFighter();
    active = bot;
    bot.bindFinish(() => {});
    bot.settings = new SettingsBag({ target: 'Giant', loot: ['Bones', 'Coins'], buryBones: true, buryBigBones: true, solveClues: false, foodWithdraw: 0, panicHp: 0, leashRadius });
    bot.bindLog(() => {});
    await bot.onStart();
    const loot = bot['tasks'].find(task => task.constructor.name === 'LootDrops');
    if (!loot) throw new Error('LootDrops missing');
    const counted = spyOn(bot, 'countLoot');
    return { world, bot, loot, take, counted, attempts };
}

test('skips the closer blocked-tile bone and selects reachable loot', async () => {
    const { world, loot, attempts } = await scenario();
    world.blocked = true;
    world.ground.push(bone(3113));
    await loot.execute();
    expect(attempts).toEqual([3113]);
    expect(Reachability.canReach(world.ground[0].tile, { adjacentOk: true })).toBe(true);
});

test('blocked-tile bones do not keep the loot task ahead of combat', async () => {
    const { world, loot } = await scenario();
    world.blocked = true;
    expect(loot.validate()).toBe(false);
});

test('a matching name without Take is not eligible loot', async () => {
    const { world, loot } = await scenario();
    world.ground[0].ops = ['Examine'];
    expect(loot.validate()).toBe(false);
});

test('blacklists only the stuck item and tile after 30s, then retries after the cooldown', async () => {
    const { world, loot, attempts } = await scenario();
    await loot.execute();
    expect(loot.validate()).toBe(true);
    world.now += 29_999;
    await loot.execute();
    expect(loot.validate()).toBe(true);
    world.now += 1;
    await loot.execute();
    expect(loot.validate()).toBe(false);
    expect(attempts).toEqual([3111, 3111, 3111]);
    world.ground.push(bone(3113));
    expect(loot.validate()).toBe(true);
    await loot.execute();
    expect(attempts).toEqual([3111, 3111, 3111, 3113]);
    world.now += 30 * 60_001;
    expect(loot.validate()).toBe(true);
});

test('an unreachable pickup is blacklisted immediately and retried after the cooldown', async () => {
    const { world, loot } = await scenario();
    spyOn(Reach, 'entityOp').mockResolvedValue('unreachable');
    await loot.execute();
    expect(loot.validate()).toBe(false);
    world.now += 30 * 60_001;
    expect(loot.validate()).toBe(true);
});

test('a gap longer than the stuck window restarts the count', async () => {
    const { world, loot } = await scenario();
    await loot.execute();
    world.now += 30_001;
    await loot.execute();
    expect(loot.validate()).toBe(true);
});

test('an accepted pickup without the selected item increasing is not counted and stays eligible until the stuck window', async () => {
    const { world, loot, take, counted } = await scenario();
    take.mockImplementation(() => { world.pack.push(held(995, 5)); return true; });
    await loot.execute();
    expect(counted).not.toHaveBeenCalled();
    expect(loot.validate()).toBe(true);
    world.now += 30_000;
    await loot.execute();
    expect(loot.validate()).toBe(false);
});

test('counts a pickup into an existing stack without a new inventory slot', async () => {
    const { world, loot, take, counted } = await scenario();
    world.ground[0] = { ...bone(), id: 995, name: 'Coins', count: 10 };
    world.pack.push(held(995, 5));
    take.mockImplementation(() => { world.pack[0].count += 10; world.ground = []; return true; });
    await loot.execute();
    expect(counted).toHaveBeenCalledTimes(1);
});


test('reachable loot at the configured maximum radius remains eligible', async () => {
    const { world, loot } = await scenario(30);
    world.ground = [bone(3144)];
    expect(loot.validate()).toBe(true);
});

test('walkable loot behind a door still reaches the existing interaction recovery', async () => {
    const { loot, attempts } = await scenario();
    spyOn(Reachability, 'canReach').mockReturnValue(false);
    await loot.execute();
    expect(attempts).toEqual([3111]);
});
