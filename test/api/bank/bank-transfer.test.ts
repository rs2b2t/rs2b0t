import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { actions, reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Input } from '#/bot/input/Input.js';

afterEach(() => mock.restore());

function item(id: number, count = 1, slot = 0): InvItemSnapshot {
    return { id, count, slot, name: 'Herb', comId: 5382, ops: ['Withdraw-1', 'Withdraw-5', 'Withdraw-10', 'Withdraw-All', 'Withdraw-X'] };
}

function fixture() {
    const state = {
        open: true, ready: true, elapsed: 0,
        stock: [item(199, 100)], pack: [] as InvItemSnapshot[],
        advance: () => {}
    };
    spyOn(reader, 'bankComId').mockImplementation(() => state.open ? 5382 : -1);
    spyOn(reader, 'modals').mockImplementation(() => ({ main: 5292, side: state.open ? 5063 : -1, chat: -1 }));
    spyOn(reader, 'bankSideSnapshotReady').mockImplementation(() => state.ready);
    spyOn(reader, 'bankSideItems').mockImplementation(() => state.pack);
    spyOn(reader, 'bankItems').mockImplementation(() => state.stock);
    spyOn(Execution, 'delayTicks').mockImplementation(async ticks => { state.elapsed += ticks * 600; state.advance(); });
    spyOn(Execution, 'delayUntil').mockImplementation(async (condition, timeout = 6000) => {
        const deadline = state.elapsed + timeout;
        while (!condition() && state.elapsed < deadline) {
            state.elapsed += 20;
            state.advance();
        }
        return condition();
    });
    spyOn(actions, 'answerCountDialog').mockImplementation(() => { throw new Error('unexpected quantity dialog'); });
    spyOn(Input, 'invButton').mockReturnValue(false);
    return state;
}

test('depositing the last item returns on its acknowledgement without an empty-pack timeout', async () => {
    const state = fixture();
    state.pack = Array.from({ length: 28 }, (_, slot) => ({ ...item(249, 1, slot), ops: ['Deposit-1', null, null, 'Deposit-All'] }));
    spyOn(Input, 'invButton').mockImplementation((id, slot, _com, op) => {
        expect([id, slot, op]).toEqual([249, 0, 4]);
        state.advance = () => { state.pack = []; };
        return true;
    });
    await Bank.depositInventory();
    expect(state.pack).toEqual([]);
    expect(state.elapsed).toBeLessThan(100);
});

test('an acknowledged empty pack needs no deposit wait', async () => {
    const state = fixture();
    await Bank.depositInventory();
    expect(state.elapsed).toBe(0);
});

test('an empty deposit view waits for the snapshot, then returns immediately', async () => {
    const state = fixture();
    state.ready = false;
    state.advance = () => { if (state.elapsed >= 100) state.ready = true; };
    await Bank.depositInventory();
    expect(state.ready).toBe(true);
    expect(state.elapsed).toBe(100);
});

test('ready withdrawals do not spend an extra server tick before clicking', async () => {
    const state = fixture();
    spyOn(Input, 'invButton').mockImplementation(() => {
        state.advance = () => { state.pack = [item(199)]; };
        return true;
    });
    expect(await Bank.withdrawXById(199, 1)).toBe(true);
    expect(state.pack).toHaveLength(1);
    expect(state.elapsed).toBeLessThan(100);
});

test('withdrawals wait for the side snapshot before measuring the starting count', async () => {
    const state = fixture();
    state.ready = false;
    state.advance = () => {
        if (state.elapsed >= 100) {
            state.ready = true;
            state.pack = [item(199, 3)];
        }
    };
    spyOn(Input, 'invButton').mockImplementation(() => {
        expect(state.ready).toBe(true);
        state.advance = () => { state.pack = [item(199, 4)]; };
        return true;
    });
    expect(await Bank.withdrawXById(199, 1)).toBe(true);
    expect(state.pack[0].count).toBe(4);
    expect(state.elapsed).toBe(120);
});

test('an unavailable side snapshot prevents a withdrawal', async () => {
    const state = fixture();
    state.ready = false;
    const click = spyOn(Input, 'invButton');
    expect(await Bank.withdrawXById(199, 1)).toBe(false);
    expect(click).not.toHaveBeenCalled();
});

test('backpack readiness can wait for any loaded contents before depositing', async () => {
    const state = fixture();
    state.ready = false;
    state.advance = () => {
        if (state.elapsed >= 1600) {
            state.ready = true;
            state.pack = [item(249)];
        }
    };
    expect(await Bank.backpackReady()).toBe(true);
    expect(state.pack[0].id).toBe(249);
    expect(state.elapsed).toBe(1600);
});

test('load withdrawal selects the exact herb ID and waits for the whole pack update', async () => {
    const state = fixture();
    state.stock = [item(201, 100), item(199, 28, 1)];
    spyOn(Input, 'invButton').mockImplementation((id, slot, _com, op) => {
        expect([id, slot, op]).toEqual([199, 1, 4]);
        state.stock = [item(201, 100)];
        state.advance = () => {
            state.pack = Array.from({ length: state.elapsed >= 60 ? 28 : 1 }, (_, index) => item(199, 1, index));
        };
        return true;
    });
    expect(await Bank.withdrawLoad(199)).toBe(true);
    expect(state.pack).toHaveLength(28);
    expect(state.elapsed).toBe(60);
});

test('load withdrawal does not succeed on a bank update without backpack items', async () => {
    const state = fixture();
    spyOn(Input, 'invButton').mockImplementation(() => { state.stock = []; return true; });
    expect(await Bank.withdrawLoad('Herb')).toBe(false);
    expect(state.pack).toEqual([]);
});

test('load withdrawal skips the click when an All-capable item has no free slots', async () => {
    const state = fixture();
    state.pack = Array.from({ length: 28 }, (_, slot) => item(249, 1, slot));
    const click = spyOn(Input, 'invButton');
    expect(await Bank.withdrawLoad('Herb')).toBe(true);
    expect(click).not.toHaveBeenCalled();
});
