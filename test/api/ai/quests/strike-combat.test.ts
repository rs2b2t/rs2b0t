import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import Tile from '#/bot/geometry/Tile.js';
import { DirectNavigator } from '#/bot/event/webwalk/DirectNavigator.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Autocast } from '#/bot/api/magic/Autocast.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Npc } from '#/bot/api/model/Npc.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { ARENA_COVER, DEMON_COVER, castStrike, castFromCover, readyStrikes, takeStrikeCover } from '#/bot/api/ai/quests/strikeCombat.js';
import { stubProps } from '../../../lib/stubSingletons.js';

let restore: (() => void)[];
let here: Tile;
let runes: number;
let casts: string[];
let walks: Tile[];
let delay: () => void;
let npc: Npc;
const makeNpc = (tile: Tile, size = 3) => new Npc({ index: 1, id: 677, name: 'Black Demon', anim: -1, level: 172,
    size, tile, networkTile: tile, distance: 7, ops: ['Attack'], inCombat: false, health: 100, totalHealth: 100, faceEntity: -1 });

beforeEach(() => {
    here = DEMON_COVER;
    runes = 150;
    casts = [];
    walks = [];
    delay = () => {};
    npc = makeNpc(new Tile(2478, 9866, 0));
    restore = [
        stubProps(reader, { serverTile: () => here, npcs: () => [npc.snap] }),
        stubProps(Reachability, { lineOfSight: () => true }),
        stubProps(EventSignal, { pending: () => false }),
        stubProps(Game, { autoRetaliateOn: () => false, setAutoRetaliate: () => true,
            castOnNpc: async spell => { casts.push(spell); runes--; return true; } }),
        stubProps(Inventory, { count: () => runes }),
        stubProps(Skills, { effective: () => 1 }),
        stubProps(Sustain, { run: async () => {} }),
        stubProps(Execution, { delayTicks: async () => { delay(); } }),
        stubProps(DirectNavigator, { walk: async tile => { walks.push(new Tile(tile.x, tile.z, tile.level)); return true; } })
    ];
});
afterEach(() => { for (const undo of restore.reverse()) undo(); });

describe('guarded quest Strikes', () => {
    test('preparation disables staff autocast as well as retaliation', async () => {
        let armed = true;
        restore.push(
            stubProps(Autocast, { armed: () => armed }),
            stubProps(Game, { openSideTab: async () => true }),
            stubProps(actions, { ifButton: () => { armed = false; return true; } }),
            stubProps(Equipment, { items: () => [] }),
            stubProps(Execution, { delayUntilTicks: async condition => condition() })
        );
        expect(await readyStrikes(() => {})).toBe(true);
        expect(armed).toBe(false);
    });
    test('a lost arena lure runs again even when already standing at cover', async () => {
        here = ARENA_COVER;
        npc = makeNpc(new Tile(2597, 3168, 0), 2);
        const route: Tile[] = [];
        restore.push(stubProps(Traversal, { walkResilient: async tile => { here = new Tile(tile.x, tile.z, tile.level); route.push(here); return true; } }));
        expect(await takeStrikeCover(ARENA_COVER, () => {}, () => npc)).toBe(true);
        expect(route.map(tile => [tile.x, tile.z])).toEqual([[2598, 3167], [2598, 3169], [2594, 3169], [2594, 3167]]);
        expect(casts).toEqual(['Wind Strike']);
    });
    test('casts without requiring the player to take damage', async () => {
        expect(await castStrike(DEMON_COVER, npc, () => {})).toBe(true);
        expect(casts).toEqual(['Wind Strike']);
    });
    test('empty runes never fall back to melee', async () => {
        runes = 0;
        expect(await castStrike(DEMON_COVER, npc, () => {})).toBe(false);
        expect(casts).toEqual([]);
    });
    test('a blocked ray is never submitted to the server', async () => {
        restore.push(stubProps(Reachability, { lineOfSight: () => false }));
        expect(await castStrike(DEMON_COVER, npc, () => {})).toBe(false);
        expect(casts).toEqual([]);
    });
    test('casting range uses the body origin rather than the rendered centre', () => {
        npc = makeNpc(new Tile(DEMON_COVER.x + 11, DEMON_COVER.z + 1, 0));
        expect(castFromCover(DEMON_COVER, npc)).toBe(true);
    });
    test('movement back to cover is not cancelled by a second walk', async () => {
        delay = () => { here = DEMON_COVER.translate(1, 0); };
        expect(await castStrike(DEMON_COVER, npc, () => {})).toBe(false);
        expect(walks).toEqual([DEMON_COVER]);
    });
    test('a moving NPC is re-read before a pending cast is allowed to settle', async () => {
        here = ARENA_COVER;
        npc = makeNpc(new Tile(2597, 3168, 0), 2);
        delay = () => { npc = makeNpc(new Tile(2594, 3166, 0), 2); };
        expect(await castStrike(ARENA_COVER, npc, () => {})).toBe(false);
        expect(walks).toEqual([ARENA_COVER]);
    });
});
