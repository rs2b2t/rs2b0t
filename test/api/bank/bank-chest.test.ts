/* eslint-disable @typescript-eslint/no-explicit-any -- API singletons are monkey-patched
   to exercise the stateful bank-object transition without a live client. */
import { afterEach, expect, test } from 'bun:test';

import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Banking, depositMatcher } from '#/bot/api/bank/Banking.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
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
    chatCanContinue: ChatDialog.canContinue,
    chatContinue: ChatDialog.continue,
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
    (ChatDialog as any).canContinue = originals.chatCanContinue;
    (ChatDialog as any).continue = originals.chatContinue;
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

function chestFixture(scenario: 'initially-closed' | 'already-open' | 'search-only') {
    let chestOpen = scenario !== 'initially-closed';
    const openAction = scenario === 'search-only' ? 'Search' : 'Bank';
    const interactions: string[] = [];
    const delegated: { name: string; op: string }[] = [];
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
        actions: () => (chestOpen ? [openAction, 'Shut'] : [])
    };
    (Locs as any).query = queryReturning([closed, opened]);
    (Bank as any).isOpen = () => false;
    (Bank as any).openNearest = async (name: string, op: string) => {
        delegated.push({ name, op });
        return true;
    };

    if (scenario !== 'already-open') {
        (Execution as any).delayUntil = async (condition: () => boolean) => condition();
        (Execution as any).delayTicks = async () => {};
    }

    const access = {
        name: 'Open chest',
        op: 'Bank',
        openFirst: { name: 'Closed chest', op: 'Open' }
    };
    return { access, interactions, delegated };
}

test('opens a closed chest before delegating to its bank action', async () => {
    const { access, interactions, delegated } = chestFixture('initially-closed');
    const result = await Bank.openNearestAccess(access);

    expect(result).toBe(true);
    expect(interactions).toEqual(['Open']);
    expect(delegated).toEqual([{ name: 'Open chest', op: 'Bank' }]);
});

test('uses an already-open bank chest without touching the closed one', async () => {
    const { access, interactions, delegated } = chestFixture('already-open');
    const result = await Bank.openNearestAccess(access);

    expect(result).toBe(true);
    expect(interactions).toEqual([]);
    expect(delegated).toEqual([{ name: 'Open chest', op: 'Bank' }]);
});

test('fails safely when opening never exposes the configured bank action', async () => {
    const { access, interactions, delegated } = chestFixture('search-only');
    const result = await Bank.openNearestAccess(access);

    expect(result).toBe(false);
    expect(interactions).toEqual(['Open', 'Open', 'Open']);
    expect(delegated).toEqual([]);
});

test('Miner nearest-bank flow carries Duel Arena chest access through', async () => {
    (Locs as any).query = queryReturning([]);
    (Game as any).tile = () => ({ x: 3295, z: 3310, level: 0 });
    (Traversal as any).walkResilient = async () => true;
    let ticks = 0;
    Execution.delayTicks = async n => { ticks += n; };

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
    expect(ticks).toBe(0);
    expect(access).toEqual({
        name: 'Open chest',
        op: 'Bank',
        openFirst: { name: 'Closed chest', op: 'Open' }
    });
    expect(deposited).toBe(true);
});

test('Shantay Pass open uses Shantay chest (not Bank booth)', async () => {
    // Standing on the Shantay stand with no booth in scene, Tourist Trap buy-for-coins path.
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
        stand: { x: 3308, z: 3120, level: 0 },
        log: () => {}
    });

    expect(result).toBe(true);
    expect(access).toEqual({ name: 'Shantay chest', op: 'Open' });
});

test('object bank waits for its Continue dialogue to open the bank', async () => {
    let bankOpen = false;
    let dialogOpen = false;
    let resumePending = false;
    let interactions = 0;
    const chest = {
        name: 'Shantay chest',
        actions: () => ['Open'],
        distance: () => 1,
        tile: () => ({ x: 3308, z: 3120, level: 0 }),
        interact: async () => {
            if (resumePending) throw new Error('duplicate chest interaction canceled pending bank open');
            interactions++;
            dialogOpen = true;
            return true;
        }
    };
    (Locs as any).query = queryReturning([chest]);
    (Bank as any).isOpen = () => bankOpen;
    (ChatDialog as any).canContinue = () => dialogOpen;
    (ChatDialog as any).continue = async () => {
        dialogOpen = false;
        resumePending = true;
        return true;
    };
    (Execution as any).delayUntil = async (condition: () => boolean) => {
        if (!condition() && resumePending) {
            resumePending = false;
            bankOpen = true;
        }
        return condition();
    };

    expect(await Bank.openNearest('Shantay chest', 'Open')).toBe(true);
    expect(interactions).toBe(1);
});
