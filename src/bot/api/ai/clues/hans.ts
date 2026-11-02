import { actions } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Npcs } from '#/bot/api/npcs/Npcs.js';
import type { Npc } from '#/bot/api/model/Npc.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { driveDialog } from '#/bot/api/ai/quests/exec/primitives.js';
import { DirectNavigator } from '#/bot/event/webwalk/DirectNavigator.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import Tile from '#/bot/geometry/Tile.js';

export const HANS_WAIT_SPOT = new Tile(3221, 3218, 0);
const PATROL_TICKS = 200;
const CHASE_TICKS = 40;
const CHASE_ENERGY = 50;
const STOP_ENERGY = 20;
type HansWalk = (tile: Tile) => Promise<boolean>;
const dialogueReady = (): boolean => ChatDialog.isOpen() || ChatDialog.canContinue();
const findHans = (): Npc | null => Npcs.query().name('Hans').action('Talk-to').nearest();
const reachable = (npc: Npc): boolean => Reachability.canReach(npc.tile(), { maxSteps: 128, adjacentOk: true });

async function returnToSpot(walk: HansWalk): Promise<boolean> {
    if (EventSignal.pending()) return false;
    if (!(await DirectNavigator.walk(HANS_WAIT_SPOT))) return false;
    return walk(HANS_WAIT_SPOT);
}

async function talk(npc: Npc, clueId: number, chase: boolean, ticks: number, log: (m: string) => void): Promise<boolean> {
    if (!(await npc.interact('Talk-to'))) return false;
    for (let tick = 0; tick < ticks; tick++) {
        await Sustain.run();
        if (EventSignal.pending()) return false;
        if (!Inventory.countById(clueId)) return true;
        if (dialogueReady()) { await driveDialog([], log, 5000); return true; }
        const live = findHans();
        const here = Game.tile();
        if (!live || !here || live.tile().distanceTo(here) > (chase ? 32 : 3)) return false;
        if (chase && (Game.energy() < STOP_ENERGY || !Game.runEnabled())) return false;
        await Execution.delayTicks(1);
    }
    if (EventSignal.pending()) return false;
    if (!Inventory.countById(clueId)) return true;
    if (dialogueReady()) { await driveDialog([], log, 5000); return true; }
    return false;
}

export async function solveHans(clueId: number, walk: HansWalk, log: (m: string) => void): Promise<'yield' | void> {
    if (EventSignal.pending()) return 'yield';
    if (dialogueReady()) { await driveDialog([], log, 5000); return; }
    if (!(await walk(HANS_WAIT_SPOT))) return 'yield';
    log('waiting near the Lumbridge teleport for Hans to finish his patrol');
    const deadline = Game.tick() + PATROL_TICKS;
    for (let tick = 0; tick < PATROL_TICKS && Game.tick() < deadline; tick++) {
        await Sustain.run();
        if (EventSignal.pending()) return 'yield';
        if (!Inventory.countById(clueId)) return;
        if (dialogueReady()) { await driveDialog([], log, 5000); return; }
        const npc = findHans();
        const here = Game.tile();
        if (npc && here && npc.tile().distanceTo(here) <= 1 && reachable(npc)) {
            if (await talk(npc, clueId, false, Math.min(30, deadline - Game.tick()), log)) return;
            if (!(await returnToSpot(walk))) return 'yield';
        }
        await Execution.delayTicks(1);
    }
    if (EventSignal.pending()) return 'yield';
    if (!Inventory.countById(clueId)) return;
    if (dialogueReady()) { await driveDialog([], log, 5000); return; }
    const npc = findHans();
    const here = Game.tile();
    if (!npc || !here || npc.tile().distanceTo(here) > 32 || Game.energy() < CHASE_ENERGY || !reachable(npc)) return 'yield';
    if (!Game.runEnabled()) {
        if (!actions.setRun(true)) return 'yield';
        await Execution.delayUntilTicks(() => Game.runEnabled() || EventSignal.pending() || dialogueReady(), 5);
    }
    if (EventSignal.pending()) return 'yield';
    if (dialogueReady()) { await driveDialog([], log, 5000); return; }
    if (!Game.runEnabled() || Game.energy() < CHASE_ENERGY) return 'yield';
    log('run energy is high enough; trying a short chase to catch Hans');
    const live = findHans();
    if (live && live.tile().distanceTo(Game.tile() ?? here) <= 32 && reachable(live) && await talk(live, clueId, true, CHASE_TICKS, log)) return;
    await returnToSpot(walk);
    return 'yield';
}
