import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { BANK_LOCATIONS } from '#/bot/api/bank/BankLocations.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import Tile from '#/bot/geometry/Tile.js';
import JiveEnchanter from '#/bot/scripts/JiveEnchanter/JiveEnchanter.js';

const RING = 1637;
const RECOIL = 2550;
const COSMIC = 564;
const WATER = 555;
const STAFF = 1383;
const names = new Map([[RING, 'Sapphire ring'], [RECOIL, 'Ring of recoil'], [COSMIC, 'Cosmic rune'], [WATER, 'Water rune'], [STAFF, 'Staff of water']]);

function item(id: number, count = 1, slot = 0): InvItemSnapshot {
    return { id, name: names.get(id)!, count, slot, comId: 3214, ops: [] };
}

function fixture(pack: InvItemSnapshot[] = [], staff = false, tile = new Tile(3094, 3493, 0)) {
    const state = { pack, bank: new Map([[COSMIC, 100], [WATER, 100]]), open: false, closeFailures: 0, hideOnFailedClose: false };
    spyOn(reader, 'inventory').mockImplementation(() => state.pack);
    spyOn(reader, 'bankSideItems').mockImplementation(() => state.pack);
    spyOn(reader, 'bankComId').mockImplementation(() => state.open ? 5292 : -1);
    spyOn(reader, 'bankItems').mockImplementation(() => [...state.bank].map(([id, count], slot) => item(id, count, slot)));
    spyOn(reader, 'equipment').mockReturnValue(staff ? [item(STAFF)] : []);
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue(tile);
    spyOn(Game, 'tick').mockReturnValue(0);
    spyOn(Skills, 'level').mockReturnValue(99);
    spyOn(Skills, 'effective').mockReturnValue(99);
    spyOn(Skills, 'xp').mockReturnValue(0);
    spyOn(Quests, 'status').mockReturnValue('complete');
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => Boolean(await predicate()));
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async predicate => Boolean(await predicate()));
    spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
    spyOn(Bank, 'isOpen').mockImplementation(() => state.open);
    spyOn(Bank, 'loaded').mockReturnValue(true);
    const open = async () => { state.open = true; return true; };
    spyOn(Bank, 'openNearest').mockImplementation(open);
    spyOn(Bank, 'openNearestAccess').mockImplementation(open);
    spyOn(Bank, 'openNpcAccess').mockImplementation(open);
    const close = spyOn(Bank, 'close').mockImplementation(async () => {
        if (state.closeFailures > 0) {
            state.closeFailures--;
            state.open = !state.hideOnFailedClose;
            return false;
        }
        state.open = false;
        return true;
    });
    spyOn(Bank, 'depositAllMatching').mockImplementation(async match => {
        state.pack = state.pack.filter(i => {
            if (!match(i.name!, i.id)) return true;
            state.bank.set(i.id, (state.bank.get(i.id) ?? 0) + i.count);
            return false;
        });
    });
    const withdraw = async (id: number, count: number) => {
        const stackable = id === COSMIC || id === WATER;
        const existing = stackable ? state.pack.find(i => i.id === id) : undefined;
        if ((state.bank.get(id) ?? 0) < count || state.pack.length + (existing ? 0 : stackable ? 1 : count) > 28) return false;
        state.bank.set(id, state.bank.get(id)! - count);
        if (existing) existing.count += count;
        else if (stackable) state.pack.push(item(id, count));
        else state.pack.push(...Array.from({ length: count }, () => item(id)));
        state.pack.forEach((i, slot) => { i.slot = slot; });
        return true;
    };
    spyOn(Bank, 'withdrawXById').mockImplementation(withdraw);
    spyOn(Bank, 'withdrawX').mockImplementation(async (name, count) => withdraw([...names].find(([, value]) => value === name)![0], count));
    spyOn(Game, 'openSideTab').mockImplementation(async () => !state.open);
    const cast = spyOn(Game, 'castOnItem').mockImplementation(async (_spell, target) => {
        if (state.open) return false;
        const ring = state.pack.find(i => i.slot === target.slot)!;
        ring.id = RECOIL;
        ring.name = names.get(RECOIL)!;
        for (const id of staff ? [COSMIC] : [COSMIC, WATER]) state.pack.find(i => i.id === id)!.count--;
        state.pack = state.pack.filter(i => i.count > 0);
        return true;
    });
    const bot = new JiveEnchanter();
    bot.bindLog(() => {});
    return { bot, state, close, cast };
}

afterEach(() => mock.restore());

describe('JiveEnchanter task loops', () => {
    test('closes the bank and enchants after finding no staff with a castable pack', async () => {
        const { bot, state, cast } = fixture([item(RING), item(COSMIC, 10, 1), item(WATER, 10, 2)]);
        await bot.onStart();
        await bot.loop();
        expect(state.open).toBe(true);
        await bot.loop();
        expect(state.open).toBe(false);
        expect(cast).toHaveBeenCalledTimes(1);
        expect(Inventory.countById(RECOIL)).toBe(1);
    });

    test.each([false, true])('retries a failed bank close before casting, hidden bank=%s', async hidden => {
        const { bot, state, close, cast } = fixture([item(RING), item(COSMIC, 10, 1)], true);
        state.open = true;
        state.closeFailures = 1;
        state.hideOnFailedClose = hidden;
        await bot.onStart();
        await bot.loop();
        await bot.loop();
        expect(close).toHaveBeenCalledTimes(1);
        expect(cast).not.toHaveBeenCalled();
        await bot.loop();
        expect(close).toHaveBeenCalledTimes(2);
        expect(Inventory.countById(RECOIL)).toBe(1);
    });

    test.each([false, true])('makes rune slots when starting with 28 jewels, staff=%s', async staff => {
        const { bot, state } = fixture(Array.from({ length: 28 }, (_, slot) => item(RING, 1, slot)), staff);
        await bot.onStart();
        await bot.loop();
        await bot.loop();
        const jewels = staff ? 27 : 26;
        expect(Inventory.countById(RING)).toBe(jewels);
        expect(Inventory.countById(COSMIC)).toBe(jewels);
        expect(Inventory.countById(WATER)).toBe(staff ? 0 : jewels);
        expect(state.bank.get(RING)).toBe(28 - jewels);
        expect(Inventory.used()).toBe(28);
        await bot.loop();
        expect(Inventory.countById(RECOIL)).toBe(1);
    });
});

describe('JiveEnchanter bank access', () => {
    test.each(['Shilo Village', 'Duel Arena'])('preserves the access for %s', async name => {
        const bank = BANK_LOCATIONS.find(b => b.name === name)!;
        const { bot } = fixture([], false, bank.tile);
        spyOn(Bank, 'openNearest').mockResolvedValue(false);
        const npc = spyOn(Bank, 'openNpcAccess').mockImplementation(async access => access === bank.npcAccess);
        const object = spyOn(Bank, 'openNearestAccess').mockImplementation(async access => access === bank.access);
        await bot.onStart();
        expect(await bot.openBank()).toBe(true);
        expect(bank.npcAccess ? npc : object).toHaveBeenCalledWith(bank.npcAccess ?? bank.access, expect.any(Function));
        expect(bank.npcAccess ? object : npc).not.toHaveBeenCalled();
    });
});
