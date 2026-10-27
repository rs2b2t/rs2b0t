import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { ClueExecutor } from '#/bot/api/ai/clues/ClueExecutor.js';
import { SolveClue } from '#/bot/api/ai/clues/SolveClue.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Loadouts } from '#/bot/api/loadout/loadoutStore.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import Tile from '#/bot/geometry/Tile.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import ArdyFighter from '#/bot/scripts/ArdyFighter/ArdyFighter.js';

const item = (id: number, name: string): InvItemSnapshot => ({ id, name, count: 1, slot: 0, comId: 3214, ops: ['Wield'] });
const weapon = item(1333, 'Rune scimitar');
let pack: InvItemSnapshot[];
let worn: InvItemSnapshot[];
let bank: InvItemSnapshot[];
let open: boolean;
let bot: ArdyFighter;

beforeEach(() => {
    pack = [item(3490, 'Clue scroll'), item(561, 'Nature rune')];
    worn = [];
    bank = [];
    open = false;
    spyOn(reader, 'inventory').mockImplementation(() => pack);
    spyOn(reader, 'bankSideItems').mockImplementation(() => pack);
    spyOn(reader, 'equipment').mockImplementation(() => worn);
    spyOn(reader, 'inventorySize').mockReturnValue(28);
    spyOn(reader, 'bankComId').mockImplementation(() => open ? 1 : -1);
    spyOn(reader, 'bankSnapshotReady').mockReturnValue(true);
    spyOn(reader, 'bankItems').mockImplementation(() => bank);
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue(new Tile(2655, 3286, 0));
    spyOn(Skills, 'level').mockReturnValue(60);
    spyOn(Skills, 'effective').mockReturnValue(60);
    spyOn(Skills, 'xp').mockReturnValue(0);
    spyOn(Traversal, 'walkResilient').mockResolvedValue(true);
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async predicate => predicate());
    spyOn(Execution, 'delayTicks').mockResolvedValue();
    spyOn(Bank, 'openNearest').mockImplementation(async () => { open = true; return true; });
    spyOn(Bank, 'close').mockImplementation(async () => { open = false; return true; });
    spyOn(Bank, 'depositAllMatching').mockImplementation(async predicate => {
        bank.push(...pack.filter(i => predicate(i.name ?? '', i.id)));
        pack = pack.filter(i => !predicate(i.name ?? '', i.id));
    });
    spyOn(Bank, 'withdraw').mockReturnValue(false);
    spyOn(Bank, 'withdrawX').mockResolvedValue(false);
    spyOn(ClueExecutor, 'solveHeldClue').mockResolvedValue('yield');
    spyOn(Loadouts, 'all').mockReturnValue([]);
    bot = new ArdyFighter();
    bot.bindLog(() => {});
    bot.settings = new SettingsBag({ loadout: 'Melee' });
});

afterEach(() => { bot.disposeSubscriptions(); mock.restore(); Sustain.set(null); ClueExecutor.resetSession(); });

test.each(['loadout', 'equipped'])('clue banking keeps the %s weapon when it is in the backpack', async source => {
    if (source === 'loadout') {
        spyOn(Loadouts, 'all').mockReturnValue([{ name: 'Melee', worn: { righthand: 'Rune scimitar' }, carry: [] }]);
    } else {
        worn = [{ ...weapon, slot: 3 }];
    }
    await bot.onStart();
    worn = [];
    pack.push(weapon);
    const clue = bot['tasks'].find((task): task is SolveClue => task instanceof SolveClue);
    expect(clue).toBeDefined();

    await clue!.execute();
    await clue!.execute();

    expect(pack.some(i => i.id === 1333)).toBe(true);
    expect(bank.some(i => i.id === 1333)).toBe(false);
    expect(bank.some(i => i.id === 561)).toBe(true);
});
