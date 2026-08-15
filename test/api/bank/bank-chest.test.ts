/* eslint-disable @typescript-eslint/no-explicit-any -- API singletons are monkey-patched
   to exercise the stateful bank-object transition without a live client. */
import { afterEach, expect, test } from 'bun:test';

import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Banking, depositMatcher } from '#/bot/api/bank/Banking.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Locs } from '#/bot/api/locs/Locs.js';
import { Input } from '#/bot/input/Input.js';

const originals = {
    bankIsOpen: Bank.isOpen,
    bankOpenNearest: Bank.openNearest,
    bankOpenNearestAccess: Bank.openNearestAccess,
    bankDepositAllMatching: Bank.depositAllMatching,
    delayTicks: Execution.delayTicks,
    delayUntil: Execution.delayUntil,
    gameTile: Game.tile,
    bankSideItems: reader.bankSideItems,
    invButton: Input.invButton,
    locQuery: Locs.query,
    walkResilient: Traversal.walkResilient
};

afterEach(() => {
    (Bank as any).isOpen = originals.bankIsOpen;
    (Bank as any).openNearest = originals.bankOpenNearest;
    (Bank as any).openNearestAccess = originals.bankOpenNearestAccess;
    (Bank as any).depositAllMatching = originals.bankDepositAllMatching;
    (Execution as any).delayTicks = originals.delayTicks;
    (Execution as any).delayUntil = originals.delayUntil;
    (Game as any).tile = originals.gameTile;
    (reader as any).bankSideItems = originals.bankSideItems;
    (Input as any).invButton = originals.invButton;
    (Locs as any).query = originals.locQuery;
    (Traversal as any).walkResilient = originals.walkResilient;
});

test('deposit matching receives item IDs and distinguishes reward from clue caskets', async () => {
    let items: InvItemSnapshot[] = [
        { id: 2714, name: 'Casket', count: 1, slot: 0, comId: 5382, ops: ['Deposit-1', null, null, 'Deposit-All', null] },
        { id: 405, name: 'Casket', count: 1, slot: 1, comId: 5382, ops: ['Deposit-1', null, null, 'Deposit-All', null] }
    ];
    const clicked: number[] = [];

    (Bank as any).isOpen = () => true;
    (reader as any).bankSideItems = () => items;
    (Execution as any).delayUntil = async (condition: () => boolean) => condition();
    (Input as any).invButton = (id: number, slot: number) => {
        clicked.push(id);
        items = items.filter(item => item.id !== id || item.slot !== slot);
        return true;
    };

    await Bank.depositAllMatching(depositMatcher(() => false, true));

    expect(clicked).toEqual([405]);
    expect(items.map(item => item.id)).toEqual([2714]);
});

function queryReturning(locs: any[]) {
    return () => {
        let name = '';
        let predicate = (_loc: any): boolean => true;
        const query = {
            name(value: string) {
                name = value;
                return query;
            },
            where(value: (loc: any) => boolean) {
                predicate = value;
                return query;
            },
            nearest() {
                return locs.find(loc => loc.name === name && predicate(loc)) ?? null;
            }
        };
        return query;
    };
}

test('opens a closed chest before delegating to its bank action', async () => {
    let chestOpen = false;
    const interactions: string[] = [];
    const closed = {
        name: 'Closed chest',
        actions: () => ['Open'],
        interact: async (op: string) => {
            interactions.push(op);
            chestOpen = true;
            return true;
        }
    };
    const opened = {
        name: 'Open chest',
        actions: () => chestOpen ? ['Bank', 'Shut'] : []
    };
    (Locs as any).query = queryReturning([closed, opened]);
    (Bank as any).isOpen = () => false;
    (Execution as any).delayUntil = async (condition: () => boolean) => condition();
    (Execution as any).delayTicks = async () => {};

    const delegated: { name: string; op: string }[] = [];
    (Bank as any).openNearest = async (name: string, op: string) => {
        delegated.push({ name, op });
        return true;
    };

    const result = await Bank.openNearestAccess({
        name: 'Open chest',
        op: 'Bank',
        openFirst: { name: 'Closed chest', op: 'Open' }
    });

    expect(result).toBe(true);
    expect(interactions).toEqual(['Open']);
    expect(delegated).toEqual([{ name: 'Open chest', op: 'Bank' }]);
});

