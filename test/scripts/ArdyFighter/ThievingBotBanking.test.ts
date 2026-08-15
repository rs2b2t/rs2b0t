/* eslint-disable @typescript-eslint/no-explicit-any -- API singletons are monkey-patched
   to model count-dialog bank withdrawals without a live client. */
import { afterEach, describe, expect, test } from 'bun:test';

import { actions, reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Input } from '#/bot/input/Input.js';
import { closeBankAndConfirmCount } from '#/bot/api/thieving/stealRules.js';

const LOBSTER = 379;

const originals = {
    answerCountDialog: actions.answerCountDialog,
    closeModal: actions.closeModal,
    bankComId: reader.bankComId,
    bankItems: reader.bankItems,
    bankSideItems: reader.bankSideItems,
    countDialogOpen: reader.countDialogOpen,
    inventory: reader.inventory,
    inventorySize: reader.inventorySize,
    modals: reader.modals,
    bankClose: Bank.close,
    delayTicks: Execution.delayTicks,
    delayUntil: Execution.delayUntil,
    invButton: Input.invButton
};

afterEach(() => {
    (actions as any).answerCountDialog = originals.answerCountDialog;
    (actions as any).closeModal = originals.closeModal;
    (reader as any).bankComId = originals.bankComId;
    (reader as any).bankItems = originals.bankItems;
    (reader as any).bankSideItems = originals.bankSideItems;
    (reader as any).countDialogOpen = originals.countDialogOpen;
    (reader as any).inventory = originals.inventory;
    (reader as any).inventorySize = originals.inventorySize;
    (reader as any).modals = originals.modals;
    (Bank as any).close = originals.bankClose;
    (Execution as any).delayTicks = originals.delayTicks;
    (Execution as any).delayUntil = originals.delayUntil;
    (Input as any).invButton = originals.invButton;
});

function item(id: number, name: string, count: number, slot: number, bank = false): InvItemSnapshot {
    return {
        id,
        name,
        count,
        slot,
        comId: bank ? 5382 : 5064,
        ops: bank ? ['Withdraw-1', null, null, null, 'Withdraw-X'] : [null, null, null, null, 'Drop']
    };
}

type Mode = 'name' | 'id';

interface RunOptions {
    side?: InvItemSnapshot[];
    bank?: InvItemSnapshot[];
    click?: boolean;
    answer?: boolean;
    requested?: number;
    hydrate?: (side: InvItemSnapshot[]) => void;
}

async function run(
    mode: Mode,
    update: (requested: number, side: InvItemSnapshot[], bank: InvItemSnapshot[]) => void,
    options: RunOptions = {}
): Promise<boolean> {
    const side = options.side ?? [];
    const bank = options.bank ?? [item(LOBSTER, 'Lobster', 10, 0, true)];
    (reader as any).bankComId = () => 5382;
    (reader as any).bankItems = () => bank;
    (reader as any).bankSideItems = () => side;
    // This is the live failure mode: the normal inventory tab is unavailable.
    (reader as any).inventory = () => [];
    (reader as any).inventorySize = () => 0;
    (reader as any).modals = () => ({ main: 5292, side: 5063, chat: -1 });
    (reader as any).countDialogOpen = () => true;
    (Execution as any).delayTicks = async () => options.hydrate?.(side);
    (Execution as any).delayUntil = async (condition: () => boolean) => condition();
    (Input as any).invButton = () => options.click ?? true;
    (actions as any).answerCountDialog = (requested: number) => {
        if (options.answer === false) {
            return false;
        }
        update(requested, side, bank);
        return true;
    };
    const requested = options.requested ?? 10;
    return mode === 'name' ? Bank.withdrawX('Lobster', requested) : Bank.withdrawXById(LOBSTER, requested);
}

