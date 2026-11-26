import { spyOn } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';

interface BankFixtureState {
    pack: InvItemSnapshot[];
    bank: Map<number, number>;
    open: boolean;
    ready: boolean;
    sideReady: boolean;
    notes: boolean;
}

export function depositMatching(pack: readonly InvItemSnapshot[], bank: Map<number, number>, match: (name: string, id: number) => boolean): InvItemSnapshot[] {
    return pack.filter(item => {
        if (!match(item.name!, item.id)) return true;
        bank.set(item.id, (bank.get(item.id) ?? 0) + item.count);
        return false;
    });
}

export function depositPack(state: BankFixtureState) {
    for (const { id, count } of state.pack) {
        state.bank.set(id, (state.bank.get(id) ?? 0) + count);
    }
    state.pack = [];
}

export function installBankSpies(state: BankFixtureState) {
    spyOn(reader, 'bankComId').mockImplementation(() => state.open ? 5382 : -1);
    spyOn(reader, 'inventorySize').mockReturnValue(28);
    spyOn(reader, 'inventory').mockImplementation(() => state.pack);
    spyOn(reader, 'bankSideItems').mockImplementation(() => state.sideReady ? state.pack : []);
    spyOn(Bank, 'waitReady').mockImplementation(async () => state.ready);
    spyOn(Bank, 'backpackReady').mockImplementation(async () => state.sideReady);
    spyOn(Bank, 'countById').mockImplementation(id => state.ready ? state.bank.get(id) ?? 0 : 0);
    spyOn(Bank, 'depositInventory').mockImplementation(async () => depositPack(state));
    spyOn(Bank, 'setNoteMode').mockImplementation(async notes => { state.notes = notes; });
    spyOn(Bank, 'close').mockImplementation(async () => { state.open = false; return true; });
}
