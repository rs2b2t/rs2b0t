import { InvItem } from '#/bot/api/hud/Inventory.js';
import { expect, test, describe, mock, beforeEach } from 'bun:test';

import Tile from '#/bot/api/Tile.js';
import { CLUE_DB } from '#/bot/clues/data/cluedb.js';

const CLUE_ID = 2853;
const ANSWER = 5096;

let inv: number[];
let invNames: string[] = [];
let countDialog: boolean;
let pages: string[];
let answered: number[];
let continues: number;
let walks: string[];

const RealAdapter = await import('#/bot/adapter/ClientAdapter.js');
mock.module('#/bot/adapter/ClientAdapter.js', () => ({
    ...RealAdapter,
    reader: {
        ...RealAdapter.reader,
        countDialogOpen: () => countDialog,
        modals: () => ({ main: -1, chat: pages.length > 0 ? 5 : -1, side: -1 }),
        worldTile: () => ({ x: 2394, z: 3488, level: 0 })
    },
    actions: {
        ...RealAdapter.actions,
        answerCountDialog: (n: number): boolean => {
            answered.push(n);
            countDialog = false;
            pages.push('well-done');
            return true;
        },
        closeModal: (): boolean => true
    }
}));
mock.module('#/bot/api/hud/ChatDialog.js', () => ({
    ChatDialog: {
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
    }
}));
mock.module('#/bot/api/hud/Inventory.js', () => ({
    InvItem,
    Inventory: {
        items: () => inv.map(id => ({ id, count: 1 })),
        first: (name: string) => (invNames.some(n => n.toLowerCase() === name.toLowerCase()) ? { id: 0, count: 1, interact: async (): Promise<boolean> => true } : null)
    }
}));
mock.module('#/bot/api/Execution.js', () => ({
    Execution: {
        delayUntil: async (fn: () => boolean): Promise<boolean> => fn(),
        delayTicks: async (): Promise<void> => {}
    }
}));
mock.module('#/bot/api/Game.js', () => ({
    Game: {
        inCombat: () => false,
        tile: () => new Tile(2394, 3488, 0)
    }
}));
mock.module('#/bot/api/Traversal.js', () => ({
    Traversal: {
        walkResilient: async (dest: { x: number; z: number }): Promise<boolean> => {
            walks.push(`walk ${dest.x},${dest.z}`);
            return true;
        }
    }
}));
const queryStub = {
    query: () => {
        const chain = {
            name: () => chain,
            action: () => chain,
            where: () => chain,
            nearest: () => null,
            results: () => []
        };
        return chain;
    }
};
mock.module('#/bot/api/queries/Npcs.js', () => ({ Npcs: queryStub }));
mock.module('#/bot/api/queries/Locs.js', () => ({ Locs: queryStub }));
mock.module('#/bot/api/queries/GroundItems.js', () => ({ GroundItems: queryStub }));

const { ClueExecutor } = await import('#/bot/clues/ClueExecutor.js');

describe('challenge reply handling', () => {
    beforeEach(() => {
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
