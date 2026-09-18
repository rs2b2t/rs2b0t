import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { SettingsStore, SettingsBag } from '#/bot/runtime/Settings.js';
import { Game } from '#/bot/api/game/Game.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Duel } from '#/bot/api/duel/Duel.js';
import { ClueDuelHandshake } from '#/bot/api/duel/ClueDuel.js';
import { ClueExecutor } from '#/bot/api/ai/clues/ClueExecutor.js';
import { InvItem } from '#/bot/api/inventory/Inventory.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Loc } from '#/bot/api/locs/Locs.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { crossesClueDuel, DUEL_CLUE_TILE, walkAcrossClueDuel } from '#/bot/api/ai/clues/duelTravel.js';

const lobby = { x: 3368, z: 3274, level: 0 };
const wrong = { x: 3340, z: 3230, level: 0 };
afterEach(() => mock.restore());
function fixture(start = lobby) {
    const state = { tile: start, walks: [] as { x: number; z: number }[], challenges: 0, forfeits: 0, cancelled: 0 };
    spyOn(Game, 'tile').mockImplementation(() => state.tile);
    spyOn(SettingsStore, 'globalBag').mockReturnValue(new SettingsBag({ clueDuelPartner: 'Helper' }));
    spyOn(reader, 'localPlayerName').mockReturnValue('Solver');
    spyOn(reader, 'locs').mockReturnValue([{ id: 3203, name: 'Trapdoor', ops: ['Forfeit'], tile: wrong, distance: 1 }] as never);
    spyOn(Loc.prototype, 'interact').mockImplementation(async () => { state.forfeits++; return true; });
    spyOn(ChatDialog, 'options').mockReturnValue(['Yes', 'No']);
    spyOn(ChatDialog, 'chooseOption').mockImplementation(async () => { state.tile = lobby; return true; });
    spyOn(Execution, 'delayUntil').mockImplementation(async condition => condition());
    spyOn(Execution, 'delayTicks').mockResolvedValue();
    spyOn(EventSignal, 'pending').mockReturnValue(false);
    spyOn(Duel, 'active').mockReturnValue(true);
    spyOn(Duel, 'cancel').mockImplementation(async () => { state.cancelled++; return true; });
    spyOn(Traversal, 'walkResilient').mockImplementation(async tile => { state.walks.push(tile); state.tile = tile; return true; });
    spyOn(ClueDuelHandshake.prototype, 'tick').mockImplementation(async () => { state.challenges++; state.tile = DUEL_CLUE_TILE; return true; });
    return state;
}

test('a restarted solver already in the target arena walks directly to the dig', async () => {
    const state = fixture({ x: 3368, z: 3250, level: 0 });
    expect(await walkAcrossClueDuel(DUEL_CLUE_TILE, 0, () => {})).toBe(true);
    expect(state.challenges).toBe(0);
    expect(state.forfeits).toBe(0);
    expect(state.walks).toEqual([DUEL_CLUE_TILE]);
});

test('entering from the lobby completes the named handshake before walking to the dig', async () => {
    const state = fixture();
    expect(await walkAcrossClueDuel(DUEL_CLUE_TILE, 0, () => {})).toBe(true);
    expect(state.challenges).toBe(1);
    expect(state.walks).toEqual([lobby, DUEL_CLUE_TILE]);
});

test('wrong arena assignment forfeits and stops after two attempts', async () => {
    const state = fixture();
    spyOn(ClueDuelHandshake.prototype, 'tick').mockImplementation(async () => { state.challenges++; state.tile = wrong; return true; });
    expect(await walkAcrossClueDuel(DUEL_CLUE_TILE, 0, () => {})).toBe(false);
    expect(state.challenges).toBe(2);
    expect(state.forfeits).toBe(2);
    expect(state.tile).toEqual(lobby);
    expect(state.walks).not.toContainEqual(DUEL_CLUE_TILE);
});

test('leaving the arena forfeits before walking back to the bank', async () => {
    const state = fixture(DUEL_CLUE_TILE);
    const bank = { x: 3382, z: 3269, level: 0 };
    expect(crossesClueDuel(bank)).toBe(true);
    expect(await walkAcrossClueDuel(bank, 3, () => {})).toBe(true);
    expect(state.forfeits).toBe(1);
    expect(state.walks).toEqual([bank]);
});

test('an event interruption cancels the negotiation before yielding', async () => {
    const state = fixture();
    spyOn(EventSignal, 'pending').mockReturnValue(true);
    expect(await walkAcrossClueDuel(DUEL_CLUE_TILE, 0, () => {})).toBe(false);
    expect(state.cancelled).toBe(1);
    expect(state.challenges).toBe(0);
});

test('a missing named helper never enters negotiation', async () => {
    const state = fixture();
    spyOn(SettingsStore, 'globalBag').mockReturnValue(new SettingsBag({ clueDuelPartner: '' }));
    expect(await walkAcrossClueDuel(DUEL_CLUE_TILE, 0, () => {})).toBe(false);
    expect(state.challenges).toBe(0);
    expect(state.walks).toEqual([]);
});


test('a casket obtained in the duel is opened only after forfeiting', async () => {
    const state = fixture(DUEL_CLUE_TILE);
    let held = true;
    let opened = false;
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(reader, 'inventory').mockImplementation(() => held ? [{ id: 3555, name: 'Casket (hard)', count: 1, slot: 0, comId: 3214, ops: ['Open'] }] : []);
    spyOn(reader, 'modals').mockReturnValue({ main: -1, side: -1, chat: -1 });
    spyOn(reader, 'worldTile').mockImplementation(() => state.tile);
    spyOn(reader, 'groundItems').mockReturnValue([]);
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(Sustain, 'run').mockResolvedValue();
    spyOn(InvItem.prototype, 'interact').mockImplementation(async action => {
        expect(action).toBe('Open');
        expect(state.forfeits).toBe(1);
        expect(state.tile).toEqual(lobby);
        held = false;
        opened = true;
        return true;
    });
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('done');
    expect(opened).toBe(true);
});
