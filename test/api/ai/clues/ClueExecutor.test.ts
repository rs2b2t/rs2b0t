import * as RealInventory from '#/bot/api/inventory/Inventory.js';
import { expect, test, describe, beforeEach, afterAll } from 'bun:test';

import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { GroundItems } from '#/bot/api/grounditems/GroundItems.js';
import { Locs } from '#/bot/api/locs/Locs.js';
import { Npcs } from '#/bot/api/npcs/Npcs.js';
import Tile from '#/bot/geometry/Tile.js';
import { CLUE_DB } from '#/bot/api/ai/clues/data/cluedb.js';
import { stubProps } from '../../../lib/stubSingletons.js';

const CLUE_ID = 2853;
const ANSWER = 5096;

let inv: number[];
let invNames: string[] = [];
let countDialog: boolean;
let pages: string[];
let answered: number[];
let continues: number;
let walks: string[];

const restoreReader = stubProps(reader, {
    countDialogOpen: () => countDialog,
    modals: () => ({ main: -1, chat: pages.length > 0 ? 5 : -1, side: -1 }),
    worldTile: () => ({ x: 2394, z: 3488, level: 0 })
});
const restoreActions = stubProps(actions, {
    answerCountDialog: (n: number): boolean => {
        answered.push(n);
        countDialog = false;
        pages.push('well-done');
        return true;
    },
    closeModal: (): boolean => true
});
const restoreChat = stubProps(ChatDialog, {
    isOpen: () => pages.length > 0,
    canContinue: () => pages.length > 0,
    continue: async (): Promise<boolean> => {
        continues++;
        const page = pages.shift();
        if (page === 'well-done') {
            inv = inv.filter(id => id !== CLUE_ID);
            pages.push('found-clue');
        }
        return true;
    },
    options: () => [],
    chooseOption: async (): Promise<boolean> => false
});
// Why: Bun's mock.module is permanent for the process, so stub the singleton instead.
const realInventoryFns = { ...RealInventory.Inventory };
const stubInventory = {
    items: () => inv.map(id => ({ id, count: 1 })),
    first: (name: string) =>
        invNames.some(n => n.toLowerCase() === name.toLowerCase())
            ? { id: 0, count: 1, interact: async (): Promise<boolean> => true }
            : null
};
const restoreExec = stubProps(Execution, {
    delayUntil: async (fn: () => boolean): Promise<boolean> => fn(),
    delayTicks: async (): Promise<void> => {}
});
const restoreGame = stubProps(Game, {
    inCombat: () => false,
    tile: () => new Tile(2394, 3488, 0)
});
const restoreTraversal = stubProps(Traversal, {
    walkResilient: async (dest: { x: number; z: number }): Promise<boolean> => {
        walks.push(`walk ${dest.x},${dest.z}`);
        return true;
    }
});
const emptyQuery = () => {
    const chain = {
        name: () => chain,
        action: () => chain,
        where: () => chain,
        nearest: () => null,
        results: () => []
    };
    return chain as never;
};
const restoreNpcs = stubProps(Npcs, { query: emptyQuery });
const restoreLocs = stubProps(Locs, { query: emptyQuery });
const restoreGround = stubProps(GroundItems, { query: emptyQuery });
afterAll(() => {
    restoreReader();
    restoreActions();
    restoreChat();
    restoreExec();
    restoreGame();
    restoreTraversal();
    restoreNpcs();
    restoreLocs();
    restoreGround();
    Object.assign(RealInventory.Inventory, realInventoryFns);
});

const { ClueExecutor } = await import('#/bot/api/ai/clues/ClueExecutor.js');

describe('challenge reply handling', () => {
    beforeEach(() => {
        Object.assign(RealInventory.Inventory, stubInventory);
        inv = [CLUE_ID];
        countDialog = true;
        pages = [];
        answered = [];
        continues = 0;
        walks = [];
    });

    test('answers the count dialog, continues the reply, and never pathfinds', async () => {
        const result = await ClueExecutor.solveHeldClue(() => {});
        expect(result).toBe('done');
        expect(answered).toEqual([ANSWER]);
        expect(continues).toBeGreaterThanOrEqual(2);
        expect(walks).toEqual([]);
    });
});

describe('tool acquisition before abandon', () => {
    beforeEach(() => {
        Object.assign(RealInventory.Inventory, stubInventory);
        countDialog = false;
        pages = [];
        answered = [];
        continues = 0;
        walks = [];
    });

    test('a spade-less dig walks to a spade spawn before abandoning', async () => {
        const digId = Number(Object.keys(CLUE_DB).find(k => {
            const r = CLUE_DB[Number(k)];
            return r.type === 'dig' && r.needsSextant !== true;
        }));
        expect(Number.isNaN(digId)).toBe(false);
        inv = [digId];
        const result = await ClueExecutor.solveHeldClue(() => {});
        expect(walks).toContain('walk 2574,3331');
        expect(result).toBe('abandon');
    });
});

describe('per-clue required items (2811 Baxtorian Falls rope)', () => {
    beforeEach(() => {
        Object.assign(RealInventory.Inventory, stubInventory);
        inv = [2811];
        invNames = [];
        countDialog = false;
        pages = [];
        answered = [];
        continues = 0;
        walks = [];
    });

    test('rope missing: the dig is blocked and abandoned, never walked', async () => {
        invNames = ['Spade', 'Sextant', 'Watch', 'Chart'];
        const lines: string[] = [];
        const result = await ClueExecutor.solveHeldClue(m => lines.push(m));
        expect(result).toBe('abandon');
        expect(lines.some(l => l.includes('Rope'))).toBe(true);
        expect(walks).not.toContain('walk 2512,3467');
    });

    test('rope held: the dig proceeds to the falls ledge', async () => {
        invNames = ['Spade', 'Sextant', 'Watch', 'Chart', 'Rope'];
        await ClueExecutor.solveHeldClue(() => {});
        expect(walks).toContain('walk 2512,3467');
    });
});
