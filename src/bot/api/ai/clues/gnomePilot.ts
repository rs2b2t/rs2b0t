import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Npcs } from '#/bot/api/npcs/Npcs.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { talkThrough } from '#/bot/api/ai/quests/exec/primitives.js';
import Tile from '#/bot/geometry/Tile.js';
import { SHARK_ID } from './hardClueKit.js';
import { PuzzleBox } from './PuzzleBox.js';
import { TALK_ANCHORS } from './data/talkAnchors.js';

export const PILOT_REFUGE = new Tile(2852, 3500, 0);
export const PILOT_APPROACH = new Tile(2846, 3500, 0);
const PUZZLE_ID = 3571;
type PilotWalk = (tile: Tile) => Promise<boolean>;

async function shelter(walk: PilotWalk, log: (m: string) => void): Promise<boolean> {
    log('moving behind the glider to lose wolf aggro');
    if (!(await walk(PILOT_REFUGE))) return false;
    let quiet = 0;
    for (let tick = 0; tick < 20; tick++) {
        await Sustain.run();
        if (EventSignal.pending() || Skills.effective('hitpoints') <= 0) return false;
        quiet = Game.inCombat() ? 0 : quiet + 1;
        if (quiet >= 2) return true;
        await Execution.delayTicks(1);
    }
    log('still in combat behind the glider; keeping the clue for another attempt');
    return false;
}

type PilotResult = 'yield' | 'supplies-needed' | 'dead' | void;

async function runPilot(walk: PilotWalk, log: (m: string) => void): Promise<PilotResult> {
    if (!(await Execution.delayUntilTicks(() => !Game.autoRetaliateOn(), 5)) || EventSignal.pending()) return 'yield';
    if (Skills.effective('hitpoints') <= 0) return 'dead';
    if (Inventory.countById(SHARK_ID) < 4) return 'supplies-needed';
    const puzzle = Inventory.countById(PUZZLE_ID) > 0;
    const here = Game.tile();
    if (puzzle || Game.inCombat() || !here || TALK_ANCHORS[3570].distanceTo(here) > 8) {
        if (!(await shelter(walk, log))) return 'yield';
    }
    if (puzzle && !(await PuzzleBox.solveHeld(PUZZLE_ID, log))) return 'yield';
    if (Skills.effective('hitpoints') <= 0) return 'dead';
    if (EventSignal.pending()) return 'yield';
    if (!ChatDialog.isOpen() && !ChatDialog.canContinue()) {
        if (!(await walk(PILOT_APPROACH)) || EventSignal.pending()) return 'yield';
        if (Skills.effective('hitpoints') <= 0) return 'dead';
        if (Game.inCombat()) {
            await shelter(walk, log);
            return 'yield';
        }
        const pilot = Npcs.query().name('Gnome pilot')
            .where(n => n.tile().distanceTo(TALK_ANCHORS[3570]) <= 4).nearest();
        if (!pilot || !(await pilot.interact('Talk-to'))) return 'yield';
        for (let tick = 0; tick < 5; tick++) {
            await Sustain.run();
            if (Skills.effective('hitpoints') <= 0) return 'dead';
            if (EventSignal.pending()) return 'yield';
            if (Game.inCombat()) {
                await shelter(walk, log);
                return 'yield';
            }
            if (ChatDialog.isOpen() || ChatDialog.canContinue()) break;
            await Execution.delayTicks(1);
        }
    }
    if (ChatDialog.isOpen() || ChatDialog.canContinue()) await talkThrough('Gnome pilot', [], log);
    if (Skills.effective('hitpoints') <= 0) return 'dead';
    if (EventSignal.pending()) return 'yield';
    if (Game.inCombat()) {
        await shelter(walk, log);
        return 'yield';
    }
}

export async function solveMountainPilot(walk: PilotWalk, log: (m: string) => void): Promise<PilotResult> {
    const retaliate = Game.autoRetaliateOn();
    Game.setAutoRetaliate(false);
    try {
        const result = await runPilot(walk, log);
        return Skills.effective('hitpoints') <= 0 ? 'dead' : result;
    } finally {
        Game.setAutoRetaliate(retaliate);
    }
}
