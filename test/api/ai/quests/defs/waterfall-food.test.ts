import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import Tile from '#/bot/geometry/Tile.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { Npc } from '#/bot/api/model/Npc.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import * as CakeStall from '#/bot/api/thieving/CakeStall.js';
import { FLEE_TILE, STAND } from '#/bot/api/thieving/cakeStallData.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { healAtCrate, healToFull, sourceFood } from '#/bot/api/ai/quests/defs/waterfall.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

let restore: (() => void)[];
let here: Tile;
let level: number;
let combat: boolean;
let cakes: number;
let attempts: number;
let stolen: number;
let walks: Tile[];

beforeEach(() => {
    here = new Tile(2616, 3332, 0);
    level = 5;
    combat = false;
    cakes = attempts = stolen = 0;
    walks = [];
    const manTile = new Tile(2614, 3318, 0);
    const man = new Npc({ index: 1, id: 24, name: 'Man', anim: -1, level: 2,
        size: 1, tile: manTile, networkTile: manTile, distance: 1, ops: ['Pickpocket'],
        inCombat: false, health: 10, totalHealth: 10, faceEntity: -1 });
    restore = [];
    restore.push(
        stubProps(reader, { worldTile: () => here, serverTile: () => here, npcs: () => [man.snap] }),
        stubProps(Game, { inCombat: () => combat }),
        stubProps(Inventory, { items: () => cakes ? [new InvItem({ id: 1891, name: 'Cake', count: cakes,
            slot: 0, comId: 3214, ops: ['Eat'] })] : [] }),
        stubProps(Skills, { level: skill => skill === 'thieving' ? level : 10,
            effective: () => 10, xp: () => attempts * 8 }),
        stubProps(Npc.prototype, { interact: async action => {
            expect(action).toBe('Pickpocket'); attempts++; level = 5; return true;
        } }),
        stubProps(ChatDialog, { canContinue: () => false }),
        stubProps(Execution, { delayUntil: async condition => condition(), delayTicks: async () => {} }),
        stubProps(EventSignal, { pending: () => false }),
        stubProps(Sustain, { run: async () => {} }),
        stubProps(Traversal, { walkResilient: async tile => {
            here = new Tile(tile.x, tile.z, tile.level);
            walks.push(here);
            if (here.equals(FLEE_TILE)) combat = false;
            return true;
        } }),
    );
    const steal = spyOn(CakeStall, 'stealCakes').mockImplementation(async options => {
        expect(options.fillTo).toBe(8);
        expect(options.abort()).toBe(false);
        stolen++; cakes = 8; return 'stocked';
    });
    restore.push(() => steal.mockRestore());
});
afterEach(() => { for (const undo of restore.reverse()) undo(); });

async function refill(): Promise<boolean> {
    const step = sourceFood({ journal: 'inProgress', inv: new Map(), invIds: new Map(),
        worn: new Set(), noProgress: 0, bankCoins: 0, bankKnown: true,
        bankIds: new Map(), tile: here, freeSlots: 28 });
    expect(step?.kind).toBe('custom');
    return step?.kind === 'custom' && await step.run(() => {});
}

test('a level-1 account trains with the local Man before stealing cakes', async () => {
    level = 1;
    expect(await refill()).toBe(true);
    expect(attempts).toBe(1);
    expect(walks.map(tile => [tile.x, tile.z])).toEqual([[2614, 3318], [STAND.x, STAND.z]]);
    expect(stolen).toBe(1);
    expect(cakes).toBe(8);
});

test('a caught account flees before attempting low-level training', async () => {
    level = 1;
    combat = true;
    expect(await refill()).toBe(true);
    expect(attempts).toBe(0);
    expect(stolen).toBe(0);
    expect(walks).toEqual([FLEE_TILE]);
});

test('a stalled steal reports failure instead of pretending the food is stocked', async () => {
    spyOn(CakeStall, 'stealCakes').mockResolvedValue('no-progress');
    expect(await refill()).toBe(false);
    expect(cakes).toBe(0);
});

test('a stale food step never walks out of the Waterfall dungeon', async () => {
    here = new Tile(2577, 9863, 0);
    expect(await refill()).toBe(false);
    expect(walks).toEqual([]);
    expect(stolen).toBe(0);
});


test('an interrupt yields before starting the cake trip', async () => {
    restore.push(stubProps(EventSignal, { pending: () => true }));
    expect(await refill()).toBe(false);
    expect(stolen).toBe(0);
    expect(walks).toEqual([]);
});

test('an interrupt releases the training health-regeneration wait', async () => {
    level = 1;
    let interrupted = false;
    restore.push(
        stubProps(Skills, { effective: () => 1 }),
        stubProps(EventSignal, { pending: () => interrupted }),
        stubProps(Execution, { delayUntil: async condition => {
            interrupted = true;
            expect(condition()).toBe(true);
            return true;
        } })
    );
    expect(await refill()).toBe(false);
    expect(attempts).toBe(0);
});

