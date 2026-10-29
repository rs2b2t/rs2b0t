import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { executeStep } from '#/bot/api/ai/quests/exec/steps.js';
import type { QuestStep } from '#/bot/api/ai/quests/engine/types.js';
import { Banking } from '#/bot/api/bank/Banking.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Modals } from '#/bot/api/ui/widgets/Modals.js';
import Tile from '#/bot/geometry/Tile.js';
import { Input } from '#/bot/input/Input.js';
import { ScriptAborted } from '#/bot/runtime/ScriptContext.js';

afterEach(() => mock.restore());

function item(id: number, name: string | null, slot = 0): InvItemSnapshot {
    return { id, name, slot, count: 1, comId: 5064, ops: ['Deposit-1', null, null, 'Deposit-All'] };
}

function fixture(pack: InvItemSnapshot[]) {
    const state = { pack, open: true, ready: true, closed: 0, elapsed: 0, accept: true, advance: () => {} };
    spyOn(Banking, 'open').mockResolvedValue(true);
    spyOn(reader, 'bankComId').mockImplementation(() => state.open ? 5382 : -1);
    spyOn(reader, 'modals').mockImplementation(() => ({ main: 5292, side: state.open ? 5063 : -1, chat: -1 }));
    spyOn(reader, 'bankSideItems').mockImplementation(() => state.ready ? state.pack : []);
    spyOn(reader, 'bankSideSnapshotReady').mockImplementation(() => state.ready);
    spyOn(reader, 'inventory').mockReturnValue(pack);
    spyOn(Execution, 'delayUntil').mockImplementation(async (condition, timeout = 6000) => {
        const deadline = state.elapsed + timeout;
        while (!condition() && state.elapsed < deadline) {
            state.elapsed += 20;
            state.advance();
        }
        return condition();
    });
    spyOn(Input, 'invButton').mockImplementation(id => {
        if (state.accept) state.pack = state.pack.filter(entry => entry.id !== id);
        return state.accept;
    });
    spyOn(Modals, 'close').mockImplementation(async () => {
        state.open = false;
        state.closed++;
        return true;
    });
    return state;
}

function deposit(options: Partial<Extract<QuestStep, { kind: 'deposit' }>> = {}): Promise<boolean> {
    return executeStep({ kind: 'deposit', bank: new Tile(2616, 3332, 0), keep: [], ...options }, [], () => {});
}

test('a full bank refusing a full backpack does not complete the deposit step', async () => {
    const state = fixture(Array.from({ length: 28 }, (_, slot) => item(1511, 'Logs', slot)));
    state.accept = false;
    expect(await deposit()).toBe(false);
    expect(state.pack).toHaveLength(28);
    expect(state.closed).toBe(1);
});

test('an unavailable bank side snapshot cannot count as an empty backpack', async () => {
    const state = fixture([item(1511, 'Logs')]);
    state.ready = false;
    expect(await deposit({ leaveOpen: true })).toBe(false);
    expect(state.pack.map(entry => entry.id)).toEqual([1511]);
});

test('deposit waits for delayed side contents before clearing the backpack', async () => {
    const state = fixture([item(1511, 'Logs')]);
    state.ready = false;
    state.advance = () => { if (state.elapsed >= 1600) state.ready = true; };
    expect(await deposit()).toBe(true);
    expect(state.pack).toEqual([]);
    expect(state.closed).toBe(1);
});

test('deposit preserves exact quest items and verifies the bank side before closing', async () => {
    const state = fixture([
        item(293, 'A key'), item(298, 'A key', 1), item(954, 'Rope', 2),
        item(1111, 'Rope fragment', 3), item(9999, null, 4)
    ]);
    expect(await deposit({ keep: ['ROPE'], keepIds: [293], exactKeep: true })).toBe(true);
    expect(state.pack.map(entry => entry.id)).toEqual([293, 954]);
    expect(state.closed).toBe(1);
});

test('substring keeps preserve quest item variants and leaveOpen keeps the bank open', async () => {
    const state = fixture([item(954, 'Rope'), item(1111, 'Rope fragment', 1), item(1511, 'Logs', 2)]);
    expect(await deposit({ keep: ['rope'], leaveOpen: true })).toBe(true);
    expect(state.pack.map(entry => entry.id)).toEqual([954, 1111]);
    expect(state.open).toBe(true);
});

test('a bank closing during deposit cannot report an empty side view as success', async () => {
    const state = fixture([item(1511, 'Logs')]);
    state.accept = false;
    state.advance = () => { state.open = false; state.ready = false; };
    expect(await deposit({ leaveOpen: true })).toBe(false);
    expect(state.pack.map(entry => entry.id)).toEqual([1511]);
});

test('stop interrupts deposit without closing the bank or reporting success', async () => {
    const state = fixture([item(1511, 'Logs')]);
    state.accept = false;
    const stopped = new ScriptAborted();
    spyOn(Execution, 'delayUntil').mockRejectedValue(stopped);
    await expect(deposit()).rejects.toBe(stopped);
    expect(state.closed).toBe(0);
});
