import { afterEach, beforeEach, expect, test } from 'bun:test';
import AutoFighter from '#/bot/scripts/AutoFighter/AutoFighter.js';
import type { Task } from '#/bot/api/bot/Bot.js';
import { reader, type NpcSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Input } from '#/bot/input/Input.js';
import { Game } from '#/bot/api/game/Game.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { stubProps } from '../../lib/stubSingletons.js';
import Tile from '#/bot/geometry/Tile.js';

class Fighter extends AutoFighter {
    registered: Task[] = [];
    protected override add(...tasks: Task[]): void {
        this.registered.push(...tasks);
    }
}

let bot: Fighter;
let fight: Task;
let npcs: NpcSnapshot[];
let attacks: number[];
let hp: number;
let restores: (() => void)[];

const guard = (index: number, faceEntity: number, inCombat: boolean): NpcSnapshot => ({
    index, faceEntity, inCombat, anim: -1, id: 9, name: 'Guard', level: 21,
    tile: { x: 3201, z: 3200, level: 0 }, distance: 1,
    ops: ['Attack'], health: 10, totalHealth: 20
});

beforeEach(async () => {
    npcs = [];
    attacks = [];
    hp = 100;
    restores = [
        stubProps(reader, {
            npcs: () => npcs, selfSlot: () => 1, bankComId: () => -1,
            inventory: () => hp < 100 ? [{ slot: 0, id: 333, name: 'Trout', count: 1, ops: ['Eat'], comId: 1 }] : []
        }),
        stubProps(Game, { tile: () => new Tile(3200, 3200), ingame: () => true, inCombat: () => true }),
        stubProps(Skills, { xp: () => 0, effective: () => hp, level: () => 100, hpFraction: () => hp / 100 }),
        stubProps(Execution, { delayUntil: async check => check() }),
        stubProps(Sustain, { set: () => {} }),
        stubProps(EventSignal, { pending: () => attacks.length > 0 }),
        stubProps(Input, {
            interactNpc: index => { attacks.push(index); return true; },
            heldOp: () => { hp = 100; return true; }
        })
    ];
    bot = new Fighter();
    bot.bindLog(() => {});
    await bot.onStart();
    fight = bot.registered.find(task => task.constructor.name === 'Fight')!;
});

afterEach(() => {
    bot.disposeSubscriptions();
    for (const restore of restores.reverse()) restore();
});

async function eat(): Promise<void> {
    hp = 50;
    await bot.registered.find(task => task.constructor.name === 'EatFood')!.execute();
    expect(hp).toBe(100);
}

test('reattacks our opponent after eating while both combat flags remain set', async () => {
    npcs = [guard(2, 32769, true)];
    await eat();
    expect(await fight.validate()).toBe(true);
    await fight.execute();
    expect(attacks).toEqual([2]);
});

test('keeps the current attacker ahead of idle targets', async () => {
    npcs = [guard(3, -1, false), guard(2, 32769, true)];
    await eat();
    expect(await fight.validate()).toBe(true);
    await fight.execute();
    expect(attacks).toEqual([2]);
});

test('does not select another player\'s fight during combat', async () => {
    npcs = [guard(3, 32770, true)];
    expect(await fight.validate()).toBe(false);
});


test('leaves an uninterrupted fight alone', async () => {
    npcs = [guard(2, 32769, true)];
    expect(await fight.validate()).toBe(false);
});
