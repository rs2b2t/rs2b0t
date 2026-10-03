import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot, type WorldTile } from '#/bot/adapter/ClientAdapter.js';
import { ClueExecutor } from '#/bot/api/ai/clues/ClueExecutor.js';
import { GuardianProtection } from '#/bot/api/ai/clues/guardianKit.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Shop } from '#/bot/api/shop/Shop.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { WalkExecutor } from '#/bot/event/webwalk/WalkExecutor.js';

const origin = { x: 3222, z: 3218, level: 0 };
const target = { x: 3168, z: 3041, level: 0 };
const counter = { x: 3304, z: 3122, level: 0 };
let here: WorldTile;
let pack: InvItemSnapshot[];
let pending: boolean;
let interruptShop: boolean;
let visited: WorldTile[];
const item = (id: number, name: string, count = 1): InvItemSnapshot => ({ id, name, count, slot: 0, comId: 3214, ops: [] });

beforeEach(() => {
    here = origin; pending = false; interruptShop = false; visited = [];
    pack = [item(3552, 'Clue scroll (hard)'), item(952, 'Spade'), item(2574, 'Sextant'),
        item(2575, 'Watch'), item(2576, 'Chart'), item(385, 'Shark', 12),
        item(2448, 'Superantipoison(4)'), item(995, 'Coins', 1000)];
    ClueExecutor.resetSession(); Sustain.set(null);
    spyOn(reader, 'inventory').mockImplementation(() => pack);
    spyOn(reader, 'equipment').mockReturnValue([{ ...item(1231, 'Dragon dagger(p)'), slot: 3 }]);
    spyOn(reader, 'worldTile').mockImplementation(() => here);
    spyOn(Skills, 'level').mockReturnValue(60);
    spyOn(Skills, 'effective').mockReturnValue(60);
    spyOn(Quests, 'status').mockReturnValue('complete');
    spyOn(EventSignal, 'pending').mockImplementation(() => pending);
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(ChatDialog, 'isOpen').mockReturnValue(false);
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    spyOn(GuardianProtection.prototype, 'prepare').mockResolvedValue(true);
    spyOn(Traversal, 'walkResilient').mockImplementation(async dest => {
        visited.push(dest);
        WalkExecutor.lastMissingGateItems = [];
        if (dest.x === counter.x && dest.z === counter.z) {
            if (interruptShop) { pending = true; return false; }
            here = dest;
            return true;
        }
        if (Inventory.count('Shantay pass') === 0) {
            WalkExecutor.lastMissingGateItems = [{ name: 'Shantay pass', count: 1 }];
            return false;
        }
        pack = pack.filter(i => i.name !== 'Shantay pass');
        here = dest; pending = true;
        return true;
    });
    spyOn(Shop, 'open').mockResolvedValue(true);
    spyOn(Shop, 'close').mockResolvedValue();
    spyOn(Shop, 'buy').mockImplementation(async (name, count) => {
        pack.push(item(1854, name, count));
        return count;
    });
});

afterEach(() => {
    mock.restore(); Sustain.set(null); ClueExecutor.resetSession(); WalkExecutor.lastMissingGateItems = [];
});

test('buys a pass from Shantay and resumes the reported desert dig', async () => {
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');
    expect(Shop.open).toHaveBeenCalledWith('Shantay');
    expect(Shop.buy).toHaveBeenCalledWith('Shantay pass', 1);
    expect(visited).toEqual([target, counter, target]);
    expect(here).toEqual(target);
});

test('can buy another consumed pass when the same trail returns to the desert', async () => {
    await ClueExecutor.solveHeldClue(() => {});
    here = origin; pending = false;
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');
    expect(Shop.buy).toHaveBeenCalledTimes(2);
    expect(here).toEqual(target);
});

test('resumes a shopping trip interrupted before reaching Shantay', async () => {
    interruptShop = true;
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');
    expect(Shop.open).not.toHaveBeenCalled();
    interruptShop = false; pending = false;
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');
    expect(Shop.buy).toHaveBeenCalledTimes(1);
    expect(here).toEqual(target);
});
