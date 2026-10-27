import * as primitives from '#/bot/api/ai/quests/exec/primitives.js';
import { Npc } from '#/bot/api/model/Npc.js';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'fflate';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { PILOT_APPROACH, PILOT_REFUGE } from '#/bot/api/ai/clues/gnomePilot.js';
import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { ClueExecutor } from '#/bot/api/ai/clues/ClueExecutor.js';
import { PuzzleBox } from '#/bot/api/ai/clues/PuzzleBox.js';
import { Game } from '#/bot/api/game/Game.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Reach } from '#/bot/api/walking/Reach.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import Tile from '#/bot/geometry/Tile.js';

const refuge = new Tile(2852, 3500, 0);
let here: Tile;
let combat: boolean;
let pending: boolean;
let pack: InvItemSnapshot[];
let walked: Tile[];
let retaliation: boolean;
const item = (id: number): InvItemSnapshot => ({ id, name: 'Item', count: 1, slot: 0, comId: 3214, ops: [] });

beforeEach(() => {
    here = new Tile(2847, 3499, 0); combat = true; pending = false; walked = []; retaliation = true;
    pack = [item(3570), item(3571), ...Array.from({ length: 12 }, () => ({ ...item(385), name: 'Shark' }))];
    ClueExecutor.resetSession(); Sustain.set(null);
    spyOn(reader, 'inventory').mockImplementation(() => pack);
    spyOn(reader, 'inventorySize').mockReturnValue(28);
    spyOn(reader, 'worldTile').mockImplementation(() => here);
    spyOn(Game, 'tile').mockImplementation(() => here);
    spyOn(Game, 'inCombat').mockImplementation(() => combat);
    spyOn(Game, 'autoRetaliateOn').mockImplementation(() => retaliation);
    spyOn(Game, 'setAutoRetaliate').mockImplementation(on => { retaliation = on; return true; });
    spyOn(Skills, 'effective').mockReturnValue(60);
    spyOn(EventSignal, 'pending').mockImplementation(() => pending);
    spyOn(ChatDialog, 'isOpen').mockReturnValue(false);
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async predicate => predicate());
    spyOn(Execution, 'delayTicks').mockResolvedValue();
    spyOn(Traversal, 'walkResilient').mockImplementation(async dest => {
        walked.push(Tile.from(dest)); here = Tile.from(dest); combat = false; return true;
    });
    spyOn(Reach, 'npcDialog').mockImplementation(async () => { pending = true; return 'retry'; });
});
afterEach(() => { mock.restore(); Sustain.set(null); ClueExecutor.resetSession(); });

test('leaves wolf combat before opening the pilot puzzle', async () => {
    const atPuzzle: Tile[] = [];
    let fightingAtPuzzle = true;
    spyOn(PuzzleBox, 'solveHeld').mockImplementation(async () => {
        atPuzzle.push(here); fightingAtPuzzle = combat; pending = true; return false;
    });
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');
    expect(atPuzzle).toEqual([refuge]);
    expect(fightingAtPuzzle).toBe(false);
    expect(retaliation).toBe(true);
});

test('a failed retreat preserves the clue without opening its puzzle', async () => {
    spyOn(Traversal, 'walkResilient').mockResolvedValue(false);
    const puzzle = spyOn(PuzzleBox, 'solveHeld').mockImplementation(async () => { pending = true; return false; });
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');
    expect(puzzle).not.toHaveBeenCalled();
    expect(pack.some(i => i.id === 3570)).toBe(true);
    expect(retaliation).toBe(true);
});

test('an event during retreat prevents puzzle and dialogue input', async () => {
    spyOn(Traversal, 'walkResilient').mockImplementation(async () => { pending = true; return false; });
    const puzzle = spyOn(PuzzleBox, 'solveHeld').mockImplementation(async () => { pending = true; return false; });
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');
    expect(puzzle).not.toHaveBeenCalled();
    expect(Reach.npcDialog).not.toHaveBeenCalled();
});

test('persistent wolf combat keeps the puzzle closed and the clue retryable', async () => {
    spyOn(Game, 'inCombat').mockReturnValue(true);
    const puzzle = spyOn(PuzzleBox, 'solveHeld').mockResolvedValue(true);
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');
    expect(puzzle).not.toHaveBeenCalled();
    expect(walked).toEqual([refuge]);
});

