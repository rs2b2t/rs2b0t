import { afterEach, describe, expect, test } from 'bun:test';

import { actions, reader, type InvItemSnapshot, type ObjRecord } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { applyMove } from '#/bot/api/bank/bankSortPlan.js';
import { ARRANGE_INSERT_COM, BANK_INSERT_VARP, sortBank } from '#/bot/api/bank/bankSort.js';

const COINS = 995;
const LAW_RUNE = 563;
const SHARK = 385;
const JUNK = 31337;

const NAMES: Record<number, string> = {
    [COINS]: 'Coins', [LAW_RUNE]: 'Law rune', [SHARK]: 'Shark', [JUNK]: 'Nameless thing'
};
const COSTS: Record<number, number> = { [COINS]: 1, [LAW_RUNE]: 240, [SHARK]: 200, [JUNK]: 1 };

const originals = {
    bankIsOpen: Bank.isOpen,
    bankSnapshotReady: Bank.snapshotReady,
    bankItems: reader.bankItems,
    objCatalog: reader.objCatalog,
    varp: reader.varp,
    ifButton: actions.ifButton,
    dragInvSlot: actions.dragInvSlot,
    bankComId: reader.bankComId,
    delayTicks: Execution.delayTicks,
    delayUntil: Execution.delayUntil
};

afterEach(() => {
    Object.assign(Bank, { isOpen: originals.bankIsOpen, snapshotReady: originals.bankSnapshotReady });
    Object.assign(reader, {
        bankItems: originals.bankItems,
        objCatalog: originals.objCatalog,
        varp: originals.varp,
        bankComId: originals.bankComId
    });
    Object.assign(actions, { ifButton: originals.ifButton, dragInvSlot: originals.dragInvSlot });
    Object.assign(Execution, { delayTicks: originals.delayTicks, delayUntil: originals.delayUntil });
});

interface Harness {
    order: number[];
    varp: number;
    drags: { from: number; to: number; mode: number }[];
    dropNext: boolean;
    varpSticks: boolean;
}

function install(ids: readonly number[], opts: Partial<Harness> = {}): Harness {
    const h: Harness = {
        order: [...ids],
        varp: 0,
        drags: [],
        dropNext: opts.dropNext ?? false,
        varpSticks: opts.varpSticks ?? true
    };

    Object.assign(Bank, { isOpen: () => true, snapshotReady: () => true });
    Object.assign(reader, {
        bankComId: () => 5382,
        varp: (index: number) => (index === BANK_INSERT_VARP ? h.varp : 0),
        objCatalog: (): ObjRecord[] => Object.keys(NAMES).map(key => ({
            id: Number(key),
            name: NAMES[Number(key)],
            cost: COSTS[Number(key)],
            stackable: true,
            members: false,
            equippable: false,
            certlink: -1,
            certtemplate: -1
        })),
        bankItems: (): InvItemSnapshot[] => h.order.map((id, slot) => ({
            slot, id, name: NAMES[id] ?? null, count: 1, ops: [], comId: 5382
        } as InvItemSnapshot))
    });
    Object.assign(actions, {
        ifButton: (comId: number) => {
            if (h.varpSticks) {
                h.varp = comId === ARRANGE_INSERT_COM ? 1 : 0;
            }
            return true;
        },
        dragInvSlot: (_com: number, from: number, to: number, mode: number) => {
            h.drags.push({ from, to, mode });
            if (h.dropNext) {
                h.dropNext = false;
                return true;
            }
            h.order = applyMove(h.order, { from, to }, mode === 1 ? 'insert' : 'swap');
            return true;
        }
    });
    Object.assign(Execution, {
        delayTicks: async () => {},
        delayUntil: async (cond: () => boolean) => cond()
    });

    return h;
}

describe('sortBank', () => {
    test('a closed bank sends nothing', async () => {
        const h = install([JUNK, COINS]);
        Object.assign(Bank, { isOpen: () => false });

        const result = await sortBank();
        expect(result.sorted).toBe(false);
        expect(result.reason).toBe('bank not open');
        expect(h.drags).toEqual([]);
    });

    test('an unready snapshot sends nothing', async () => {
        const h = install([JUNK, COINS]);
        Object.assign(Bank, { snapshotReady: () => false });

        const result = await sortBank();
        expect(result.reason).toBe('snapshot not ready');
        expect(h.drags).toEqual([]);
    });

    test('it reaches the sorted order and reports the count', async () => {
        const h = install([JUNK, SHARK, COINS, LAW_RUNE]);

        const result = await sortBank();
        expect(result.sorted).toBe(true);
        expect(h.order).toEqual([COINS, LAW_RUNE, SHARK, JUNK]);
        expect(result.moves).toBe(h.drags.length);
    });

    test('an already sorted bank sends nothing', async () => {
        const h = install([COINS, LAW_RUNE, SHARK, JUNK]);

        const result = await sortBank();
        expect(result.sorted).toBe(true);
        expect(h.drags).toEqual([]);
    });

    test('it restores the arrange varp it found', async () => {
        const h = install([JUNK, SHARK, COINS, LAW_RUNE]);
        h.varp = 1;

        await sortBank();
        expect(h.varp).toBe(1);
    });

    test('a dropped move is re-planned rather than trusted', async () => {
        const h = install([JUNK, SHARK, COINS, LAW_RUNE], { dropNext: true });

        const result = await sortBank();
        expect(result.sorted).toBe(true);
        expect(h.order).toEqual([COINS, LAW_RUNE, SHARK, JUNK]);
    });

    test('an unconfirmed varp never sends an insert', async () => {
        const h = install([COINS, LAW_RUNE, SHARK, JUNK, LAW_RUNE], { varpSticks: false });

        await sortBank();
        expect(h.drags.every(d => d.mode === 0)).toBe(true);
    });

    test('a bank that shuts mid-run stops and says so', async () => {
        install([JUNK, SHARK, COINS, LAW_RUNE]);
        let calls = 0;
        Object.assign(Bank, {
            isOpen: () => {
                calls += 1;
                return calls < 3;
            }
        });

        const result = await sortBank();
        expect(result.sorted).toBe(false);
        expect(result.reason).toBe('bank closed');
    });

    test('a varp stuck on insert while swaps are wanted bails instead of spinning', async () => {
        // A reversed bank is the case where the planner picks swap, so the stuck varp bites.
        const h = install([JUNK, SHARK, LAW_RUNE, COINS], { varpSticks: false });
        h.varp = 1;

        const result = await sortBank();
        expect(result.sorted).toBe(false);
        expect(result.reason).toBe('arrange mode stuck');
        expect(h.drags).toEqual([]);
    });

    test('running out of rounds is a failure, not a success', async () => {
        const h = install([JUNK, SHARK, COINS, LAW_RUNE]);
        Object.assign(actions, {
            dragInvSlot: (_com: number, from: number, to: number, mode: number) => {
                h.drags.push({ from, to, mode });
                return true;
            }
        });
        Object.assign(Execution, { delayUntil: async (cond: () => boolean) => cond() });

        const result = await sortBank();
        expect(result.sorted).toBe(false);
        expect(result.reason).toBe('no progress');
    });

    test('unmatched ids reach the caller', async () => {
        install([COINS, JUNK]);

        const result = await sortBank();
        expect(result.unmatched).toEqual([JUNK]);
    });
});
