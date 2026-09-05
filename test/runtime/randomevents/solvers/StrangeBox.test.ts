import { afterEach, describe, expect, test } from 'bun:test';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Shop } from '#/bot/api/shop/Shop.js';
import {
    CUBE_PARTS,
    closeBankAndShop,
    rubLamp,
    solveAllBoxes,
    solveCube
} from '#/bot/runtime/randomevents/solvers/StrangeBox.js';

describe('solveCube', () => {
    test('answers a colour question by shape position', () => {
        expect(solveCube('What colour is the Star?', [3063, 3085, 3071])).toBe(1);
    });
    test('answers a shape question by colour position', () => {
        expect(solveCube('Which shape is Blue?', [3063, 3085, 3089])).toBe(2);
    });
    test('handles Half Moon (two-word shape)', () => {
        expect(solveCube('What colour is the Half Moon?', [3089, 3063, 3079])).toBe(0);
    });
    test('null on unknown question or missing models', () => {
        expect(solveCube('??', [3063, 3071, 3079])).toBeNull();
        expect(solveCube('What colour is the Star?', [null, 3063, 3071])).toBeNull();
    });
    test('part table covers all 15 combos', () => {
        expect(Object.keys(CUBE_PARTS)).toHaveLength(15);
    });
});

const original = {
    bankIsOpen: Bank.isOpen,
    bankClose: Bank.close,
    shopIsOpen: Shop.isOpen,
    shopClose: Shop.close,
    inventoryContains: Inventory.contains,
    inventoryFirst: Inventory.first,
    inventoryCount: Inventory.count,
    delayUntil: Execution.delayUntil
};

afterEach(() => {
    Bank.isOpen = original.bankIsOpen;
    Bank.close = original.bankClose;
    Shop.isOpen = original.shopIsOpen;
    Shop.close = original.shopClose;
    Inventory.contains = original.inventoryContains;
    Inventory.first = original.inventoryFirst;
    Inventory.count = original.inventoryCount;
    Execution.delayUntil = original.delayUntil;
});

describe('closeBankAndShop', () => {
    test('closes an open shop then an open bank', async () => {
        const logs: string[] = [];
        let shopOpen = true;
        let bankOpen = true;
        Shop.isOpen = () => shopOpen;
        Shop.close = async () => {
            shopOpen = false;
        };
        Bank.isOpen = () => bankOpen;
        Bank.close = async () => {
            bankOpen = false;
            return true;
        };

        expect(await closeBankAndShop(m => logs.push(m), 'so Open hits the backpack')).toBe(true);
        expect(shopOpen).toBe(false);
        expect(bankOpen).toBe(false);
        expect(logs).toEqual([
            'random event: closing shop so Open hits the backpack',
            'random event: closing bank so Open hits the backpack'
        ]);
    });

    test('returns false when Bank.close fails', async () => {
        Shop.isOpen = () => false;
        Bank.isOpen = () => true;
        Bank.close = async () => false;
        expect(await closeBankAndShop(() => {}, 'so Open hits the backpack')).toBe(false);
    });

    test('returns false when the shop stays open', async () => {
        Shop.isOpen = () => true;
        Shop.close = async () => {};
        Bank.isOpen = () => false;
        expect(await closeBankAndShop(() => {}, 'so Rub hits the backpack')).toBe(false);
    });
});

describe('solveAllBoxes overlays', () => {
    test('does not Open when the bank will not close', async () => {
        const logs: string[] = [];
        let opened = false;
        Shop.isOpen = () => false;
        Bank.isOpen = () => true;
        Bank.close = async () => false;
        Inventory.contains = name => name.toLowerCase() === 'strange box';
        Inventory.first = () =>
            ({
                interact: async () => {
                    opened = true;
                    return true;
                }
            }) as never;

        expect(await solveAllBoxes(m => logs.push(m))).toBe(false);
        expect(opened).toBe(false);
        expect(logs).toContain('random event: could not close bank/shop to open strange box');
    });

    test('closes the bank before Open', async () => {
        const order: string[] = [];
        Shop.isOpen = () => false;
        Bank.isOpen = () => !order.includes('close');
        Bank.close = async () => {
            order.push('close');
            return true;
        };
        Inventory.contains = name => name.toLowerCase() === 'strange box';
        Inventory.first = () =>
            ({
                interact: async (op: string) => {
                    order.push(`interact:${op}`);
                    return true;
                }
            }) as never;
        Inventory.count = () => 1;
        Execution.delayUntil = async () => false;

        expect(await solveAllBoxes(() => {})).toBe(false);
        expect(order).toEqual(['close', 'interact:Open']);
    });
});

describe('rubLamp overlays', () => {
    test('does not Rub when the bank will not close', async () => {
        const logs: string[] = [];
        let rubbed = false;
        Shop.isOpen = () => false;
        Bank.isOpen = () => true;
        Bank.close = async () => false;
        Inventory.contains = name => name.toLowerCase() === 'lamp';
        Inventory.first = () =>
            ({
                interact: async () => {
                    rubbed = true;
                    return true;
                }
            }) as never;

        expect(await rubLamp('strength', m => logs.push(m))).toBe(false);
        expect(rubbed).toBe(false);
        expect(logs).toContain('random event: could not close bank/shop to rub lamp');
    });
});