test('uses an already-open bank chest without touching the closed one', async () => {
    const interactions: string[] = [];
    const closed = {
        name: 'Closed chest',
        actions: () => ['Open'],
        interact: async (op: string) => {
            interactions.push(op);
            return true;
        }
    };
    const opened = { name: 'Open chest', actions: () => ['Bank', 'Shut'] };
    (Locs as any).query = queryReturning([closed, opened]);
    (Bank as any).isOpen = () => false;

    const delegated: { name: string; op: string }[] = [];
    (Bank as any).openNearest = async (name: string, op: string) => {
        delegated.push({ name, op });
        return true;
    };

    const result = await Bank.openNearestAccess({
        name: 'Open chest',
        op: 'Bank',
        openFirst: { name: 'Closed chest', op: 'Open' }
    });

    expect(result).toBe(true);
    expect(interactions).toEqual([]);
    expect(delegated).toEqual([{ name: 'Open chest', op: 'Bank' }]);
});

test('fails safely when opening never exposes the configured bank action', async () => {
    let attempts = 0;
    const closed = {
        name: 'Closed chest',
        actions: () => ['Open'],
        interact: async () => {
            attempts++;
            return true;
        }
    };
    const opened = { name: 'Open chest', actions: () => ['Search', 'Shut'] };
    (Locs as any).query = queryReturning([closed, opened]);
    (Bank as any).isOpen = () => false;
    (Execution as any).delayUntil = async (condition: () => boolean) => condition();
    (Execution as any).delayTicks = async () => {};

    let delegated = false;
    (Bank as any).openNearest = async () => {
        delegated = true;
        return true;
    };

    const result = await Bank.openNearestAccess({
        name: 'Open chest',
        op: 'Bank',
        openFirst: { name: 'Closed chest', op: 'Open' }
    });

    expect(result).toBe(false);
    expect(attempts).toBe(3);
    expect(delegated).toBe(false);
});

test('Miner nearest-bank flow carries Duel Arena chest access through', async () => {
    (Locs as any).query = queryReturning([]);
    (Game as any).tile = () => ({ x: 3295, z: 3310, level: 0 });
    (Traversal as any).walkResilient = async () => true;
    (Execution as any).delayTicks = async () => {};

    let access: any = null;
    let deposited = false;
    (Bank as any).openNearestAccess = async (value: any) => {
        access = value;
        return true;
    };
    (Bank as any).depositAllMatching = async () => {
        deposited = true;
    };

    const result = await Banking.bankNearest({ deposit: name => name.includes('ore') });

    expect(result).toBe(true);
    expect(access).toEqual({
        name: 'Open chest',
        op: 'Bank',
        openFirst: { name: 'Closed chest', op: 'Open' }
    });
    expect(deposited).toBe(true);
});

test('Shantay Pass open uses Shantay chest (not Bank booth)', async () => {
    // Standing on the Shantay stand with no booth in scene — Tourist Trap buy-for-coins path.
    (Locs as any).query = queryReturning([]);
    (Game as any).tile = () => ({ x: 3308, z: 3120, level: 0 });
    (Traversal as any).walkResilient = async () => true;
    (Execution as any).delayTicks = async () => {};

    let access: any = null;
    (Bank as any).isOpen = () => false;
    (Bank as any).openNearestAccess = async (value: any) => {
        access = value;
        return true;
    };
    (Bank as any).openBooth = async () => {
        throw new Error('must not openBooth at Shantay');
    };
    (Bank as any).openNearest = async () => {
        throw new Error('must not openNearest(Bank booth) at Shantay');
    };

    const result = await Banking.open({
        stand: { x: 3309, z: 3120, level: 0 },
        log: () => {}
    });

    expect(result).toBe(true);
    expect(access).toEqual({ name: 'Shantay chest', op: 'Open' });
});
