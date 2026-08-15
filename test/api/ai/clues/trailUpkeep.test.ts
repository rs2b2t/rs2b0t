import * as RealInventory from '#/bot/api/inventory/Inventory.js';
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

import { Execution } from '#/bot/api/execution/Execution.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { ClueExecutor } from '#/bot/api/ai/clues/ClueExecutor.js';
import { SolveClue, type SolveClueHost } from '#/bot/api/ai/clues/SolveClue.js';
import { CLUE_DB } from '#/bot/api/ai/clues/data/cluedb.js';
import { stubProps } from '../../../lib/stubSingletons.js';

const LOBSTER = 'Lobster';
const MAX_HP = 70;
/** Any clue scroll — the bank check only runs while one is held. */
const HELD_CLUE = Number(Object.keys(CLUE_DB)[0]);

let hp: number;
let eaten: number;
let inv: { id: number; name: string }[];
let logs: string[];
/** Damage the guardian lands in the same tick the food heals. */
let incoming: number;

/** What each post-eat wait resolved to, and how many ticks it was allowed. */
let confirmations: boolean[];
let confirmBudgets: number[];
const restoreExec = stubProps(Execution, {
    delayUntil: async (fn: () => boolean): Promise<boolean> => fn(),
    delayUntilTicks: async (fn: () => boolean, maxTicks: number): Promise<boolean> => {
        const ok = fn();
        confirmations.push(ok);
        confirmBudgets.push(maxTicks);
        return ok;
    },
    delayTicks: async (): Promise<void> => {}
});
const restoreSkills = stubProps(Skills, {
    level: (n: string) => (n === 'hitpoints' ? MAX_HP : 70),
    effective: (n: string) => (n === 'hitpoints' ? hp : 70)
});
const realInventoryFns = { ...RealInventory.Inventory };
const stubInventory = {
    items: () =>
        inv.map(i => ({
            ...i,
            count: 1,
            actions: () => ['Eat'],
            interact: async (): Promise<boolean> => {
                eaten++;
                inv = inv.filter(x => x !== i);
                hp = Math.max(0, Math.min(MAX_HP, hp + 12) - incoming);
                return true;
            }
        }))
};

afterAll(() => {
    restoreExec();
    restoreSkills();
    Object.assign(RealInventory.Inventory, realInventoryFns);
    Sustain.set(null);
});

function host(): SolveClueHost {
    return {
        log: m => logs.push(m),
        setStatus: () => {},
        isFood: n => n === LOBSTER,
        foodName: () => LOBSTER,
        foodWithdraw: () => 8
    };
}

beforeEach(() => {
    Object.assign(RealInventory.Inventory, stubInventory);
    hp = MAX_HP;
    eaten = 0;
    inv = [1, 2, 3].map(id => ({ id, name: LOBSTER }));
    logs = [];
    confirmations = [];
    confirmBudgets = [];
    incoming = 0;
    Sustain.set(null);
});

describe('trail upkeep', () => {
    // Why: a trail runs inside one SolveClue.execute(), so a host's own Eat task never gets a turn and every Sustain.run() pump is a no-op without a hook.
    test('a host with no hook of its own still eats while the trail runs', async () => {
        let ateMidTrail = 0;
        const restoreSolve = stubProps(ClueExecutor, {
            solveHeldClue: async (): Promise<'done'> => {
                hp = 30;
                await Sustain.run();
                ateMidTrail = eaten;
                return 'done';
            }
        });
        try {
            await new SolveClue(host()).execute();
        } finally {
            restoreSolve();
        }
        expect(ateMidTrail).toBe(1);
        expect(hp).toBe(42);
        expect(logs.some(l => l.includes('eating Lobster'))).toBe(true);
    });

    // Why: a guardian's hit lands in the same tick as the heal, so a post-eat wait watching only for hp to rise burns its budget while Sustain.running blanks every pump.
    test('a bite that damage cancels out still confirms, so the next pump can eat', async () => {
        incoming = 20;
        const restoreSolve = stubProps(ClueExecutor, {
            solveHeldClue: async (): Promise<'done'> => {
                hp = 44;
                await Sustain.run();
                await Sustain.run();
                await Sustain.run();
                return 'done';
            }
        });
        try {
            await new SolveClue(host()).execute();
        } finally {
            restoreSolve();
        }
        expect(eaten).toBe(3);
        expect(confirmations).toEqual([true, true, true]);
        // And the wait is tick-bounded: a bite the server drops must be re-sent
        // next tick, not waited out for five while Sustain.running blanks upkeep.
        expect(confirmBudgets.every(t => t <= 2)).toBe(true);
    });

    // A trail banked once and never again, so a long one ran dry and then walked
    // the Wilderness with nothing to eat. Upkeep was fine — the pack was empty.
    test('an empty pack sends the bot back to the bank, once per dry spell', async () => {
        const banks: number[] = [];
        const solve = stubProps(ClueExecutor, { solveHeldClue: async (): Promise<'abandon'> => 'abandon' });
        const task = new SolveClue(host()) as unknown as {
            bankedThisSolve: boolean;
            bankFirst(): Promise<boolean>;
            execute(): Promise<void>;
        };
        task.bankFirst = async (): Promise<boolean> => {
            banks.push(inv.length);
            return true;
        };
        // The bank check only runs while a clue scroll is held.
        const CLUE = { id: HELD_CLUE, name: 'Clue scroll' };
        try {
            task.bankedThisSolve = true;
            inv = [CLUE];
            await task.execute();
            expect(banks.length).toBe(1);
            // Still empty (the stub bank stocked nothing): do not loop back forever.
            task.bankedThisSolve = true;
            await task.execute();
            expect(banks.length).toBe(1);
            // Food back in the pack clears the latch, so the next dry spell counts.
            inv = [CLUE, { id: 1, name: LOBSTER }];
            task.bankedThisSolve = true;
            await task.execute();
            inv = [CLUE];
            task.bankedThisSolve = true;
            await task.execute();
            expect(banks.length).toBe(2);
        } finally {
            solve();
        }
    });

    test('full health eats nothing', async () => {
        const restoreSolve = stubProps(ClueExecutor, {
            solveHeldClue: async (): Promise<'done'> => {
                await Sustain.run();
                return 'done';
            }
        });
        try {
            await new SolveClue(host()).execute();
        } finally {
            restoreSolve();
        }
        expect(eaten).toBe(0);
    });

    test("the host's own hook is put back when the trail ends", async () => {
        const hostHook = async (): Promise<void> => {};
        Sustain.set(hostHook);
        const restoreSolve = stubProps(ClueExecutor, {
            solveHeldClue: async (): Promise<'abandon'> => {
                expect(Sustain.hook).not.toBe(hostHook);
                return 'abandon';
            }
        });
        try {
            await new SolveClue(host()).execute();
        } finally {
            restoreSolve();
        }
        expect(Sustain.hook).toBe(hostHook);
    });

    test('an empty pack eats nothing rather than throwing', async () => {
        inv = [];
        const restoreSolve = stubProps(ClueExecutor, {
            solveHeldClue: async (): Promise<'done'> => {
                hp = 5;
                await Sustain.run();
                return 'done';
            }
        });
        try {
            await new SolveClue(host()).execute();
        } finally {
            restoreSolve();
        }
        expect(eaten).toBe(0);
    });
});