test('unsafe food reserves request a restock before the pilot approach', async () => {
    pack = [item(3570), item(3571), { ...item(385), name: 'Shark' }];
    const puzzle = spyOn(PuzzleBox, 'solveHeld').mockResolvedValue(true);
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('supplies-needed');
    expect(puzzle).not.toHaveBeenCalled();
    expect(walked).toEqual([]);
});

test('retaliation stays off when it was already disabled', async () => {
    retaliation = false;
    spyOn(PuzzleBox, 'solveHeld').mockImplementation(async () => { pending = true; return false; });
    await ClueExecutor.solveHeldClue(() => {});
    expect(retaliation).toBe(false);
});

test('death during retreat stops the trail instead of retrying the pilot', async () => {
    spyOn(Traversal, 'walkResilient').mockImplementation(async () => {
        spyOn(Skills, 'effective').mockReturnValue(0);
        return false;
    });
    const puzzle = spyOn(PuzzleBox, 'solveHeld').mockResolvedValue(true);
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('dead');
    expect(puzzle).not.toHaveBeenCalled();
});

test.skipIf(!existsSync('out/collision.lcnav.gz'))('the pilot approach is walkable and reachable from the sheltered pocket', () => {
    const finder = new PathFinder(gunzipSync(new Uint8Array(readFileSync('out/collision.lcnav.gz'))));
    expect(finder.walkable(PILOT_APPROACH.x, PILOT_APPROACH.z, PILOT_APPROACH.level)).toBe(true);
    const path = finder.findPath(PILOT_REFUGE, PILOT_APPROACH);
    expect(path.ok).toBe(true);
    if (path.ok) expect(path.waypoints.at(-1)).toMatchObject(PILOT_APPROACH);
});

test.each([false, true])('pilot handoff stops correctly (death during dialogue: %s)', async dead => {
    let dialog = false;
    spyOn(ChatDialog, 'isOpen').mockImplementation(() => dialog);
    spyOn(reader, 'npcs').mockReturnValue([{ index: 1, id: 170, name: 'Gnome pilot',
        tile: { x: 2847, z: 3499, level: 0 }, anim: -1, level: 0, size: 1,
        ops: ['Talk-to'], distance: 1, inCombat: false, health: 0, totalHealth: 0, faceEntity: -1 }]);
    spyOn(PuzzleBox, 'solveHeld').mockImplementation(async () => { expect(here).toEqual(refuge); return true; });
    spyOn(Npc.prototype, 'interact').mockImplementation(() => { dialog = true; return true; });
    const handoff = spyOn(primitives, 'talkThrough').mockImplementation(async () => {
        if (dead) { spyOn(Skills, 'effective').mockReturnValue(0); combat = true; }
        else pending = true;
        return true;
    });
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe(dead ? 'dead' : 'yield');
    expect(walked).toEqual([refuge, PILOT_APPROACH]);
    expect(handoff).toHaveBeenCalledWith('Gnome pilot', [], expect.any(Function));
});

test('new aggro on the pilot approach retreats without starting a conversation', async () => {
    spyOn(PuzzleBox, 'solveHeld').mockResolvedValue(true);
    spyOn(Traversal, 'walkResilient').mockImplementation(async dest => {
        walked.push(Tile.from(dest)); here = Tile.from(dest);
        combat = here.equals(PILOT_APPROACH);
        return true;
    });
    const talk = spyOn(Npc.prototype, 'interact').mockReturnValue(true);
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');
    expect(walked).toEqual([refuge, PILOT_APPROACH, refuge]);
    expect(talk).not.toHaveBeenCalled();
});

test('noted Sharks do not count as food for the pilot trip', async () => {
    pack = [item(3570), { ...item(386), name: 'Shark', noted: true, count: 12 }];
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('supplies-needed');
    expect(walked).toEqual([]);
});

test('death during a puzzle stops before returning to the pilot', async () => {
    spyOn(PuzzleBox, 'solveHeld').mockImplementation(async () => {
        spyOn(Skills, 'effective').mockReturnValue(0);
        return true;
    });
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('dead');
    expect(walked).toEqual([refuge]);
});
