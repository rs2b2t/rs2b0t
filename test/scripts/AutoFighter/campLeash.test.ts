import { afterEach, beforeEach, expect, test } from 'bun:test';
import AutoFighter from '#/bot/scripts/AutoFighter/AutoFighter.js';
import type { Task } from '#/bot/api/bot/Bot.js';
import { reader, type GroundItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Game } from '#/bot/api/game/Game.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Traversal, type WalkOptions } from '#/bot/api/walking/Traversal.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import Tile from '#/bot/geometry/Tile.js';
import { stubProps } from '../../lib/stubSingletons.js';

class Fighter extends AutoFighter {
    registered: Task[] = [];
    protected override add(...tasks: Task[]): void { this.registered.push(...tasks); }
}

const anchor = new Tile(3018, 3289);
let here: Tile;
let drops: GroundItemSnapshot[];
let bot: Fighter;
let restored: (() => void)[];
let finished: string[];
let walkOk: boolean;
let walkArrives: boolean;
let interrupted: boolean;
let walks: WalkOptions[];
const bones = (x: number, z: number, level = 0): GroundItemSnapshot => ({
    id: 526, name: 'Bones', count: 1, ops: ['Take'], tile: new Tile(x, z, level), distance: here.distanceTo(new Tile(x, z, level))
});
const task = (name: string) => bot.registered.find(t => t.constructor.name === name)!;

beforeEach(async () => {
    here = anchor;
    drops = [];
    finished = [];
    walks = [];
    walkOk = true;
    walkArrives = true;
    interrupted = false;
    restored = [
        stubProps(reader, { groundItems: () => drops, inventory: () => [], equipment: () => [] }),
        stubProps(Game, { tile: () => here, ingame: () => true, inCombat: () => false }),
        stubProps(Skills, { xp: () => 0, level: () => 10, effective: () => 10, hpFraction: () => 1 }),
        stubProps(Sustain, { set: () => {} }),
        stubProps(Execution, { delayUntil: async check => check() }),
        stubProps(EventSignal, { pending: () => interrupted }),
        stubProps(Traversal, {
            walkResilient: async (_tile, options) => { walks.push(options); return walkOk; },
            walkTo: async (_tile, options) => { walks.push(options ?? {}); if (walkOk && walkArrives) here = anchor; return walkOk; }
        })
    ];
    bot = new Fighter();
    bot.bindFinish(reason => { finished.push(reason); });
    bot.bindLog(() => {});
    bot.settings = new SettingsBag({ target: 'Chicken', spot: 'Custom coordinates', coordinates: anchor, leashRadius: 12, loot: ['Bones'], foodWithdraw: 0, panicHp: 0, solveClues: false });
    await bot.onStart();
});

afterEach(() => {
    bot.disposeSubscriptions();
    for (const restore of restored.reverse()) restore();
});

test('bones near the player cannot pull the fighter along a trail away from camp', () => {
    drops = [bones(anchor.x + 12, anchor.z)];
    expect(task('LootDrops').validate()).toBe(true);
    here = anchor.translate(12, 0);
    drops = [bones(anchor.x + 24, anchor.z)];
    expect(task('LootDrops').validate()).toBe(false);
    expect(task('ReturnToAnchor').validate()).toBe(false);
});

test('loot remains available inside the camp margin and on the correct floor', () => {
    here = anchor.translate(12, 0);
    drops = [bones(anchor.x + 16, anchor.z)];
    expect(task('LootDrops').validate()).toBe(true);
    drops = [bones(anchor.x + 17, anchor.z)];
    expect(task('LootDrops').validate()).toBe(false);
    here = new Tile(anchor.x, anchor.z, 1);
    drops = [bones(anchor.x, anchor.z, 1)];
    expect(task('LootDrops').validate()).toBe(false);
});

test('a failed delegated return ends the child activity so the leveler can recover', async () => {
    here = anchor.translate(24, 0);
    expect(task('ReturnToAnchor').validate()).toBe(true);
    walkOk = false;
    await task('ReturnToAnchor').execute();
    expect(walks).toHaveLength(1);
    expect(walks[0].timeoutMs).toBeLessThanOrEqual(90000);
    expect(finished).toHaveLength(1);
    expect(finished[0]).toContain('Could not return to combat camp');
});

test('successful returns and random-event interruptions do not fail the activity', async () => {
    here = anchor.translate(24, 0);
    await task('ReturnToAnchor').execute();
    expect(finished).toEqual([]);
    walkOk = false;
    interrupted = true;
    await task('ReturnToAnchor').execute();
    expect(finished).toEqual([]);
});

test('a closest-tile result outside the camp cannot masquerade as a completed return', async () => {
    here = anchor.translate(24, 0);
    walkArrives = false;
    await task('ReturnToAnchor').execute();
    expect(finished).toHaveLength(1);
    expect(finished[0]).toContain('Could not return to combat camp');
});
