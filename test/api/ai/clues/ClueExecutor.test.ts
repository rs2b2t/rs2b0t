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
import { SolveClue } from '#/bot/api/ai/clues/SolveClue.js';
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
    let rewardTile = HERE;
    let ground: { id: number; name: string; taken: boolean }[];
    let dropped: number;
    let onOpen: () => void;
    let takeAllowed: boolean;
    let yieldNow: boolean;
    let restoreGroundHere: () => void;
    let restoreEvents: () => void;
    const nameOf = (id: number): string => (id === 1893 ? '2/3 cake' : id === 379 || id === 380 ? 'Lobster' : id === SHARK ? 'Shark' : id === CASKET ? 'Casket' : id === RUNE ? 'Nature rune' : id === NEXT_SCROLL ? 'Clue scroll' : 'Loot');
    const packItem = (id: number) => ({
        id, count: 1, name: nameOf(id), noted: id === 380,
        interact: async (op: string): Promise<boolean> => {
            if (op === 'Open') { inv = inv.filter(i => i !== CASKET); onOpen(); }
            if (op === 'Drop') { inv.splice(inv.indexOf(id), 1); dropped++; ground.push({ id, name: nameOf(id), taken: false }); }
            return true;
        }
    });
    const groundItem = (g: { id: number; name: string; taken: boolean }) => ({
        id: g.id, name: g.name, count: 1, tile: () => rewardTile,
        interact: async (): Promise<boolean> => {
            if (!takeAllowed) return false;
            g.taken = true; inv.push(g.id); return true;
        }
    });
    beforeEach(() => {
        CASKET = 3549;
        rewardTile = HERE;
        Object.assign(RealInventory.Inventory, {
            items: () => inv.map(packItem),
            first: () => null,
            isFull: () => inv.length >= 28,
            used: () => inv.length,
            count: (name: string) => inv.filter(id => nameOf(id) === name).length
        });
        ground = []; dropped = 0; yieldNow = false; takeAllowed = true; onOpen = () => {};
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
    test('a full pack without food keeps the reward pending until room is available', async () => {
        inv = [CASKET, ...Array<number>(27).fill(RUNE)];
        onOpen = () => { inv.push(RUNE); ground.push({ id: 995, name: 'Coins', taken: false }); };
        const log: string[] = [];
        expect(await ClueExecutor.solveHeldClue(m => log.push(m))).toBe('yield');
        expect(ground[0].taken).toBe(false);
        expect(log.some(m => /WARNING: 'Coins' is left on the ground/.test(m))).toBe(true);
        inv.pop();
        expect(await ClueExecutor.solveHeldClue(() => {})).toBe('done');
        expect(ground[0].taken).toBe(true);
    });
    test.each([379, 1893])('hard rewards drop ordinary or partial food %s and never pick it back up', async food => {
        inv = [CASKET, ...Array<number>(27).fill(food)];
        onOpen = () => { inv.push(RUNE); ground.push({ id: 995, name: 'Coins', taken: false }, { id: 1615, name: 'Uncut dragonstone', taken: false }); };

        expect(await ClueExecutor.solveHeldClue(() => {})).toBe('done');
        expect(inv).toContain(995);
        expect(inv).toContain(1615);
        expect(dropped).toBe(2);
        expect(ground.filter(g => g.id === food).every(g => !g.taken)).toBe(true);
    });
    test('waits for queued rewards to reach the ground after the casket disappears', async () => {
        inv = [CASKET, ...Array<number>(27).fill(379)];
        let ticks = 0;
        onOpen = () => { inv.push(RUNE); };
        const restoreTicks = stubProps(Execution, { delayTicks: async (count = 1) => {
            ticks += count;
            if (ticks >= 2 && ground.length === 0) ground.push({ id: 995, name: 'Coins', taken: false });
        } });
        try {
            expect(await ClueExecutor.solveHeldClue(() => {})).toBe('done');
            expect(inv).toContain(995);
            expect(dropped).toBe(1);
        } finally { restoreTicks(); }
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
    test('retries a failed pickup without collecting food dropped during the first attempt', async () => {
        inv = [CASKET, ...Array<number>(27).fill(379)];
        takeAllowed = false;
        onOpen = () => { inv.push(RUNE); ground.push({ id: 995, name: 'Coins', taken: false }); };

        expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');
        expect(inv).not.toContain(995);
        expect(dropped).toBe(1);
        takeAllowed = true;
        expect(await ClueExecutor.solveHeldClue(() => {})).toBe('done');
        expect(inv).toContain(995);
        expect(dropped).toBe(1);
        expect(ground.find(g => g.id === 379)?.taken).toBe(false);
    });
    test('preserves noted food rewards when dropping edible food to make room', async () => {
        inv = [CASKET, 380, ...Array<number>(26).fill(379)];
        onOpen = () => { inv.push(RUNE); ground.push({ id: 995, name: 'Coins', taken: false }); };

        expect(await ClueExecutor.solveHeldClue(() => {})).toBe('done');
        expect(inv).toContain(995);
        expect(inv).toContain(380);
        expect(ground.some(g => g.id === 380)).toBe(false);
        expect(ground.find(g => g.id === 379)?.taken).toBe(false);
    });
    test('a fresh solver collects its rewards instead of reusing a stopped solver pickup tile', async () => {
        inv = [CASKET, ...Array<number>(27).fill(379)];
        takeAllowed = false;
        onOpen = () => { inv.push(RUNE); ground.push({ id: 995, name: 'Coins', taken: false }); };
        expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');

        rewardTile = { x: 3000, z: 3200, level: 0 };
        const restoreTile = stubProps(reader, { worldTile: () => rewardTile });
        try {
            new SolveClue({ log: () => {}, setStatus: () => {}, isFood: () => false, foodName: () => '', foodWithdraw: () => 0 });
            inv = [CASKET];
            ground = [];
            takeAllowed = true;
            onOpen = () => { ground.push({ id: 995, name: 'Coins', taken: false }); };

            expect(await ClueExecutor.solveHeldClue(() => {})).toBe('done');
            expect(inv).toContain(995);
            expect(ground[0].taken).toBe(true);
        } finally { restoreTile(); }
    });
    test('confirms a reward added to an existing stack without requiring another used slot', async () => {
        inv = [CASKET, RUNE];
        onOpen = () => { ground.push({ id: RUNE, name: 'Nature rune', taken: false }); };
        const restoreUsed = stubProps(RealInventory.Inventory, { used: () => new Set(inv).size });
        try {
            expect(await ClueExecutor.solveHeldClue(() => {})).toBe('done');
            expect(inv.filter(id => id === RUNE)).toHaveLength(2);
            expect(ground[0].taken).toBe(true);
            expect(dropped).toBe(0);
        } finally { restoreUsed(); }
    });
    test.each([true, false])('a full pack only accepts an existing reward id when stackable is %s', async stackable => {
        inv = [CASKET, RUNE, ...Array.from({ length: 26 }, (_, i) => 6000 + i)];
        onOpen = () => { inv.push(6500); ground.push({ id: RUNE, name: 'Nature rune', taken: false }); };
        const restoreCatalog = stubProps(reader, { objCatalog: () => [{
            id: RUNE, name: 'Nature rune', stackable, cost: 100, members: false, equippable: false,
            certlink: -1, certtemplate: -1, stackVariant: false
        }] });
        const restoreCapacity = stubProps(RealInventory.Inventory, {
            used: () => new Set(inv).size,
            isFull: () => new Set(inv).size >= 28
        });
        try {
            expect(await ClueExecutor.solveHeldClue(() => {})).toBe(stackable ? 'done' : 'yield');
            expect(ground[0].taken).toBe(stackable);
            expect(inv.filter(id => id === RUNE)).toHaveLength(stackable ? 2 : 1);
            expect(dropped).toBe(0);
        } finally { restoreCatalog(); restoreCapacity(); ClueExecutor.resetSession(); }
    });
    test('collects rewards granted directly by a final talk challenge', async () => {
        inv = [CLUE_ID, ...Array<number>(27).fill(379)];
        countDialog = true;
        const restoreContinue = stubProps(ChatDialog, { continue: async () => {
            if (pages.shift() === 'well-done') {
                inv = inv.filter(id => id !== CLUE_ID);
                inv.push(RUNE);
                ground.push({ id: 995, name: 'Coins', taken: false });
            }
            return true;
        } });
        try {
            expect(await ClueExecutor.solveHeldClue(() => {})).toBe('done');
            expect(inv).toContain(995);
            expect(dropped).toBe(1);
        } finally { restoreContinue(); }
    });
});
