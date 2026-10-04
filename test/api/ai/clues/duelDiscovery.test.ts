import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { actions, reader, type PlayerSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { SettingsBag, SettingsStore } from '#/bot/runtime/Settings.js';
import { Game } from '#/bot/api/game/Game.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Duel } from '#/bot/api/duel/Duel.js';
import { ClueExecutor } from '#/bot/api/ai/clues/ClueExecutor.js';
import { DUEL_CLUE_TILE, walkAcrossClueDuel } from '#/bot/api/ai/clues/duelTravel.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';

const lobby = { x: 3368, z: 3274, level: 0 };
const player = (name: string, index: number, distance: number, tile = lobby, inCombat = false): PlayerSnapshot =>
    ({ name, index, distance, tile, inCombat, combatLevel: 100, faceEntity: -1 });

function fixture() {
    const s = { tile: lobby, now: 1000, active: false, confirm: false, partner: '', options: 0, stake: false,
        players: [player('Nearby duelist', 2, 2)], challenges: [] as string[], accepts: 0, cancelled: 0, toggles: [] as number[],
        ignore: new Set<string>(), unsafe: new Set<string>(), event: false };
    spyOn(Date, 'now').mockImplementation(() => s.now);
    spyOn(Game, 'tile').mockImplementation(() => s.tile);
    spyOn(reader, 'worldTile').mockImplementation(() => s.tile);
    spyOn(reader, 'localPlayerName').mockReturnValue('Solver');
    spyOn(reader, 'players').mockImplementation(() => s.players);
    spyOn(SettingsStore, 'globalBag').mockReturnValue(new SettingsBag({ clueDuelPartner: '' }));
    spyOn(Traversal, 'walkResilient').mockImplementation(async dest => { s.tile = dest; return true; });
    spyOn(EventSignal, 'pending').mockImplementation(() => s.event);
    spyOn(Execution, 'delayTicks').mockImplementation(async n => { s.now += n * 600; });
    spyOn(Execution, 'delayUntil').mockImplementation(async fn => fn());
    spyOn(Sustain, 'run').mockResolvedValue();
    spyOn(Duel, 'active').mockImplementation(() => s.active);
    spyOn(Duel, 'offerOpen').mockImplementation(() => s.active && !s.confirm);
    spyOn(Duel, 'partner').mockImplementation(() => s.partner);
    spyOn(Duel, 'waitingForOther').mockReturnValue(false);
    spyOn(Duel, 'challenge').mockImplementation(p => {
        s.challenges.push(p.name!);
        if (!s.ignore.has(p.name!)) { s.active = true; s.partner = p.name!; s.options = 0; s.stake = s.unsafe.has(p.name!); }
        return true;
    });
    spyOn(reader, 'duelOffers').mockImplementation(() => ({ ready: true, mine: [], theirs: s.stake ? [{ id: 995, name: 'Coins', count: 1, slot: 0, comId: 6670, ops: [] }] : [] }));
    spyOn(reader, 'varp').mockImplementation(() => s.options);
    spyOn(actions, 'ifButton').mockImplementation(id => { s.toggles.push(id); if (id === 6732) s.options ^= 1024; return true; });
    spyOn(Duel, 'accept').mockImplementation(() => {
        s.accepts++;
        if (s.confirm) { s.tile = { x: 3368, z: 3250, level: 0 }; s.active = false; }
        else s.confirm = true;
        return true;
    });
    spyOn(Duel, 'cancel').mockImplementation(async () => { s.cancelled++; s.active = false; return true; });
    return s;
}
afterEach(() => { mock.restore(); ClueExecutor.resetSession(); });

test('without a helper, challenges a lobby player, enables obstacles and completes both unstaked screens', async () => {
    const s = fixture();
    expect(await walkAcrossClueDuel(DUEL_CLUE_TILE, 0, () => {})).toBe(true);
    expect(s.challenges).toEqual(['Nearby duelist']);
    expect(s.toggles).toEqual([6732]);
    expect(s.accepts).toBe(2);
    expect(s.tile).toEqual(DUEL_CLUE_TILE);
});

test('automatic discovery excludes self, busy players, arena fighters and players outside the lobby', async () => {
    const s = fixture();
    s.players.unshift(player('Solver', 0, 0), player('Busy', 1, 1, lobby, true),
        player('Fighter', 3, 1, { x: 3370, z: 3250, level: 0 }), player('Outside', 4, 1, { x: 3300, z: 3274, level: 0 }));
    expect(await walkAcrossClueDuel(DUEL_CLUE_TILE, 0, () => {})).toBe(true);
    expect(s.challenges).toEqual(['Nearby duelist']);
});

test('an unanswered challenge moves on to another available player', async () => {
    const s = fixture();
    s.ignore.add('Nearby duelist');
    s.players.push(player('Willing duelist', 3, 4));
    expect(await walkAcrossClueDuel(DUEL_CLUE_TILE, 0, () => {})).toBe(true);
    expect(s.challenges).toContain('Willing duelist');
    expect(s.now).toBeGreaterThanOrEqual(31_000);
});

test('a staked offer is cancelled and another player is tried without accepting the stake', async () => {
    const s = fixture();
    s.unsafe.add('Nearby duelist');
    s.players.push(player('Willing duelist', 3, 4));
    expect(await walkAcrossClueDuel(DUEL_CLUE_TILE, 0, () => {})).toBe(true);
    expect(s.cancelled).toBe(1);
    expect(s.accepts).toBe(2);
    expect(s.partner).toBe('Willing duelist');
});

test('an already open unstaked duel with an eligible lobby player can supply the clue entry', async () => {
    const s = fixture();
    s.active = true; s.partner = 'Nearby duelist';
    expect(await walkAcrossClueDuel(DUEL_CLUE_TILE, 0, () => {})).toBe(true);
    expect(s.challenges).toEqual([]);
    expect(s.accepts).toBe(2);
});

test('an empty lobby yields repeatedly without resetting or abandoning the held clue', async () => {
    const s = fixture();
    s.players = [];
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(reader, 'modals').mockReturnValue({ main: -1, side: -1, chat: -1 });
    spyOn(reader, 'inventory').mockReturnValue([
        { id: 3554, name: 'Clue scroll (hard)', count: 1, slot: 0, comId: 3214, ops: ['Read'] },
        ...['Spade', 'Sextant', 'Watch', 'Chart'].map((name, i) => ({ id: 952 + i, name, count: 1, slot: i + 1, comId: 3214, ops: [] }))
    ]);
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    ClueExecutor.resetSession();
    for (let i = 0; i < 3; i++) expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');
    expect(s.challenges).toEqual([]);
    expect(s.tile).toEqual(lobby);
    expect(s.now).toBeGreaterThanOrEqual(181_000);
});

test('unanswered nearby players do not starve a farther willing player', async () => {
    const s = fixture();
    s.ignore.add('Nearby duelist'); s.ignore.add('Second idle player');
    s.players.push(player('Second idle player', 3, 3), player('Willing duelist', 4, 4));
    expect(await walkAcrossClueDuel(DUEL_CLUE_TILE, 0, () => {})).toBe(true);
    expect(s.challenges).toContain('Willing duelist');
    expect(s.partner).toBe('Willing duelist');
});

test('partner search remembers unanswered players across bounded lobby waits', async () => {
    const s = fixture();
    s.players = Array.from({ length: 5 }, (_, i) => player(`Duellist ${i}`, i + 1, i + 1));
    for (let i = 0; i < 4; i++) s.ignore.add(`Duellist ${i}`);
    expect(await walkAcrossClueDuel(DUEL_CLUE_TILE, 0, () => {})).toBe(false);
    expect(await walkAcrossClueDuel(DUEL_CLUE_TILE, 0, () => {})).toBe(true);
    expect(s.partner).toBe('Duellist 4');
});
