import { expect, test, describe, mock, beforeEach } from 'bun:test';

import Tile from '../api/Tile.js';
import { CLUE_DB } from './data/cluedb.js';

// Challenge-clue reply regression (live 2026-07-20): after answerCountDialog
// the server p_delay(0)s then chatnpc's the "Well done!" reply — a PAUSEBUTTON
// page whose CONTINUE click is what consumes the clue (inv_del runs after the
// pause in trail_challengenpc_prompt). The executor must drive that continue,
// and must NOT pathfind while the reply is up — the old flow re-dispatched the
// whole talk step after answering, walking back to the anchor under the open
// page and leaving the dialogue unfinished.
//
// primitives.js is deliberately NOT mocked (bun module mocks leak across test
// files and a slimmed stub broke gotoNpc.test.ts / the quest-def suites): the
// real gotoNpc runs, and any pathfinding it attempts shows up through the
// mocked Traversal.walkResilient below.

const CLUE_ID = 2853; // trail_clue_medium_anagram008 — Gnome ball referee
const ANSWER = 5096; // 57 x 89 + 23

let inv: number[];
let invNames: string[] = []; // item NAMES held (drives the mocked Inventory.first)
let countDialog: boolean;
let pages: string[]; // open continue pages, head = current
let answered: number[];
let continues: number;
let walks: string[]; // every walkResilient dest — pathfinding evidence

mock.module('#/bot/adapter/ClientAdapter.js', () => ({
    reader: {
        countDialogOpen: () => countDialog,
        modals: () => ({ main: -1, chat: pages.length > 0 ? 5 : -1, side: -1 }),
        worldTile: () => ({ x: 2394, z: 3488, level: 0 })
    },
    actions: {
        answerCountDialog: (n: number): boolean => {
            answered.push(n);
            countDialog = false;
            pages.push('well-done'); // ~chatnpc($correct_chat) opens a beat later
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
                // resume_pausebutton: inv_del(clue) + progress -> "found a clue" objbox
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
    Inventory: {
        items: () => inv.map(id => ({ id, count: 1 })),
        // name-aware: held names seeded per-test via invNames (default empty,
        // so tests that predate it keep their "nothing held" behavior)
        first: (name: string) => (invNames.some(n => n.toLowerCase() === name.toLowerCase()) ? { id: 0, count: 1, interact: async (): Promise<boolean> => true } : null)
    }
}));
mock.module('#/bot/api/Execution.js', () => ({
    Execution: {
        delayUntil: async (fn: () => boolean): Promise<boolean> => fn(),
        delayTicks: async (): Promise<void> => {}
    }
}));
mock.module('#/bot/api/EventSignal.js', () => ({ EventSignal: { pending: () => false } }));
mock.module('#/bot/api/Sustain.js', () => ({ Sustain: { run: async (): Promise<void> => {} } }));
mock.module('#/bot/api/Game.js', () => ({
    Game: {
        inCombat: () => false,
        // 10 tiles east of the referee's anchor (2384,3488) — far enough that a
        // re-dispatched gotoNpc must walk, which is exactly what we assert against
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

const { ClueExecutor } = await import('./ClueExecutor.js');

describe('challenge reply handling', () => {
    beforeEach(() => {
        inv = [CLUE_ID];
        countDialog = true; // mid-solve: the question closed and p_countdialog is up
        pages = [];
        answered = [];
        continues = 0;
        walks = [];
    });

    test('answers the count dialog, continues the reply, and never pathfinds', async () => {
        const result = await ClueExecutor.solveHeldClue(() => {});
        expect(result).toBe('done');
        expect(answered).toEqual([ANSWER]);
        // "Well done!" page + the "found another clue" objbox both continued
        expect(continues).toBeGreaterThanOrEqual(2);
        // the whole exchange happens standing still — no walking back to the anchor
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
        // hold only a plain dig clue (no Spade, no needsSextant) from the real DB
        const digId = Number(Object.keys(CLUE_DB).find(k => {
            const r = CLUE_DB[Number(k)];
            return r.type === 'dig' && r.needsSextant !== true;
        }));
        expect(Number.isNaN(digId)).toBe(false);
        inv = [digId];
        const result = await ClueExecutor.solveHeldClue(() => {});
        // ensureSpade walked to the nearer spade spawn (Ardougne, from Game.tile 2394,3488)
        expect(walks).toContain('walk 2574,3331');
        // no ground spade in the mocked scene -> acquisition failed -> abandon
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
        invNames = ['Spade', 'Sextant', 'Watch', 'Chart']; // everything BUT the rope
        const lines: string[] = [];
        const result = await ClueExecutor.solveHeldClue(m => lines.push(m));
        expect(result).toBe('abandon');
        expect(lines.some(l => l.includes('Rope'))).toBe(true);
        // blocked before any trail walk — never trekked to the falls
        expect(walks).not.toContain('walk 2512,3467');
    });

    test('rope held: the dig proceeds to the falls ledge', async () => {
        invNames = ['Spade', 'Sextant', 'Watch', 'Chart', 'Rope'];
        await ClueExecutor.solveHeldClue(() => {});
        expect(walks).toContain('walk 2512,3467');
    });
});
