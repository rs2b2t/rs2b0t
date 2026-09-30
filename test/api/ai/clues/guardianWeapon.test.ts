import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { hardKitFingerprint, stockHardWeapon } from '#/bot/api/ai/clues/hardCluePreparation.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';

function item(id: number, name: string, count = 1): InvItemSnapshot {
    return { id, name, count, slot: 0, comId: 1, ops: ['Wield'] };
}
const sword = item(1305, 'Dragon longsword');
const dagger = item(1231, 'Dragon dagger(p)');
let pack: InvItemSnapshot[];
let bank: InvItemSnapshot[];
let worn: InvItemSnapshot[];
let remembered: string[];
const remember = (name: string): void => { remembered.push(name); };

beforeEach(() => {
    pack = [];
    bank = [item(2448, 'Superantipoison(4)'), item(385, 'Shark', 30)];
    worn = [{ ...item(861, 'Magic shortbow'), slot: 3 }];
    remembered = [];
    spyOn(reader, 'inventory').mockImplementation(() => pack);
    spyOn(reader, 'bankSideItems').mockImplementation(() => pack);
    spyOn(reader, 'equipment').mockImplementation(() => worn);
    spyOn(reader, 'bankComId').mockReturnValue(1);
    spyOn(reader, 'bankSnapshotReady').mockReturnValue(true);
    spyOn(reader, 'bankItems').mockImplementation(() => bank);
    spyOn(Skills, 'level').mockReturnValue(60);
    spyOn(Quests, 'status').mockReturnValue('complete');
    spyOn(Game, 'tile').mockReturnValue(null);
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    spyOn(Bank, 'openNearest').mockResolvedValue(true);
    spyOn(Bank, 'withdraw').mockImplementation(name => {
        const source = bank.find(i => i.name === name && i.count > 0);
        if (!source) return false;
        pack.push({ ...source, count: 1 });
        bank = bank.filter(i => i !== source);
        return true;
    });
    spyOn(Equipment, 'equip').mockImplementation(async name => {
        const next = pack.find(i => i.name === name);
        if (!next) return worn.some(i => i.name === name);
        pack = [...pack.filter(i => i !== next), ...worn];
        worn = [{ ...next, slot: 3 }];
        return true;
    });
    spyOn(Equipment, 'unequip').mockImplementation(async name => {
        pack.push(...worn.filter(i => i.name === name));
        worn = worn.filter(i => i.name !== name);
        return true;
    });
    spyOn(Bank, 'depositAllMatching').mockImplementation(async predicate => {
        bank.push(...pack.filter(i => predicate(i.name ?? '', i.id)));
        pack = pack.filter(i => !predicate(i.name ?? '', i.id));
    });
});
afterEach(() => mock.restore());

test('keeps the equipped longsword when a dagger is banked', async () => {
    worn = [{ ...sword, slot: 3 }];
    bank.push(dagger);

    expect(await stockHardWeapon(false, remember)).toBe(true);
    expect(worn[0].id).toBe(1305);
    expect(bank.some(i => i.id === 1231)).toBe(true);
    expect(remembered).toEqual([]);
});
test.each(['inventory', 'bank'])('equips a longsword from the %s without requiring a dagger', async source => {
    (source === 'inventory' ? pack : bank).push(sword);

    expect(await stockHardWeapon(false, remember)).toBe(true);
    expect(worn[0].id).toBe(1305);
    expect(remembered).toEqual(['Magic shortbow']);
});
test('prefers the configured supported weapon after Entrana strips equipment', async () => {
    worn = [];
    bank.push(dagger, sword);

    expect(await stockHardWeapon(false, remember, 'Dragon longsword')).toBe(true);
    expect(worn[0].id).toBe(1305);
});
test('falls back to a dagger when the configured weapon is unavailable', async () => {
    bank.push(dagger);

    expect(await stockHardWeapon(false, remember, 'Dragon longsword')).toBe(true);
    expect(worn[0].id).toBe(1231);
});
test('never selects an unsupported configured weapon', async () => {
    bank.push(dagger, item(1333, 'Rune scimitar'));

    expect(await stockHardWeapon(false, remember, 'Rune scimitar')).toBe(true);
    expect(worn[0].id).toBe(1231);
});
test('banks the accepted longsword before visiting Entrana', async () => {
    worn = [{ ...sword, slot: 3 }];

    expect(await stockHardWeapon(true, remember)).toBe(true);
    expect(worn).toEqual([]);
    expect(pack.some(i => i.id === 1305)).toBe(false);
    expect(bank.some(i => i.id === 1305)).toBe(true);
});
test('adding a longsword changes the blocked-kit fingerprint', () => {
    const before = hardKitFingerprint(true);
    bank.push(sword);
    expect(hardKitFingerprint(true)).not.toBe(before);
});
