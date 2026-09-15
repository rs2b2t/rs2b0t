import * as RealInventory from '#/bot/api/inventory/Inventory.js';
import { expect, test, describe, beforeEach, afterEach, afterAll } from 'bun:test';

import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
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

describe('opening a casket', () => {
    let CASKET = 3549;
    const NEXT_SCROLL = 2722;
    const SHARK = 385;
    const RUNE = 561;
    const HERE = { x: 2394, z: 3488, level: 0 };
    let ground: { id: number; name: string; taken: boolean }[];
    let dropped: number;
    let onOpen: () => void;
    let yieldNow: boolean;
    let restoreGroundHere: () => void;
    let restoreEvents: () => void;
    const nameOf = (id: number): string => (id === 379 ? 'Lobster' : id === SHARK ? 'Shark' : id === CASKET ? 'Casket' : id === RUNE ? 'Nature rune' : id === NEXT_SCROLL ? 'Clue scroll' : 'Loot');
    const packItem = (id: number) => ({
        id, count: 1, name: nameOf(id),
        interact: async (op: string): Promise<boolean> => {
            if (op === 'Open') { inv = inv.filter(i => i !== CASKET); onOpen(); }
            if (op === 'Drop') { inv.splice(inv.indexOf(id), 1); dropped++; ground.push({ id, name: nameOf(id), taken: false }); }
            return true;
        }
    });
    const groundItem = (g: { id: number; name: string; taken: boolean }) => ({
        id: g.id, name: g.name, count: 1, tile: () => HERE,
        interact: async (): Promise<boolean> => { g.taken = true; inv.push(g.id); return true; }
    });
    beforeEach(() => {
        CASKET = 3549;
        Object.assign(RealInventory.Inventory, {
            items: () => inv.map(packItem),
            first: () => null,
            isFull: () => inv.length >= 28,
            used: () => inv.length,
            count: (name: string) => inv.filter(id => nameOf(id) === name).length
        });
        ground = []; dropped = 0; yieldNow = false; onOpen = () => {};
        countDialog = false; pages = []; answered = []; continues = 0; walks = [];
        restoreGroundHere = stubProps(GroundItems, {
            query: () => ({ where: (fn: (g: unknown) => boolean) => ({ nearest: () => ground.filter(g => !g.taken).map(groundItem).find(g => fn(g)) ?? null }) }) as never
        });
        restoreEvents = stubProps(EventSignal, { pending: () => yieldNow });
    });
    afterEach(() => { restoreGroundHere(); restoreEvents(); });

    test('a casket that hands back a scroll is the next leg, not a reward', async () => {
        inv = [CASKET, SHARK, SHARK];
        onOpen = () => { inv.push(NEXT_SCROLL); yieldNow = true; };
        expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');
        expect(inv).toContain(NEXT_SCROLL);
        expect(dropped).toBe(0);
        expect(walks).toEqual([]);
    });
    test('the last casket is opened in place, Sharks make room and the spill comes off our tile', async () => {
        inv = [CASKET, ...Array<number>(27).fill(SHARK)];
        onOpen = () => { inv.push(RUNE); ground.push({ id: 995, name: 'Coins', taken: false }, { id: 1615, name: 'Uncut dragonstone', taken: false }); };
        const log: string[] = [];
        expect(await ClueExecutor.solveHeldClue(m => log.push(m))).toBe('done');
        expect(ground.filter(g => g.id !== SHARK).every(g => g.taken)).toBe(true);
        expect(ground.filter(g => g.id === SHARK).some(g => g.taken)).toBe(false);
        expect(dropped).toBe(2);
        expect(inv).toContain(995);
        expect(inv).toContain(1615);
        expect(walks).toEqual([]);
        expect(log.some(m => /took 'Coins'/.test(m))).toBe(true);
    });
    test('a full pack with no Shark leaves the spill and still finishes', async () => {
        inv = [CASKET, ...Array<number>(27).fill(RUNE)];
        onOpen = () => { inv.push(RUNE); ground.push({ id: 995, name: 'Coins', taken: false }); };
        const log: string[] = [];
        expect(await ClueExecutor.solveHeldClue(m => log.push(m))).toBe('done');
        expect(ground[0].taken).toBe(false);
        expect(log.some(m => /WARNING: 'Coins' is left on the ground/.test(m))).toBe(true);
    });
    test('easy reward spill makes room from ordinary food without picking it back up', async () => {
        CASKET = 2714;
        inv = [CASKET, ...Array<number>(27).fill(379)];
        onOpen = () => { inv.push(RUNE); ground.push({ id: 995, name: 'Coins', taken: false }); };
        expect(await ClueExecutor.solveHeldClue(() => {})).toBe('done');
        expect(inv).toContain(995);
        expect(dropped).toBe(1);
        expect(ground.find(g => g.id === 379)?.taken).toBe(false);
    });
});
