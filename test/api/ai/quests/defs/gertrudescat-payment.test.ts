import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type NpcSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { decide, FLUFFS_STAGE } from '#/bot/api/ai/quests/defs/gertrudescat.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Reach } from '#/bot/api/walking/Reach.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { CollisionFlag } from '#/client/dash3d/CollisionFlag.js';

afterEach(() => mock.restore());

function boy(name: string, x: number, z: number): NpcSnapshot {
    return {
        index: name === 'Shilop' ? 1 : 2, id: name === 'Shilop' ? 781 : 783,
        name, anim: -1, level: 0, size: 1, tile: { x, z, level: 0 },
        distance: 1, ops: ['Talk-to'], inCombat: false, health: 1, totalHealth: 1, faceEntity: 32768
    };
}

function fixture(boys: NpcSnapshot[], blocked = false) {
    const state = { coins: 1000, page: -1 };
    const options = [
        ['Tell me sonny, or I will hurt you.', 'What will make you tell me?', "Well never mind, it's Fluffs' loss."],
        ["I'm not paying you a penny.", "Okay then, I'll pay."]
    ];
    spyOn(reader, 'npcs').mockReturnValue(boys);
    spyOn(reader, 'toLocal').mockImplementation((x, z) => ({ lx: x - 3200, lz: z - 3400 }));
    spyOn(reader, 'collisionFlags').mockReturnValue(blocked ? CollisionFlag.V_W : 0);
    spyOn(Traversal, 'walkResilient').mockResolvedValue(true);
    spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    spyOn(EventSignal, 'pending').mockReturnValue(false);
    spyOn(Inventory, 'count').mockImplementation(() => state.coins);
    spyOn(Reach, 'entityOp').mockImplementation(async () => { state.page = 0; return 'done'; });
    spyOn(ChatDialog, 'isOpen').mockImplementation(() => state.page >= 0);
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(ChatDialog, 'options').mockImplementation(() => options[state.page] ?? []);
    spyOn(ChatDialog, 'chooseOption').mockImplementation(async choice => {
        if (state.page === 0 && choice === 'What will make you tell me?') {
            state.page = 1;
        } else if (state.page === 1 && choice === "Okay then, I'll pay.") {
            state.coins -= 100;
            state.page = -1;
        } else {
            state.page = -1;
        }
        return true;
    });
    return state;
}

async function pay(): Promise<boolean> {
    const step = decide({
        journal: 'inProgress', inv: new Map([['coins', 1000]]), worn: new Set(), noProgress: 0, bankCoins: 0,
        progress: { stage: FLUFFS_STAGE.STARTED, flags: new Set() }
    });
    if (step.kind !== 'custom') throw new Error('expected payment step');
    return step.run(() => {});
}

test('pays when the brothers remain facing the player from opposite adjacent tiles', async () => {
    const state = fixture([boy('Shilop', 3220, 3435), boy('Wilough', 3222, 3435)]);
    expect(await pay()).toBe(true);
    expect(state.coins).toBe(900);
});

test('does not start the solo dialogue when the brothers lack line of sight', async () => {
    const state = fixture([boy('Shilop', 3220, 3435), boy('Wilough', 3221, 3435)], true);
    expect(await pay()).toBe(false);
    expect(state.coins).toBe(1000);
});

test('uses received positions when render positions still show the brothers together', async () => {
    const shilop = boy('Shilop', 3220, 3435);
    const wilough = { ...boy('Wilough', 3221, 3435), networkTile: { x: 3224, z: 3435, level: 0 } };
    const state = fixture([shilop, wilough]);
    expect(await pay()).toBe(false);
    expect(state.coins).toBe(1000);
});
