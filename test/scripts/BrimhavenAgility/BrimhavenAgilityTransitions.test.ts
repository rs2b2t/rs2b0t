import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import Tile from '#/bot/geometry/Tile.js';
import { Input } from '#/bot/input/Input.js';
import { BotHost } from '#/bot/runtime/BotHost.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';
import { Supervisor } from '#/bot/runtime/Supervisor.js';
import BrimhavenAgility from '#/bot/scripts/BrimhavenAgility/BrimhavenAgility.js';
import { ARENA_VARP, PILLARS } from '#/bot/scripts/BrimhavenAgility/BrimhavenAgilityLogic.js';

const restore: (() => void)[] = [];
let platform: number;
let offsetX: number;
let tagged: boolean;
let target: number;
let agility: number;
let animating: boolean;
let run: boolean;
let originalTick: number;
let walks: { x: number; z: number; tick: number }[];
let tags: number;

async function frame(): Promise<void> {
    BotHost.onFrame();
    for (let i = 0; i < 50; i++) await Promise.resolve();
}

beforeEach(() => {
    platform = 13;
    offsetX = 0;
    tagged = true;
    target = 13;
    agility = 70;
    animating = false;
    run = false;
    walks = [];
    tags = 0;
    originalTick = BotHost.tickCount;
    BotHost.tickCount = 100;
    const tile = () => new Tile(PILLARS[platform].x + offsetX, PILLARS[platform].z, 3);
    const mocks = [
        spyOn(reader, 'attached').mockReturnValue(false),
        spyOn(reader, 'ingame').mockReturnValue(false),
        spyOn(Game, 'ingame').mockReturnValue(true),
        spyOn(Game, 'sceneReady').mockReturnValue(true),
        spyOn(Game, 'tile').mockImplementation(tile),
        spyOn(Game, 'animating').mockImplementation(() => animating),
        spyOn(Game, 'runEnabled').mockImplementation(() => run),
        spyOn(actions, 'setRun').mockImplementation(value => { run = value; return true; }),
        spyOn(reader, 'varp').mockImplementation(id => id === ARENA_VARP ? 2 + Number(tagged) : 0),
        spyOn(reader, 'hintTile').mockImplementation(() => target < 0 ? null : { ...PILLARS[target], level: 3 }),
        spyOn(reader, 'toLocal').mockImplementation((x, z) => ({ lx: x, lz: z })),
        spyOn(reader, 'locs').mockImplementation(() => [{ id: 3581, typecode: 3581, name: 'Ticket Dispenser', ops: ['Tag'], tile: tile(), distance: 0 }]),
        spyOn(reader, 'modals').mockReturnValue({ main: -1, chat: -1, side: -1 }),
        spyOn(ChatDialog, 'canContinue').mockReturnValue(false),
        spyOn(Inventory, 'items').mockReturnValue([new InvItem({ id: 379, name: 'Lobster', count: 1, slot: 0, comId: 3214, ops: ['Eat'] })]),
        spyOn(Inventory, 'count').mockImplementation(name => name === 'Coins' ? 1000 : 0),
        spyOn(Skills, 'level').mockReturnValue(70),
        spyOn(Skills, 'effective').mockImplementation(name => name === 'agility' ? agility : 70),
        spyOn(Skills, 'xp').mockReturnValue(0),
        spyOn(Supervisor, 'intercept').mockReturnValue(null),
        spyOn(actions, 'walkTo').mockImplementation((x, z) => { walks.push({ x, z, tick: BotHost.tickCount }); return true; }),
        spyOn(Input, 'interactLoc').mockImplementation(() => { tagged = true; tags++; return true; })
    ];
    restore.push(...mocks.map(mock => () => mock.mockRestore()));
});

afterEach(async () => {
    ScriptRunner.stop('transition test complete');
    for (let i = 0; i < 100; i++) await Promise.resolve();
    restore.splice(0).reverse().forEach(fn => fn());
    BotHost.tickCount = originalTick;
});

async function start(): Promise<BrimhavenAgility> {
    const bot = new BrimhavenAgility();
    ScriptRunner.start({ name: 'Brimhaven transition test', description: 'arena transitions', create: () => bot });
    for (let i = 0; i < 4; i++) await frame();
    return bot;
}

test('dispatches the next task on the landing tick without waiting for another server tick', async () => {
    tagged = false;
    target = 14;
    run = true;
    await start();
    expect(walks).toEqual([{ x: 2799, z: 9568, tick: 100 }]);
    platform = 14;
    BotHost.tickCount = 101;
    await frame();
    await frame();
    expect(tags).toBe(1);
    expect(BotHost.tickCount).toBe(101);
});

test('trains on adjacent spikes in both directions without duplicate clicks mid-crossing', async () => {
    await start();
    expect(walks).toEqual([{ x: 2799, z: 9568, tick: 100 }]);
    for (let i = 0; i < 5; i++) await frame();
    expect(walks).toHaveLength(1);
    platform = 14;
    BotHost.tickCount = 101;
    await frame();
    await frame();
    expect(walks).toEqual([{ x: 2799, z: 9568, tick: 100 }, { x: 2800, z: 9568, tick: 101 }]);
});

test('trains on nearby pressure pads instead of returning to the centre', async () => {
    platform = 8;
    target = 8;
    await start();
    expect(walks).toEqual([{ x: 2799, z: 9557, tick: 100 }]);
});

test('tags a new target before starting another training crossing', async () => {
    await start();
    expect(walks).toHaveLength(1);
    platform = 14;
    target = 14;
    tagged = false;
    BotHost.tickCount = 101;
    await frame();
    await frame();
    await frame();
    expect(tags).toBe(1);
    expect(walks).toHaveLength(1);
});

test('waits rather than training on level-gated traps below 20 effective agility', async () => {
    agility = 19;
    await start();
    BotHost.tickCount = 101;
    await frame();
    expect(walks).toHaveLength(0);
});

test('keeps normal retry pacing when an obstacle is unavailable', async () => {
    tagged = false;
    target = 12;
    run = true;
    await start();
    const completed = ScriptRunner.ctx!.loopCount;
    expect(completed).toBe(1);
    await frame();
    await frame();
    expect(ScriptRunner.ctx!.loopCount).toBe(completed);
    expect(walks).toHaveLength(0);
});

test('retries a failed crossing on the first settled tick after its animation', async () => {
    await start();
    animating = true;
    for (const tick of [101, 102]) {
        BotHost.tickCount = tick;
        await frame();
    }
    expect(walks).toHaveLength(1);
    animating = false;
    BotHost.tickCount = 103;
    await frame();
    await frame();
    expect(walks).toHaveLength(2);
    expect(walks[1].tick).toBe(103);
    for (let i = 0; i < 5; i++) await frame();
    expect(walks).toHaveLength(2);
});

test('does not treat a one-frame animation flash as a completed failure', async () => {
    await start();
    animating = true;
    BotHost.tickCount = 101;
    await frame();
    animating = false;
    BotHost.tickCount = 102;
    await frame();
    await frame();
    expect(walks).toHaveLength(1);
});

test('does not reclick an idle trap trigger within the dispatch tick', async () => {
    offsetX = 5;
    await start();
    for (let i = 0; i < 5; i++) await frame();
    expect(walks).toHaveLength(1);
    BotHost.tickCount = 101;
    for (let i = 0; i < 5; i++) await frame();
    expect(walks).toHaveLength(2);
    expect(walks[1].tick).toBe(101);
});
