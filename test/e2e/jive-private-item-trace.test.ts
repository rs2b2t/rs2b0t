import assert from 'node:assert/strict';
import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import type { Page } from 'playwright-core';
import { installPrivateTrace } from '../../e2e/jive-private-trace.js';
import { actions, reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { Game } from '#/bot/api/game/Game.js';
import { GroundItem } from '#/bot/api/model/GroundItem.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Input } from '#/bot/input/Input.js';

const descriptors = ['__rs2b0t', 'rs2b0t'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
let pack: InvItemSnapshot[];
let tick: () => void;

beforeEach(async () => {
    pack = [0, 1].map(slot => ({ id: 385, name: 'Shark', count: 1, slot, comId: 1, ops: ['Eat', 'Drop'] }));
    spyOn(reader, 'inventory').mockImplementation(() => pack);
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(Bank, 'ready').mockReturnValue(false);
    spyOn(Input, 'heldOp').mockReturnValue(true);
    Object.defineProperty(globalThis, '__rs2b0t', { configurable: true, value: {
        Bank, Equipment, Inventory, InvItem, Skills, Quests, Game, GroundItem, Traversal
    } });
    Object.defineProperty(globalThis, 'rs2b0t', { configurable: true, value: {
        reader, actions, clueProgress: () => null,
        runner: { bot: null, onChange: () => () => {} },
        host: { addTickListener(callback: () => void) { tick = callback; return () => {}; } }
    } });
    const page = { async evaluate<R, A>(callback: string | ((arg: A) => R), arg: A): Promise<R> {
        assert(typeof callback === 'function');
        return callback(arg);
    } } as Page;
    await installPrivateTrace(page, 3544);
});

afterEach(() => {
    globalThis.__jivePrivate?.restore();
    globalThis.__jivePrivate = undefined;
    globalThis.__jiveHostTraceFactory = undefined;
    for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
    mock.restore();
});

test('confirms a Shark drop only after inventory decreases and does not count it as eaten', async () => {
    await new InvItem(pack[0]).interact('Drop');
    tick();
    expect(globalThis.__jivePrivate?.events.some(e => e.kind === 'drop-confirmed')).toBe(false);
    pack.pop();
    tick();
    const confirmed = globalThis.__jivePrivate?.events.filter(e => e.kind === 'drop-confirmed');
    expect(confirmed).toHaveLength(1);
    expect(confirmed?.[0]).toMatchObject({ action: 'Drop Shark', sharks: 1, used: 1, consumed: [{ id: 385, count: 0 }] });
    tick();
    expect(globalThis.__jivePrivate?.events.filter(e => e.kind === 'drop-confirmed')).toHaveLength(1);
});

test('does not confirm a rejected drop when the Shark count later changes', async () => {
    spyOn(Input, 'heldOp').mockReturnValue(false);
    await new InvItem(pack[0]).interact('Drop');
    pack.pop();
    tick();
    expect(globalThis.__jivePrivate?.events.some(e => e.kind === 'drop-confirmed')).toBe(false);
});

test('retains consumed Shark accounting for a confirmed Eat', async () => {
    await new InvItem(pack[0]).interact('Eat');
    pack.pop();
    tick();
    expect(globalThis.__jivePrivate?.events.find(e => e.kind === 'eat-confirmed')).toMatchObject({
        action: 'Eat Shark', consumed: [{ id: 385, count: 1 }]
    });
    expect(globalThis.__jivePrivate?.events.some(e => e.kind === 'drop-confirmed')).toBe(false);
});
