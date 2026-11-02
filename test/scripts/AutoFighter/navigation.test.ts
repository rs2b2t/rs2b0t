import { afterEach, beforeEach, expect, test } from 'bun:test';
import AutoFighter from '#/bot/scripts/AutoFighter/AutoFighter.js';
import type { Task } from '#/bot/api/bot/Bot.js';
import { reader, type NpcSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Game } from '#/bot/api/game/Game.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Traversal, type WalkOptions } from '#/bot/api/walking/Traversal.js';
import { Reach } from '#/bot/api/walking/Reach.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import Tile from '#/bot/geometry/Tile.js';
import { stubProps } from '../../lib/stubSingletons.js';

class Fighter extends AutoFighter {
    registered: Task[] = [];
    protected override add(...tasks: Task[]): void { this.registered.push(...tasks); }
}
const anchor = new Tile(3019, 3338);
const dwarf = (index: number, dx: number): NpcSnapshot => ({
    index, id: 118, name: 'Dwarf', anim: -1, level: 10, size: 1, tile: anchor.translate(dx, 0), distance: Math.abs(dx),
    ops: ['Attack'], inCombat: false, faceEntity: -1, health: 18, totalHealth: 18
});
let bot: Fighter, fight: Task, npcs: NpcSnapshot[], blocked: Set<number>, attacks: number[], walks: WalkOptions[], restores: (() => void)[];
let onWalk: () => void, walkOK: boolean, interrupted: boolean, now: number, sight: boolean;

beforeEach(async () => {
    npcs = []; blocked = new Set(); attacks = []; walks = []; onWalk = () => {}; walkOK = true; interrupted = false; now = 1000; sight = false;
    restores = [
        stubProps(reader, { npcs: () => npcs, selfSlot: () => 1, inventory: () => [], equipment: () => [] }),
        stubProps(Game, { tile: () => anchor, ingame: () => true, inCombat: () => false }),
        stubProps(Skills, { xp: () => 0, level: () => 10, effective: () => 10, hpFraction: () => 1 }),
        stubProps(Sustain, { set: () => {} }),
        stubProps(Execution, { delayUntil: async check => check() }),
        stubProps(ChatDialog, { canContinue: () => false }),
        stubProps(EventSignal, { pending: () => interrupted }),
        stubProps(Date, { now: () => now }),
        stubProps(Reachability, { probeable: () => true, canReach: t => !blocked.has(t.x), lineOfSight: () => sight }),
        stubProps(Traversal, { walkTo: async (_tile, options) => { walks.push(options ?? {}); onWalk(); return walkOK; } }),
        stubProps(Reach, { entityOp: async opts => { const target = opts.find(); if (target && 'index' in target) attacks.push(Number(target.index)); return 'retry'; } })
    ];
    bot = new Fighter();bot.bindFinish(() => {});bot.bindLog(() => {});
    bot.settings = new SettingsBag({ target: 'Dwarf', spot: 'Custom coordinates', coordinates: anchor, leashRadius: 12, combatStyle: 'mage', foodWithdraw: 0, panicHp: 0, solveClues: false });
    await bot.onStart();fight = bot.registered.find(t => t.constructor.name === 'Fight')!;
});
afterEach(() => { bot.disposeSubscriptions();for (const restore of restores.reverse()) restore(); });

test('prefers a reachable dwarf over a nearer dwarf inside a closed building', async () => {
    npcs = [dwarf(1, 2), dwarf(2, 5)];blocked.add(npcs[0].tile.x);
    await fight.execute();expect(attacks).toEqual([2]);expect(walks).toHaveLength(0);
});

test('uses bounded navigation to approach a dwarf through a building entrance', async () => {
    npcs = [dwarf(1, 2)];blocked.add(npcs[0].tile.x);onWalk = () => blocked.clear();
    await fight.execute();expect(walks).toHaveLength(1);expect(walks[0].timeoutMs).toBeLessThanOrEqual(20000);expect(attacks).toEqual([1]);
});

test('a closest-tile arrival outside the wall is not enough to attack', async () => {
    npcs = [dwarf(1, 2)];blocked.add(npcs[0].tile.x);
    await fight.execute();expect(walks).toHaveLength(1);expect(attacks).toEqual([]);expect(fight.validate()).toBe(false);
    now += 30001;expect(fight.validate()).toBe(true);
});

test('a refused attack cools down that target so another dwarf can be selected', async () => {
    npcs = [dwarf(1, 2), dwarf(2, 5)];
    await fight.execute();await fight.execute();expect(attacks).toEqual([1, 2]);
});

test('rechecks camp bounds and ownership after approaching a moving dwarf', async () => {
    npcs = [dwarf(1, 2)];blocked.add(npcs[0].tile.x);
    onWalk = () => { blocked.clear();npcs[0] = dwarf(1, 25); };
    await fight.execute();expect(attacks).toEqual([]);
    npcs = [dwarf(2, 2)];blocked.add(npcs[0].tile.x);
    onWalk = () => { blocked.clear();npcs[0].faceEntity = 32770;npcs[0].inCombat = true; };
    await fight.execute();expect(attacks).toEqual([]);
});

test('an interrupted approach yields without attacking or blacklisting the dwarf', async () => {
    npcs = [dwarf(1, 2)];blocked.add(npcs[0].tile.x);onWalk = () => { interrupted = true; };walkOK = false;
    await fight.execute();expect(attacks).toEqual([]);interrupted = false;expect(fight.validate()).toBe(true);
});

test('magic with a clear firing line does not walk out of a safespot', async () => {
    npcs = [dwarf(1, 5)];blocked.add(npcs[0].tile.x);sight = true;
    await fight.execute();expect(walks).toHaveLength(0);expect(attacks).toEqual([1]);
});

test('a cooled-down dwarf becomes selectable immediately when it attacks us', async () => {
    npcs = [dwarf(1, 2), dwarf(2, 5)];
    await fight.execute();npcs[0].faceEntity = 32769;npcs[0].inCombat = true;
    await fight.execute();expect(attacks).toEqual([1, 1]);
});

test('magic uses the nearest footprint edge and southwest sight origin for large targets', async () => {
    npcs = [{ ...dwarf(1, 11), size: 3 }];blocked.add(npcs[0].tile.x);
    restores.push(stubProps(Reachability, { lineOfSight: (_from, to, size) => to.x === anchor.x + 10 && to.z === anchor.z - 1 && size === 3 }));
    await fight.execute();expect(walks).toHaveLength(0);expect(attacks).toEqual([1]);
});
