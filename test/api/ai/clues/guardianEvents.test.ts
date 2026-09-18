import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot, type NpcSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { ClueExecutor } from '#/bot/api/ai/clues/ClueExecutor.js';
import { SolveClue } from '#/bot/api/ai/clues/SolveClue.js';
import { GameMessages } from '#/bot/api/chatbox/gameMessages.js';
import { Special } from '#/bot/api/combat/Special.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { InvItem } from '#/bot/api/inventory/Inventory.js';
import { Npc } from '#/bot/api/model/Npc.js';
import { Prayer } from '#/bot/api/prayer/Prayer.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';

let tick: number;
let pending: boolean;
let interrupted: boolean;
let digs: number;
let drinks: number;
let attacks: number[];
let pack: InvItemSnapshot[];
let npcs: NpcSnapshot[];
function item(id: number, name: string, count = 1): InvItemSnapshot {
    return { id, name, count, slot: 0, comId: 1, ops: ['Drink', 'Eat', 'Dig'] };
}
beforeEach(() => {
    tick = 0; pending = false; interrupted = false; digs = 0; drinks = 0; attacks = [];
    pack = [item(2723, 'Clue scroll (hard)'), item(185, 'Superantipoison(1)'), item(385, 'Shark', 15),
        item(952, 'Spade'), item(2574, 'Sextant'), item(2575, 'Watch'), item(2576, 'Chart')];
    npcs = [{ index: 4, id: 1, anim: -1, name: 'Zamorak Wizard', level: 65, size: 1,
        tile: { x: 3000, z: 3000, level: 0 }, distance: 1, ops: ['Attack'], inCombat: true,
        health: 40, totalHealth: 40, faceEntity: 32768 }];
    GameMessages.reset();
    ClueExecutor.retryGuardian();
    spyOn(reader, 'inventory').mockImplementation(() => pack);
    spyOn(reader, 'equipment').mockReturnValue([{ ...item(1231, 'Dragon dagger(p)'), slot: 3 }]);
    spyOn(reader, 'npcs').mockImplementation(() => npcs);
    spyOn(reader, 'selfSlot').mockReturnValue(0);
    spyOn(Skills, 'level').mockReturnValue(60);
    spyOn(Skills, 'effective').mockReturnValue(60);
    spyOn(Quests, 'status').mockReturnValue('complete');
    spyOn(Game, 'tick').mockImplementation(() => tick);
    spyOn(Game, 'inCombat').mockReturnValue(true);
    spyOn(EventSignal, 'pending').mockImplementation(() => pending);
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(Traversal, 'walkResilient').mockResolvedValue(true);
    spyOn(Execution, 'delayUntil').mockImplementation(async fn => fn());
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async fn => fn());
    spyOn(Execution, 'delayTicks').mockImplementation(async () => {
        tick++;
        if (npcs[0]?.health === 0) npcs = [];
        if (digs === 1 && !interrupted) {
            interrupted = true; pending = true;
            pack = pack.map(i => i.id === 385 ? { ...i, count: 14 } : i);
        }
    });
    spyOn(InvItem.prototype, 'interact').mockImplementation(function (this: InvItem, op: string) {
        if (op === 'Drink') { drinks++; pack = pack.filter(i => i.id !== this.id); }
        if (op === 'Dig') {
            digs++;
            if (digs === 2) pack = pack.map(i => i.id === 2723 ? { ...i, id: 2725 } : i);
        }
        return true;
    });
    spyOn(Prayer, 'set').mockResolvedValue(true);
    spyOn(Special, 'ready').mockReturnValue(false);
    spyOn(Npc.prototype, 'interact').mockImplementation(function (this: Npc) {
        attacks.push(this.index);
        npcs = npcs.map(n => n.index === this.index ? { ...n, health: 0 } : n);
        return true;
    });
    Sustain.set(null);
});
afterEach(() => { mock.restore(); Sustain.set(null); ClueExecutor.retryGuardian(); });

test('yields without another attack when an event fires during a combat wait', async () => {
    const result = await ClueExecutor.solveHeldClue(() => {});

    expect(result).toBe('yield');
    expect(attacks).toEqual([]);
    expect(digs).toBe(1);
});

test('resumes the same guardian below fifteen Sharks with the final dose still active', async () => {
    await ClueExecutor.solveHeldClue(() => {});
    pending = false;

    const result = await ClueExecutor.solveHeldClue(() => {});

    expect(result).toBe('supplies-needed');
    expect(attacks).toEqual([4]);
    expect(drinks).toBe(1);
    expect(digs).toBe(2);
    expect(pack.some(i => i.id === 2725)).toBe(true);
});

test.each(['missing', 'index', 'id', 'foreign', 'distant', 'dead'] as const)(
    'revalidates a %s guardian on resume instead of spawning another', async change => {
        await ClueExecutor.solveHeldClue(() => {});
        pending = false;
        switch (change) {
            case 'missing': npcs = []; break;
            case 'index': npcs = npcs.map(n => ({ ...n, index: 5 })); break;
            case 'id': npcs = npcs.map(n => ({ ...n, id: 2 })); break;
            case 'foreign': npcs = npcs.map(n => ({ ...n, faceEntity: 32769 })); break;
            case 'distant': npcs = npcs.map(n => ({ ...n, distance: 20 })); break;
            case 'dead': GameMessages.record('Oh dear, you are dead!'); break;
        }

        const result = await ClueExecutor.solveHeldClue(() => {});

        expect(result).toBe(change === 'dead' ? 'dead' : 'guardian-lost');
        expect(attacks).toEqual([]);
        expect(digs).toBe(1);
    }
);

test('host preserves its original weapon ledger and bank state across a guardian event', async () => {
    const task = new SolveClue({
        log: () => {}, setStatus: () => {}, isFood: n => n === 'Shark', foodName: () => 'Shark',
        foodWithdraw: () => 20, useTeleports: () => false, restorePrayer: () => false
    });
    task['bankedThisSolve'] = true;
    task['hardTrail'] = true;
    task['strippedGear'] = ['Magic shortbow'];
    const equip = spyOn(Equipment, 'equip').mockResolvedValue(false);
    spyOn(Npc.prototype, 'interact').mockImplementation(function (this: Npc) {
        attacks.push(this.index);
        pending = true;
        return true;
    });
    await task.execute();
    pending = false;

    await task.execute();

    expect(task.clueStatus()).toBe('event: yielding');
    expect(attacks).toEqual([4]);
    expect(task['deathBlocked']).toBe(false);
    expect(task['bankedThisSolve']).toBe(true);
    expect(task['strippedGear']).toEqual(['Magic shortbow']);
    expect(equip).not.toHaveBeenCalled();
});

test('preserves witnessed guardian death across an event before despawn', async () => {
    interrupted = true;
    spyOn(Execution, 'delayTicks').mockImplementation(async () => {
        tick++;
        if (npcs[0]?.health === 0) { npcs = []; pending = true; }
    });
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');
    pending = false;

    const result = await ClueExecutor.solveHeldClue(() => {});

    expect(result).toBe('supplies-needed');
    expect(digs).toBe(2);
    expect(attacks).toEqual([4]);
});

test('rechecks expired protection on resume without another spawn dig', async () => {
    await ClueExecutor.solveHeldClue(() => {});
    pending = false;
    tick += 570;

    const result = await ClueExecutor.solveHeldClue(() => {});

    expect(result).toBe('supplies-needed');
    expect(attacks).toEqual([]);
    expect(digs).toBe(1);
});
