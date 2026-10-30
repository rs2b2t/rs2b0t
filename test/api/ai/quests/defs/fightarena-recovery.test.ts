import { afterEach, beforeEach, expect, test } from 'bun:test';
import { reader, type NpcSnapshot } from '#/bot/adapter/ClientAdapter.js';
import Tile from '#/bot/geometry/Tile.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Autocast } from '#/bot/api/magic/Autocast.js';
import { Prayer } from '#/bot/api/prayer/Prayer.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Reach } from '#/bot/api/walking/Reach.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { ARENA_COVER } from '#/bot/api/ai/quests/strikeCombat.js';
import { FA_FIGHT, runFight } from '#/bot/api/ai/quests/defs/fightarena/fights.js';
import { fightWithRelease } from '#/bot/api/ai/quests/defs/fightarena/legs.js';
import { FA_NPC } from '#/bot/api/ai/quests/defs/fightarena/areas.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

let restore: (() => void)[];
let here: Tile;
let tick: number;
let walks: number;
let npcs: () => NpcSnapshot[];

function scorpion(x: number, z: number): NpcSnapshot {
    const tile = { x, z, level: 0 };
    return { index: 1, id: FA_NPC.SCORPION, name: 'Khazard Scorpion', anim: -1, level: 44,
        size: 2, tile, networkTile: tile, distance: 12, ops: ['Attack'], inCombat: false,
        health: 0, totalHealth: 0, faceEntity: -1 };
}

beforeEach(() => {
    here = ARENA_COVER;
    tick = 0;
    walks = 0;
    npcs = () => [scorpion(2602, 3166)];
    restore = [
        stubProps(reader, { npcs: () => npcs(), serverTile: () => here }),
        stubProps(Game, { tile: () => here, tick: () => tick, autoRetaliateOn: () => false,
            setAutoRetaliate: () => true, inCombat: () => false }),
        stubProps(Equipment, { items: () => [] }),
        stubProps(Inventory, { count: () => 150, items: () => [] }),
        stubProps(Autocast, { armed: () => false }),
        stubProps(Skills, { level: () => 1, effective: () => 1 }),
        stubProps(Prayer, { active: () => false }),
        stubProps(EventSignal, { pending: () => false }),
        stubProps(Sustain, { run: async () => {} }),
        stubProps(ChatDialog, { isOpen: () => false, canContinue: () => false }),
        stubProps(Reachability, { lineOfSight: () => false }),
        stubProps(Execution, {
            delayTicks: async n => { tick += n; },
            delayUntil: async condition => condition(),
            delayUntilTicks: async (condition, n) => {
                if (condition()) return true;
                tick += n;
                return condition();
            }
        }),
        stubProps(Traversal, { walkResilient: async tile => {
            here = new Tile(tile.x, tile.z, tile.level);
            tick += 5;
            walks++;
            return true;
        } })
    ];
});

afterEach(() => { for (const undo of restore.reverse()) undo(); });

test('a beast returning to its cage during a fight requests release instead of repeating the lure', async () => {
    let reads = 0;
    npcs = () => [++reads === 1 ? scorpion(2602, 3166) : scorpion(2609, 3160)];
    expect(await runFight({ ...FA_FIGHT.scorpion, guard: 2 }, () => {})).toBe('unengaged');
    expect(walks).toBe(0);
});

test('long lure walks count toward the fight tick budget', async () => {
    expect(await runFight({ ...FA_FIGHT.scorpion, guard: 20 }, () => {})).toBe('stuck');
    expect(walks).toBe(4);
});

test('a visible caged beast cannot satisfy the post-dialogue release wait', async () => {
    npcs = () => [scorpion(2609, 3160)];
    const observations: boolean[] = [];
    restore.push(
        stubProps(Reach, { entityOp: async () => 'done' as const }),
        stubProps(Execution, { delayUntil: async (condition, timeout) => {
            const ready = condition();
            if (timeout === 20_000) observations.push(ready);
            return ready;
        } })
    );
    expect(await fightWithRelease(FA_FIGHT.scorpion, FA_NPC.JUSTIN, () => {})).toBe(false);
    expect(observations).toEqual([false]);
    expect(walks).toBe(0);
});
