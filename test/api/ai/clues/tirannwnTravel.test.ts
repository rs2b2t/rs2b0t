import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { ClueExecutor, trailWalkOpts } from '#/bot/api/ai/clues/ClueExecutor.js';
import { walkToBank } from '#/bot/api/ai/clues/SolveClue.js';
import { walkAcrossTirannwn } from '#/bot/api/ai/clues/tirannwnTravel.js';
import { REGICIDE_SEAMS } from '#/bot/api/ai/quests/defs/regicide/seams.js';
import { ARDOUGNE, pocketAt } from '#/bot/api/ai/quests/defs/regicide/pockets.js';
import { RG_TILE } from '#/bot/api/ai/quests/defs/regicide/areas.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Game } from '#/bot/api/game/Game.js';
import { Loc } from '#/bot/api/model/Loc.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Traversal, type WalkResilientOptions } from '#/bot/api/walking/Traversal.js';
import Tile from '#/bot/geometry/Tile.js';

let here: Tile;
let walks: { tile: Tile; opts: WalkResilientOptions }[];
const log = (): void => {};

beforeEach(() => {
    ClueExecutor.resetSession();
    ClueExecutor.setTeleports(true);
    here = new Tile(3168, 3041, 0);
    walks = [];
    spyOn(Game, 'tile').mockImplementation(() => here);
    spyOn(reader, 'worldTile').mockImplementation(() => here);
    spyOn(Quests, 'status').mockReturnValue('complete');
    spyOn(Sustain, 'run').mockResolvedValue();
    spyOn(Execution, 'delayTicks').mockResolvedValue();
    spyOn(Execution, 'delayUntil').mockImplementation(async fn => fn());
    spyOn(Traversal, 'walkResilient').mockImplementation(async (dest, opts) => {
        here = new Tile(dest.x, dest.z, dest.level);
        walks.push({ tile: here, opts });
        return true;
    });
    spyOn(reader, 'locs').mockImplementation(() => REGICIDE_SEAMS.map(s => ({
        id: s.locId, name: s.loc, typecode: 0, ops: [s.op], tile: { x: s.x, z: s.z, level: 0 },
        distance: here.distanceTo(new Tile(s.x, s.z, 0))
    })));
    spyOn(Loc.prototype, 'interact').mockImplementation(function (this: Loc) {
        const seam = REGICIDE_SEAMS.find(s => s.locId === this.id && s.x === this.tile().x && s.z === this.tile().z)!;
        const to = seam.sides.find(s => s.pocket !== (pocketAt(here) ?? ARDOUGNE))!;
        here = new Tile(to.stand.x, to.stand.z, 0);
        return true;
    });
});
afterEach(() => { mock.restore(); ClueExecutor.resetSession(); ClueExecutor.setTeleports(true); });

test.each([true, false])('desert to Iorwerth preserves teleport setting %s on the mainland only', async enabled => {
    ClueExecutor.setTeleports(enabled);
    expect(await walkAcrossTirannwn(RG_TILE.IORWERTH, 3, log, trailWalkOpts(log))).toBe(true);
    expect(walks[0].tile).toEqual(new Tile(2384, 3335, 0));
    expect(walks[0].opts.useTeleportCatalog).toBe(enabled);
    expect(walks[0].opts.policy?.useTeleports).toBe(enabled);
    expect(walks.length).toBeGreaterThan(2);
    for (const walk of walks.slice(1)) expect(walk.opts.policy?.useTeleports).toBe(false);
    expect(here).toEqual(RG_TILE.IORWERTH);
});

test('leaving Iorwerth for a mainland bank enables teleports after the last crossing', async () => {
    here = RG_TILE.IORWERTH;
    expect(await walkToBank(RG_TILE.ARDOUGNE_BANK, log)).toBe(true);
    expect(walks.at(-1)?.opts.policy?.useTeleports).toBe(true);
    for (const walk of walks.slice(0, -1)) expect(walk.opts.policy?.useTeleports).toBe(false);
    expect(here).toEqual(RG_TILE.ARDOUGNE_BANK);
});

test.each([true, false])('the Iorwerth clue dispatch preserves teleport setting %s', async enabled => {
    ClueExecutor.setTeleports(enabled);
    spyOn(EventSignal, 'pending').mockReturnValue(false);
    spyOn(ChatDialog, 'isOpen').mockReturnValue(false);
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(reader, 'inventory').mockReturnValue([{ id: 3564, name: 'Clue scroll', count: 1, slot: 0, comId: 3214, ops: ['Read'] }]);
    const stop = new Error('approach observed');
    spyOn(Traversal, 'walkResilient').mockImplementation(async (dest, opts) => {
        walks.push({ tile: new Tile(dest.x, dest.z, dest.level), opts });
        throw stop;
    });
    await expect(ClueExecutor.solveHeldClue(log)).rejects.toBe(stop);
    expect(walks[0].tile).toEqual(new Tile(2384, 3335, 0));
    expect(walks[0].opts.policy?.useTeleports).toBe(enabled);
});