test('tops off the last HP with cake before a dangerous dungeon sprint', async () => {
    cakes = 1;
    let hp = 9;
    let bites = 0;
    restore.push(
        stubProps(Skills, { effective: () => hp }),
        stubProps(InvItem.prototype, { interact: async action => {
            expect(action).toBe('Eat'); bites++; hp = 10; return true;
        } })
    );
    expect(await healToFull(() => {}, 'Waterfall dungeon entry')).toBe(true);
    expect(hp).toBe(10);
    expect(bites).toBe(1);
});


function healingFood(id: number): InvItem {
    return new InvItem({ id, name: id === 1891 ? 'Cake' : id === 1893 ? '2/3 cake' : 'Slice of cake',
        count: 1, slot: 0, comId: 3214, ops: ['Eat'] });
}

test('retries a refused bite after the previous eating cooldown', async () => {
    cakes = 1;
    let hp = 9;
    let attempts = 0;
    let waited = 0;
    restore.push(
        stubProps(Skills, { effective: () => hp }),
        stubProps(Execution, { delayTicks: async ticks => { waited += ticks; } }),
        stubProps(InvItem.prototype, { interact: async () => {
            attempts++;
            if (!waited) return false;
            hp = 10;
            return true;
        } })
    );
    expect(await healToFull(() => {}, 'Waterfall dungeon entry')).toBe(true);
    expect(attempts).toBe(2);
    expect(waited).toBeGreaterThanOrEqual(3);
});

test('retries an accepted Eat packet that the server ignored during cooldown', async () => {
    cakes = 1;
    let hp = 9;
    let attempts = 0;
    restore.push(
        stubProps(Skills, { effective: () => hp }),
        stubProps(InvItem.prototype, { interact: async () => {
            if (++attempts > 1) hp = 10;
            return true;
        } })
    );
    expect(await healToFull(() => {}, 'Waterfall dungeon entry')).toBe(true);
    expect(attempts).toBe(2);
});

test('recognizes a cake bite when incoming damage cancels its HP gain', async () => {
    let hp = 6;
    let id = 1891;
    let bites = 0;
    const logs: string[] = [];
    restore.push(
        stubProps(Skills, { effective: () => hp }),
        stubProps(Inventory, { items: () => [healingFood(id)] }),
        stubProps(InvItem.prototype, { interact: async () => {
            bites++;
            id = bites === 1 ? 1893 : 1895;
            if (bites > 1) hp = 10;
            return true;
        } })
    );
    expect(await healToFull(message => logs.push(message), 'Waterfall dungeon entry')).toBe(true);
    expect(bites).toBe(2);
    expect(logs.some(message => /1 bite.*6\/10/.test(message))).toBe(true);
});

test('moves on promptly at the crate health floor without chasing full HP', async () => {
    let bites = 0;
    restore.push(
        stubProps(Skills, { level: () => 62, effective: () => 50 }),
        stubProps(InvItem.prototype, { interact: async () => { bites++; return true; } })
    );
    expect(await healAtCrate(() => {})).toBe(true);
    expect(bites).toBe(0);
});

test('bounds crate healing when every bite is offset by incoming damage', async () => {
    let bites = 0;
    restore.push(
        stubProps(Skills, { level: () => 62, effective: () => 40 }),
        stubProps(Inventory, { items: () => [healingFood(bites % 3 === 0 ? 1891 : bites % 3 === 1 ? 1893 : 1895),
            ...Array.from({ length: 7 - Math.floor(bites / 3) }, () => healingFood(1891))] }),
        stubProps(InvItem.prototype, { interact: async () => { bites++; return true; } })
    );
    expect(await healAtCrate(() => {})).toBe(false);
    expect(bites).toBe(6);
});

test('stops after bounded unacknowledged bites with food still held', async () => {
    cakes = 1;
    let attempts = 0;
    restore.push(
        stubProps(Skills, { effective: () => 1 }),
        stubProps(InvItem.prototype, { interact: async () => { attempts++; return true; } })
    );
    expect(await healToFull(() => {}, 'Waterfall dungeon entry')).toBe(false);
    expect(attempts).toBe(3);
});

test('requires full health at the safe ledge and a usable food source below the crate floor', async () => {
    restore.push(stubProps(Skills, { level: () => 62, effective: () => 50 }));
    expect(await healToFull(() => {}, 'Waterfall dungeon entry')).toBe(false);
    restore.push(stubProps(Skills, { effective: () => 15 }));
    expect(await healAtCrate(() => {})).toBe(false);
});
