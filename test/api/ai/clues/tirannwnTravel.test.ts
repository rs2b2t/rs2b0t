import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import * as Jungle from '#/bot/api/ai/quests/defs/legends/jungle.js';
import { LQ_TILE } from '#/bot/api/ai/quests/defs/legends/areas.js';
import { inKharazi } from '#/bot/api/ai/clues/kharaziTravel.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { InvItem } from '#/bot/api/inventory/Inventory.js';
import { GuardianProtection } from '#/bot/api/ai/clues/guardianKit.js';
import { GuardianEncounter } from '#/bot/api/ai/clues/Guardian.js';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
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


for (const dest of [new Tile(2181, 3206, 0), new Tile(2209, 3161, 0), RG_TILE.IORWERTH]) {
    test.each([true, false])(`leaves Kharazi before routing to Isafdar ${dest.x},${dest.z}, teleports=%s`, enabled => {
        return crossFromJungle(dest, enabled);
    });
}

async function crossFromJungle(dest: Tile, enabled: boolean): Promise<void> {
    here = new Tile(2950, 2902, 0);
    ClueExecutor.setTeleports(enabled);
    let exits = 0;
    spyOn(Jungle, 'leaveJungle').mockImplementation(async () => { exits++; here = LQ_TILE.JUNGLE_MOUTH; return true; });
    spyOn(Traversal, 'walkResilient').mockImplementation(async (tile, opts) => {
        if (inKharazi(here)) return false;
        here = new Tile(tile.x, tile.z, tile.level);
        walks.push({ tile: here, opts });
        return true;
    });
    expect(await walkAcrossTirannwn(dest, 0, log, trailWalkOpts(log, 0))).toBe(true);
    expect(exits).toBe(1);
    expect(here).toEqual(dest);
    expect(walks[0].opts.policy?.useTeleports).toBe(enabled);
}

test('a failed jungle exit stops before attempting the Arandar approach', async () => {
    here = new Tile(2950, 2902, 0);
    spyOn(Jungle, 'leaveJungle').mockResolvedValue(false);
    expect(await walkAcrossTirannwn(new Tile(2181, 3206, 0), 0, log, trailWalkOpts(log))).toBe(false);
    expect(walks).toEqual([]);
    expect(here).toEqual(new Tile(2950, 2902, 0));
});

test.each([true, false])('Isafdar to Kharazi crosses both boundaries in order, teleports=%s', async enabled => {
    here = new Tile(2181, 3206, 0);
    ClueExecutor.setTeleports(enabled);
    let entries = 0;
    let entered = false;
    spyOn(Jungle, 'enterJungle').mockImplementation(async () => {
        expect(here).toEqual(LQ_TILE.JUNGLE_MOUTH);
        entries++;
        entered = true;
        here = LQ_TILE.JUNGLE_INSIDE;
        return true;
    });
    spyOn(Traversal, 'walkResilient').mockImplementation(async (tile, opts) => {
        if (inKharazi(tile) && !entered) return false;
        here = new Tile(tile.x, tile.z, tile.level);
        walks.push({ tile: here, opts });
        return true;
    });
    const dest = new Tile(2950, 2902, 0);
    expect(await walkAcrossTirannwn(dest, 0, log, trailWalkOpts(log, 0))).toBe(true);
    expect(entries).toBe(1);
    expect(here).toEqual(dest);
    expect(walks.find(w => w.tile.x === 2816 && w.tile.z === 2940)?.opts.policy?.useTeleports).toBe(enabled);
});

test('a failed jungle entry prevents a direct walk through the uncut band', async () => {
    here = RG_TILE.IORWERTH;
    spyOn(Jungle, 'enterJungle').mockResolvedValue(false);
    expect(await walkAcrossTirannwn(new Tile(2950, 2902, 0), 0, log, trailWalkOpts(log))).toBe(false);
    expect(here).toEqual(LQ_TILE.JUNGLE_MOUTH);
});


test('the same running executor finishes Kharazi then the reported Isafdar dig without abandoning', async () => {
    here = new Tile(2950, 2902, 0);
    const item = (id: number, name: string, count = 1): InvItemSnapshot => ({ id, name, count, slot: 0, comId: 1, ops: ['Dig'] });
    let pack = [item(3536, 'Clue scroll'), item(952, 'Spade'), item(2574, 'Sextant'), item(2575, 'Watch'),
        item(2576, 'Chart'), item(2448, 'Superantipoison(4)'), item(385, 'Shark', 12), item(975, 'Machete'), item(1351, 'Bronze axe')];
    let pending = false;
    let digs = 0;
    let fights = 0;
    let exits = 0;
    const logs: string[] = [];
    spyOn(reader, 'inventory').mockImplementation(() => pack);
    spyOn(reader, 'equipment').mockReturnValue([{ ...item(1305, 'Dragon longsword'), slot: 3 }]);
    spyOn(Skills, 'level').mockReturnValue(70);
    spyOn(EventSignal, 'pending').mockImplementation(() => pending);
    spyOn(ChatDialog, 'isOpen').mockReturnValue(false);
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(GuardianProtection.prototype, 'prepare').mockResolvedValue(true);
    spyOn(GuardianEncounter.prototype, 'fight').mockImplementation(async () => {
        fights++;
        here = new Tile(here.x + 3, here.z, 0);
        return 'killed';
    });
    spyOn(Jungle, 'leaveJungle').mockImplementation(async () => { exits++; here = LQ_TILE.JUNGLE_MOUTH; return true; });
    spyOn(Traversal, 'walkResilient').mockImplementation(async tile => {
        if (inKharazi(here) !== inKharazi(tile)) return false;
        here = new Tile(tile.x, tile.z, tile.level);
        return true;
    });
    spyOn(InvItem.prototype, 'interact').mockImplementation(function (this: InvItem, action) {
        if (this.id !== 952 || action !== 'Dig') return false;
        const isafdar = digs >= 2;
        expect(here).toEqual(isafdar ? new Tile(2181, 3206, 0) : new Tile(2950, 2902, 0));
        digs++;
        if (digs === 2) pack = pack.map(i => i.id === 3536 ? { ...i, id: 3562 } : i);
        if (digs === 4) {
            pack = pack.map(i => i.id === 3562 ? { ...i, id: 2677 } : i);
            pending = true;
        }
        return true;
    });
    expect(await ClueExecutor.solveHeldClue(m => logs.push(m))).toBe('yield');
    expect(digs).toBe(4);
    expect(fights).toBe(2);
    expect(exits).toBe(1);
    expect(pack.some(i => i.id === 2677)).toBe(true);
    expect(logs.some(line => /abandon|resetting/.test(line))).toBe(false);
});