describe('Withdraw-X while the bank modal hides the inventory tab', () => {
    for (const mode of ['name', 'id'] as const) {
        test(`${mode} waits for the requested side-backpack arrival`, async () => {
            expect(await run(mode, (requested, side, bank) => {
                side.push(item(LOBSTER, 'Lobster', requested, 0));
                bank[0]!.count -= requested;
            })).toBe(true);
        });

        test(`${mode} accepts partial bank stock after all advertised items arrive`, async () => {
            // Keep this fixture on the Withdraw-X protocol it is intended to exercise; named
            // withdrawal decomposition through fixed ops has its own exact-operation tests.
            const bank = [{
                ...item(LOBSTER, 'Lobster', 3, 0, true),
                ops: [null, null, null, null, 'Withdraw-X']
            }];
            expect(await run(mode, (_requested, side, currentBank) => {
                side.push(item(LOBSTER, 'Lobster', 3, 0));
                currentBank.splice(0);
            }, { bank })).toBe(true);
        });

        test(`${mode} accepts a capacity-limited withdrawal only after item progress`, async () => {
            const side = Array.from({ length: 27 }, (_, slot) => item(995, 'Coins', 1, slot));
            expect(await run(mode, (_requested, current) => {
                current.push(item(LOBSTER, 'Lobster', 1, 27));
            }, { side })).toBe(true);
        });

        test(`${mode} rejects a transient empty bank list without inventory progress`, async () => {
            expect(await run(mode, (_requested, _side, bank) => {
                bank.splice(0);
            })).toBe(false);
        });

        test(`${mode} does not mistake delayed initial hydration for withdrawal progress`, async () => {
            expect(await run(mode, () => {}, {
                hydrate: side => side.push(item(LOBSTER, 'Lobster', 10, 0))
            })).toBe(false);
        });

        test(`${mode} rejects an already-full backpack without requested-item progress`, async () => {
            const full = Array.from({ length: 28 }, (_, slot) => item(995, 'Coins', 1, slot));
            expect(await run(mode, () => {}, { side: full })).toBe(false);
        });

        test(`${mode} measures arrival as a delta from a pre-existing stack`, async () => {
            const side = [item(LOBSTER, 'Lobster', 2, 0)];
            expect(await run(mode, (requested, current) => {
                current[0]!.count += requested;
            }, { side })).toBe(true);
            expect(side[0]!.count).toBe(12);
        });

        test(`${mode} rejects a failed Withdraw-X click`, async () => {
            expect(await run(mode, () => {
                throw new Error('count answer must not run after a rejected click');
            }, { click: false })).toBe(false);
        });

        test(`${mode} rejects a failed count-dialog answer`, async () => {
            expect(await run(mode, () => {
                throw new Error('failed answer must not mutate inventory');
            }, { answer: false })).toBe(false);
        });

        test(`${mode} rejects a zero-count bank snapshot`, async () => {
            const bank = [item(LOBSTER, 'Lobster', 0, 0, true)];
            expect(await run(mode, () => {
                throw new Error('zero stock must not open the count dialog');
            }, { bank })).toBe(false);
        });
    }

    test('exact-ID mode ignores a same-name stack with a different object ID', async () => {
        const otherId = item(999, 'Lobster', 50, 0);
        const target = item(LOBSTER, 'Lobster', 1, 1);
        expect(await run('id', requested => {
            target.count += requested;
        }, { side: [otherId, target] })).toBe(true);
        expect(target.count).toBe(11);
    });

    test('bank close rejects a failed close-button action', async () => {
        (reader as any).bankComId = () => 5382;
        (reader as any).modals = () => ({ main: 5292, side: 5063, chat: -1 });
        (actions as any).closeModal = () => false;

        expect(await Bank.close()).toBe(false);
    });

    test('bank close waits for both halves of the main+side modal to disappear', async () => {
        let mainOpen = true;
        let sideOpen = true;
        const checks: boolean[] = [];
        (reader as any).bankComId = () => mainOpen ? 5382 : -1;
        (reader as any).modals = () => ({ main: mainOpen ? 5292 : -1, side: sideOpen ? 5063 : -1, chat: -1 });
        (actions as any).closeModal = () => {
            mainOpen = false;
            return true;
        };
        (Execution as any).delayUntil = async (condition: () => boolean) => {
            checks.push(condition());
            sideOpen = false;
            checks.push(condition());
            return checks.at(-1)!;
        };

        expect(await Bank.close()).toBe(true);
        expect(checks).toEqual([false, true]);
    });

    test('food-bank close confirms the complete pre-close count after normal inventory rehydrates', async () => {
        let normalCount = 0;
        const order: string[] = [];
        (Bank as any).close = async () => {
            order.push('close');
            return true;
        };
        (Execution as any).delayTicks = async () => {
            order.push('tick');
            normalCount = 10;
        };
        (Execution as any).delayUntil = async (condition: () => boolean) => {
            order.push('confirm');
            return condition();
        };

        expect(await closeBankAndConfirmCount(10, () => normalCount)).toBe(true);
        expect(order).toEqual(['close', 'tick', 'confirm']);
    });

    test('food-bank confirmation stops immediately when the bank cannot close', async () => {
        let delayed = false;
        (Bank as any).close = async () => false;
        (Execution as any).delayTicks = async () => {
            delayed = true;
        };

        expect(await closeBankAndConfirmCount(10, () => 10)).toBe(false);
        expect(delayed).toBe(false);
    });

    test('food-bank confirmation rejects a stale smaller normal-inventory count', async () => {
        (Bank as any).close = async () => true;
        (Execution as any).delayTicks = async () => {};
        (Execution as any).delayUntil = async (condition: () => boolean) => condition();

        expect(await closeBankAndConfirmCount(10, () => 1)).toBe(false);
    });
});
