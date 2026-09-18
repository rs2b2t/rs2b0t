import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader } from '../../src/bot/adapter/ClientAdapter.js';
import { Bank } from '../../src/bot/api/bank/Bank.js';
import { Banking } from '../../src/bot/api/bank/Banking.js';
import { Inventory } from '../../src/bot/api/inventory/Inventory.js';
import { Prayer } from '../../src/bot/api/prayer/Prayer.js';
import { Skills } from '../../src/bot/api/skills/Skills.js';
import { ARROWS, BOW, GEAR } from '../../src/bot/scripts/JiveKQ/loadout.js';
import { provision } from '../../src/bot/scripts/JiveKQ/supply.js';

afterEach(() => mock.restore());

function bankScene() {
    const state = { open: false, deposits: 0, closeOnDeposit: false, stock: 1 };
    spyOn(reader, 'equipment').mockReturnValue(GEAR.map((id, slot) => ({ id, slot, count: id === ARROWS ? 250 : 1, name: String(id), ops: ['Remove'], comId: 1 })));
    spyOn(Inventory, 'countById').mockReturnValue(0);
    spyOn(Skills, 'effective').mockReturnValue(99);
    spyOn(Skills, 'level').mockReturnValue(99);
    spyOn(Prayer, 'points').mockReturnValue(99);
    spyOn(Prayer, 'max').mockReturnValue(99);
    spyOn(Prayer, 'clear').mockResolvedValue();
    spyOn(Banking, 'open').mockImplementation(async () => { state.open = true; return true; });
    spyOn(Bank, 'waitReady').mockImplementation(async () => state.open);
    spyOn(Bank, 'isOpen').mockImplementation(() => state.open);
    spyOn(Bank, 'close').mockImplementation(async () => { state.open = false; return true; });
    spyOn(Bank, 'setNoteMode').mockResolvedValue();
    spyOn(Bank, 'depositAllMatching').mockImplementation(async () => {
        if (++state.deposits === 3 && state.closeOnDeposit) state.open = false;
    });
    spyOn(Bank, 'countById').mockImplementation(id => state.open ? (id === BOW ? state.stock : 1000) : 0);
    return state;
}

test('a bank closing during the empty-pack deposit retries provisioning instead of reporting a missing bow', async () => {
    const state = bankScene();
    state.closeOnDeposit = true;
    const messages: string[] = [];
    expect(await provision(1, message => messages.push(message))).toBe(false);
    expect(messages).toContain('bank: interrupted, retrying KQ supplies');
});

test('an open and ready bank with no bow still reports the stock shortage', async () => {
    const state = bankScene();
    state.stock = 0;
    await expect(provision(1, () => {})).rejects.toThrow('KQ bank needs 1 more of item 861');
});

test('a bank closing during withdrawal retries provisioning', async () => {
    const state = bankScene();
    spyOn(Bank, 'withdrawXById').mockImplementation(async () => { state.open = false; return false; });
    expect(await provision(1, () => {})).toBe(false);
});
