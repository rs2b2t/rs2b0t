import { expect, test } from 'bun:test';
import { reader, type NpcSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { herdToPen } from '#/bot/api/ai/quests/defs/sheepherder/herd.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Modals } from '#/bot/api/ui/widgets/Modals.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { DirectNavigator } from '#/bot/event/webwalk/DirectNavigator.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import { Input } from '#/bot/input/Input.js';
import Tile from '#/bot/geometry/Tile.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

test('keeps herding the selected sheep when another copy occupies its previous tile', async () => {
    let me = new Tile(2589, 3362, 0);
    let anim = -1;
    const sheep: NpcSnapshot[] = [1, 2].map(index => ({
        index, id: 294, name: 'Diseased sheep 3', tile: new Tile(2590, 3362, 0),
        ops: ['Prod'], distance: 1, level: 0, size: 1, anim: -1,
        inCombat: false, health: 1, totalHealth: 1, faceEntity: -1
    }));
    const rests = [
        stubProps(Modals, { isOpen: () => false }),
        stubProps(ChatDialog, { isOpen: () => false, canContinue: () => false }),
        stubProps(reader, { npcs: () => sheep, serverTile: () => me, selfAnim: () => anim }),
        stubProps(Game, { tile: () => me }),
        stubProps(Reachability, { walkable: () => true, canStep: () => true }),
        stubProps(Traversal, { walkResilient: async () => true }),
        stubProps(DirectNavigator, { walk: tile => { me = Tile.from(tile); return true; }, walkTo: async tile => { me = Tile.from(tile); return true; } }),
        stubProps(Input, { interactNpc: index => {
            anim = 799;
            const npc = sheep.find(n => n.index === index)!;
            const tile = npc.tile;
            const next = tile.x >= 2592 ? new Tile(2597, 3362, 0) : new Tile(tile.x + 1, tile.z, 0);
            sheep[sheep.indexOf(npc)] = { ...npc, tile: next };
            return true;
        } }),
        stubProps(Execution, { delayTicks: async () => {}, delayUntil: async check => { if (check()) return true; anim = -1; return check(); } })
    ];
    try {
        expect(await herdToPen(3, () => {})).toBe(true);
        expect(sheep[0].tile).toEqual(new Tile(2597, 3362, 0));
        expect(sheep[1].tile).toEqual(new Tile(2590, 3362, 0));
    } finally {
        for (const restore of rests.reverse()) restore();
    }
});

test('prods from server coordinates and detects the gate jump before sprites catch up', async () => {
    let me = new Tile(2591, 3363, 0);
    let anim = -1;
    let sheep: NpcSnapshot = {
        index: 1, id: 294, name: 'Diseased sheep 3', tile: new Tile(2591, 3363, 0),
        networkTile: new Tile(2592, 3363, 0), ops: ['Prod'], distance: 1,
        level: 0, size: 1, anim: -1, inCombat: false, health: 0, totalHealth: 0, faceEntity: -1
    };
    const walks: Tile[] = [];
    let prods = 0;
    const walk = (tile: { x: number; z: number; level: number }) => {
        me = Tile.from(tile);
        walks.push(me);
        return true;
    };
    const rests = [
        stubProps(Modals, { isOpen: () => false }),
        stubProps(ChatDialog, { isOpen: () => false, canContinue: () => false }),
        stubProps(reader, { npcs: () => [sheep], serverTile: () => me, selfAnim: () => anim }),
        stubProps(Game, { tile: () => new Tile(2590, 3364, 0) }),
        stubProps(Reachability, { walkable: () => true, canStep: () => true }),
        stubProps(Traversal, { walkResilient: async () => true }),
        stubProps(DirectNavigator, { walk, walkTo: async tile => walk(tile) }),
        stubProps(Input, { interactNpc: () => {
            anim = 799;
            prods++;
            sheep = { ...sheep, networkTile: new Tile(2597, 3362, 0) };
            return true;
        } }),
        stubProps(Execution, { delayTicks: async () => {}, delayUntil: async check => { if (check()) return true; anim = -1; return check(); } })
    ];
    try {
        expect(await herdToPen(3, () => {})).toBe(true);
        expect(prods).toBe(1);
        expect(walks).toEqual([]);
    } finally {
        for (const restore of rests.reverse()) restore();
    }
});

test('does not cancel a pending prod when the sheep wanders during the arrival delay', async () => {
    let me = new Tile(2591, 3362, 0);
    let sheep: NpcSnapshot = {
        index: 1, id: 294, name: 'Diseased sheep 3', tile: new Tile(2592, 3362, 0),
        ops: ['Prod'], distance: 1, level: 0, size: 1, anim: -1,
        inCombat: false, health: 0, totalHealth: 0, faceEntity: -1
    };
    let tick = 0;
    let pending = 0;
    let cancelled = 0;
    let anim = -1;
    const walk = (tile: { x: number; z: number; level: number }) => {
        if (pending) { cancelled++; pending = 0; }
        me = Tile.from(tile);
        return true;
    };
    const advance = () => {
        tick++;
        if (tick === 1) sheep = { ...sheep, tile: new Tile(2592, 3363, 0) };
        if (pending && tick >= pending) {
            pending = 0;
            anim = 799;
            sheep = { ...sheep, tile: new Tile(2597, 3362, 0) };
        }
    };
    const rests = [
        stubProps(Modals, { isOpen: () => false }),
        stubProps(ChatDialog, { isOpen: () => false, canContinue: () => false }),
        stubProps(reader, { npcs: () => [sheep], serverTile: () => me, selfAnim: () => anim }),
        stubProps(Game, { tile: () => me }),
        stubProps(Reachability, { walkable: () => true, canStep: () => true }),
        stubProps(Traversal, { walkResilient: async () => true }),
        stubProps(DirectNavigator, { walk, walkTo: async tile => walk(tile) }),
        stubProps(Input, { interactNpc: () => { if (pending) cancelled++; pending = tick + 2; return true; } }),
        stubProps(Execution, {
            delayTicks: async () => advance(),
            delayUntil: async check => {
                for (let i = 0; i < 10; i++) { if (check()) return true; advance(); }
                return check();
            }
        })
    ];
    try {
        expect(await herdToPen(3, () => {})).toBe(true);
        expect(cancelled).toBe(0);
    } finally {
        for (const restore of rests.reverse()) restore();
    }
});

test('stops a wandering sheep from an adjacent safe side instead of chasing stale stands', async () => {
    let me = new Tile(2592, 3366, 0);
    let sheep: NpcSnapshot = {
        index: 1, id: 294, name: 'Diseased sheep 3', tile: new Tile(2590, 3366, 0),
        ops: ['Prod'], distance: 2, level: 0, size: 1, anim: -1,
        inCombat: false, health: 0, totalHealth: 0, faceEntity: -1
    };
    let wandering = true;
    let anim = -1;
    const walkable = (tile: { x: number; z: number }) => tile.x >= 2580 && tile.x <= 2600 && tile.z >= 3355 && tile.z <= 3375;
    const walk = (tile: { x: number; z: number; level: number }) => {
        me = Tile.from(tile);
        if (wandering) sheep = { ...sheep, tile: new Tile(sheep.tile.x - 2, sheep.tile.z, 0) };
        return true;
    };
    const rests = [
        stubProps(Modals, { isOpen: () => false }),
        stubProps(ChatDialog, { isOpen: () => false, canContinue: () => false }),
        stubProps(reader, { npcs: () => [sheep], serverTile: () => me, selfAnim: () => anim }),
        stubProps(Game, { tile: () => me }),
        stubProps(Reachability, { walkable, canStep: (from, to) => walkable(from) && walkable(to) }),
        stubProps(Traversal, { walkResilient: async () => true }),
        stubProps(DirectNavigator, { walk, walkTo: async tile => walk(tile) }),
        stubProps(Input, { interactNpc: () => {
            wandering = false;
            anim = 799;
            const { x, z } = sheep.tile;
            const dx = x - me.x;
            const dz = z - me.z;
            sheep = { ...sheep, tile: x >= 2592 && x <= 2594 && z >= 3360 && z <= 3363
                ? new Tile(2597, 3362, 0)
                : new Tile(x + (Math.abs(dx) >= Math.abs(dz) ? Math.sign(dx) : 0), z + (Math.abs(dz) > Math.abs(dx) ? Math.sign(dz) : 0), 0) };
            return true;
        } }),
        stubProps(Execution, { delayTicks: async () => {}, delayUntil: async check => { if (check()) return true; anim = -1; return check(); } })
    ];
    try {
        expect(await herdToPen(3, () => {})).toBe(true);
        expect(sheep.tile).toEqual(new Tile(2597, 3362, 0));
    } finally {
        for (const restore of rests.reverse()) restore();
    }
});
