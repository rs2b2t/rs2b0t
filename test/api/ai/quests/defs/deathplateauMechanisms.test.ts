import { expect, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { DEATH_ITEM, DP_FLAG, DP_STAGE, TILE, decide } from '#/bot/api/ai/quests/defs/deathplateau/index.js';
import { GameMessages } from '#/bot/api/chatbox/gameMessages.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { GroundItem } from '#/bot/api/grounditems/GroundItems.js';
import { InvItem } from '#/bot/api/inventory/Inventory.js';
import { Loc } from '#/bot/api/locs/Locs.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Reach } from '#/bot/api/walking/Reach.js';
import Tile from '#/bot/geometry/Tile.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

function stepAt(stage: number, flags: string[], tile: Tile) {
    const step = decide({
        stage, progress: { stage, flags: new Set(flags) }, journal: 'inProgress', tile,
        inv: new Map([['combination', 1]]), invIds: new Map([[DEATH_ITEM.COMBINATION.id, 1]]),
        worn: new Set(), bankKnown: true, bank: new Map(), bankCoins: 0, noProgress: 0, freeSlots: 27
    });
    if (step.kind !== 'custom') throw new Error('Expected a quest action');
    return step;
}

test('the player knocks from outside even when Tenzing is visible through the front wall', async () => {
    let tile = TILE.TENZING_DOOR;
    let knockPages = 0;
    let talkedInside = false;
    const restores = [
        stubProps(Game, { tile: () => tile }),
        stubProps(reader, { npcs: () => [{
            id: 1071, index: 1, anim: -1, name: 'Tenzing', level: 1, size: 1, tile: TILE.TENZING,
            distance: 3, ops: ['Talk-to'], inCombat: false, health: 1, totalHealth: 1, faceEntity: -1
        }] }),
        stubProps(Reach, {
            locOp: async ({ id, op }) => {
                if (id !== 3745 || op !== 'Open') return 'unreachable';
                knockPages = 4;
                return 'done';
            },
            entityOp: async () => {
                talkedInside = tile.x === 2822 && tile.z === 3555;
                return talkedInside ? 'done' : 'unreachable';
            }
        }),
        stubProps(ChatDialog, {
            canContinue: () => knockPages > 0, isOpen: () => knockPages > 0, options: () => [],
            continue: async () => { if (--knockPages === 0) tile = new Tile(2822, 3555, 0); return true; }
        }),
        stubProps(Execution, { delayTicks: async () => {}, delayUntil: async check => check() })
    ];
    try {
        expect(await stepAt(DP_STAGE.UNLOCKED_DOOR, [DP_FLAG.SABA], tile).run(() => {})).toBe(true);
        expect(talkedInside).toBe(true);
    } finally {
        for (const restore of restores.reverse()) restore();
    }
});

test('a player places a ball to unlock their equipment room when the board starts solved', async () => {
    const solution = new Map([
        [3110, new Tile(2894, 3562)], [3111, new Tile(2895, 3562)], [3109, new Tile(2894, 3563)],
        [3112, new Tile(2895, 3563)], [3113, new Tile(2895, 3564)]
    ]);
    const stones = new Map(solution);
    let held = 0;
    let unlocked = false;
    let waitsDuringPlacement = 0;
    const restores = [
        stubProps(Game, { tile: () => TILE.STONE_STAND }),
        stubProps(reader, {
            groundItems: () => Array.from(stones, ([id, tile]) => ({ id, tile, count: 1, distance: 1, name: 'Stone ball', ops: ['Take'] })),
            locs: () => Array.from(solution.values(), tile => ({ tile, id: 1, typecode: 1, distance: 1, name: 'Stone Mechanism', ops: [] })),
            inventory: () => held ? [{ id: held, slot: 0, comId: 1, count: 1, name: 'Stone ball', ops: [] }] : []
        }),
        stubProps(GroundItem.prototype, { interact(this: GroundItem, op) {
            if (op !== 'Take' || !stones.delete(this.id)) return false;
            held = this.id;
            return true;
        } }),
        stubProps(InvItem.prototype, { useOn(target) {
            if (!(target instanceof Loc) || !solution.get(held)?.equals(target.tile())) return false;
            stones.set(held, target.tile());
            held = 0;
            unlocked = stones.size === 5;
            if (unlocked) GameMessages.record('The equipment room door has unlocked.');
            return true;
        } }),
        stubProps(Execution, { delayTicks: async ticks => { if (held) waitsDuringPlacement += ticks; }, delayUntil: async check => check() })
    ];
    try {
        expect(await stepAt(DP_STAGE.FOUND_COMBO, [], TILE.STONE_STAND).run(() => {})).toBe(true);
        expect(unlocked).toBe(true);
        expect(waitsDuringPlacement).toBe(0);
    } finally {
        for (const restore of restores.reverse()) restore();
    }
});
