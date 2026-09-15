import { mock, spyOn } from 'bun:test';
import { reader, type InvItemSnapshot, type NpcSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { InvItem } from '#/bot/api/inventory/Inventory.js';
import { Loadouts } from '#/bot/api/loadout/loadoutStore.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import Tile from '#/bot/geometry/Tile.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import JiveDemons from '#/bot/scripts/JiveDemons/JiveDemons.js';
import JiveDragons from '#/bot/scripts/JiveDragons/JiveDragons.js';
import { BRIMHAVEN_IRON } from '#/bot/scripts/JiveDragons/sites.js';
import JiveKBD from '#/bot/scripts/JiveKBD/JiveKBD.js';
import { KBD_LAIR } from '#/bot/scripts/JiveKBD/sites.js';

export const SHIELD = 'Dragonfire shield';
export const shield = (): InvItemSnapshot => ({ id: 1540, name: SHIELD, slot: 5, count: 1, comId: 3214, ops: ['Wield'] });
export const food = (name = 'Lobster', id = 379): InvItemSnapshot => ({ id, name, slot: 0, count: 1, comId: 3214, ops: ['Eat'] });

export async function safetyScenario(kind: 'dragons' | 'kbd' | 'demons', settings: Record<string, unknown> = {}) {
    const site = kind === 'kbd' ? KBD_LAIR : BRIMHAVEN_IRON;
    const pack: InvItemSnapshot[] = [
        ...Array.from({ length: 20 }, (_, slot) => ({ ...food(site.food ?? 'Lobster', site.food === 'Shark' ? 385 : 379), slot })),
        { ...food('Air rune', 556), slot: 20, count: 1000 },
        { ...food('Mind rune', 558), slot: 21, count: 1000 },
        { ...food('Coins', 995), slot: 22, count: 10000 }
    ];
    const state = {
        pack, worn: [{ ...food('Staff of fire', 1387), slot: 3 }], bank: [shield()],
        tile: site.bank, open: false, loaded: true, openAllowed: true, hp: 99, now: 10000, npcs: [] as NpcSnapshot[]
    };
    spyOn(reader, 'inventory').mockImplementation(() => state.pack);
    spyOn(reader, 'inventorySize').mockReturnValue(28);
    spyOn(reader, 'bankSideItems').mockImplementation(() => state.pack);
    spyOn(reader, 'bankComId').mockImplementation(() => state.open ? 5292 : -1);
    spyOn(reader, 'bankItems').mockImplementation(() => state.open && state.loaded ? state.bank : []);
    spyOn(reader, 'equipment').mockImplementation(() => state.worn);
    spyOn(reader, 'npcs').mockImplementation(() => state.npcs);
    spyOn(reader, 'selfFaceEntity').mockReturnValue(-1);
    spyOn(reader, 'selfSlot').mockReturnValue(1);
    spyOn(performance, 'now').mockImplementation(() => state.now);
    spyOn(Loadouts, 'all').mockReturnValue(typeof settings.food === 'string' ? [{ name: 'test', worn: {}, carry: [{ item: settings.food, qty: 20 }] }] : []);
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(Game, 'tile').mockImplementation(() => state.tile);
    spyOn(Game, 'inCombat').mockReturnValue(false);
    spyOn(Game, 'tick').mockReturnValue(0);
    spyOn(Skills, 'level').mockReturnValue(99);
    spyOn(Skills, 'effective').mockImplementation(name => name === 'hitpoints' ? state.hp : 99);
    spyOn(Skills, 'xp').mockReturnValue(0);
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(EventSignal, 'pending').mockReturnValue(false);
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => Boolean(await predicate()));
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async predicate => Boolean(await predicate()));
    spyOn(Execution, 'delayTicks').mockImplementation(async () => { state.now += 600; });
    spyOn(Traversal, 'walkResilient').mockImplementation(async tile => { state.tile = new Tile(tile.x, tile.z, tile.level); return true; });
    spyOn(Reachability, 'lineOfSight').mockReturnValue(true);
    spyOn(Reachability, 'canReach').mockReturnValue(true);
    spyOn(Bank, 'isOpen').mockImplementation(() => state.open);
    spyOn(Bank, 'loaded').mockImplementation(() => state.loaded);
    spyOn(Bank, 'openNearest').mockImplementation(async () => { state.open = state.openAllowed; return state.open; });
    spyOn(Bank, 'close').mockImplementation(async () => { state.open = false; return true; });
    spyOn(Bank, 'depositAllMatching').mockResolvedValue(undefined);
    spyOn(Bank, 'deposit').mockImplementation(name => {
        const held = state.pack.find(i => i.name === name);
        if (!held || !state.open || !state.loaded) return false;
        state.pack = state.pack.filter(i => i !== held);
        const banked = state.bank.find(i => i.id === held.id);
        if (banked) banked.count += held.count;
        else state.bank.push({ ...held });
        return true;
    });
    spyOn(Bank, 'withdraw').mockImplementation(name => {
        const held = state.bank.find(i => i.name === name);
        if (!held || !state.open || !state.loaded || state.pack.length >= 28) return false;
        state.bank = state.bank.filter(i => i !== held);
        state.pack.push(held);
        return true;
    });
    spyOn(Bank, 'withdrawX').mockResolvedValue(false);
    spyOn(Equipment, 'equip').mockImplementation(async name => {
        const held = state.pack.find(i => i.name === name);
        if (!held) return false;
        state.pack = state.pack.filter(i => i !== held);
        state.worn.push(held);
        state.open = false;
        return true;
    });
    const bot = kind === 'kbd' ? new JiveKBD() : kind === 'demons' ? new JiveDemons() : new JiveDragons();
    bot.bindLog(() => {});
    bot.settings = new SettingsBag({ site: site.key, combatStyle: 'mage', solveClues: false, ...settings });
    await bot.onStart();
    Sustain.set(null);
    const task = (name: string) => {
        const found = bot['tasks'].find(t => t.constructor.name === name);
        if (!found) throw new Error(`Missing ${name}`);
        return found;
    };
    const interact = spyOn(InvItem.prototype, 'interact').mockReturnValue(true);
    return { bot, state, site, task, interact };
}

export function restoreSafety(): void {
    Sustain.set(null);
    mock.restore();
}
