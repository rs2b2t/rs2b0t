import { spyOn } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Banking, type OpenBankOpts } from '#/bot/api/bank/Banking.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Modals } from '#/bot/api/ui/widgets/Modals.js';
import { Input } from '#/bot/input/Input.js';

export const item = (id: number, name: string, slot: number): InvItemSnapshot => ({
    id, name, slot, count: 1, comId: 5064, ops: ['Deposit-1', 'Deposit-5', 'Deposit-10', 'Deposit-All', 'Deposit-X']
});
export const essencePack = () => [
    item(1438, 'Air talisman', 0),
    ...Array.from({ length: 27 }, (_, i) => item(1436, 'Rune essence', i + 1))
];

export function mockStartupBank(pack: InvItemSnapshot[]) {
    const state = {
        pack, open: false, accept: true,
        openCalls: [] as (OpenBankOpts | undefined)[], deposits: [] as number[]
    };
    spyOn(reader, 'bankComId').mockImplementation(() => state.open ? 5382 : -1);
    spyOn(reader, 'bankSideSnapshotReady').mockReturnValue(true);
    spyOn(reader, 'bankSideItems').mockImplementation(() => state.pack);
    spyOn(reader, 'inventory').mockImplementation(() => state.pack);
    spyOn(reader, 'bankItems').mockReturnValue([]);
    spyOn(reader, 'modals').mockImplementation(() => ({main: state.open ? 5292 : -1, side: state.open ? 5063 : -1, chat: -1}));
    spyOn(Inventory, 'used').mockImplementation(() => state.pack.length);
    spyOn(Inventory, 'free').mockImplementation(() => 28 - state.pack.length);
    spyOn(Bank, 'loaded').mockReturnValue(true);
    spyOn(Bank, 'ready').mockReturnValue(true);
    spyOn(Banking, 'open').mockImplementation(async options => {
        state.openCalls.push(options);
        state.open = true;
        return true;
    });
    spyOn(Modals, 'close').mockImplementation(async () => { state.open = false; return true; });
    spyOn(Modals, 'closeIfOpen').mockImplementation(async () => { state.open = false; });
    spyOn(Input, 'invButton').mockImplementation((id, slot, _com, op) => {
        state.deposits.push(id);
        if (!state.accept) return false;
        state.pack = state.pack.filter(i => op === 4 ? i.id !== id : i.slot !== slot);
        return true;
    });
    return state;
}
