// docs/QUESTS.md
import { DirectNavigator } from '../../../../../event/webwalk/DirectNavigator.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs, type Loc } from '../../../../locs/Locs.js';
import { Npcs, talkOp, type Npc } from '../../../../npcs/Npcs.js';
import { Prayer, PROTECT_FROM_MAGIC } from '../../../../prayer/Prayer.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Traversal } from '../../../../walking/Traversal.js';
import type Tile from '../../../../../geometry/Tile.js';
import { driveDialog } from '../../exec/primitives.js';
import { driveUntil, heldId, settleScene } from '../../exec/prompts.js';
import { JAILER_NPC, SC_ID, SC_TILE, VELRAK } from './areas.js';

const WALK_MS = 300_000;
const KILL_MS = 90_000;
const DOOR_MS = 8000;

function locById(id: number, within = 6): Loc | null {
    return Locs.query().where(l => l.id === id).within(within).nearest();
}

function here(): { x: number; z: number; level: number } | null {
    return Game.tile();
}

async function walkTo(dest: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    const at = here();
    if (at && at.level === dest.level && dest.distanceTo(at) <= radius) {
        return true;
    }
    return Traversal.walkResilient(dest, { radius, attempts: 3, timeoutMs: WALK_MS, log });
}

// Why: the jail key lies on the floor for 100 ticks and nothing else in the corridor drops one, so a slow pickup means killing the Jailer again.

async function takeJailKey(log: (m: string) => void): Promise<boolean> {
    const drop = GroundItems.query().where(g => g.id === SC_ID.JAIL_KEY).within(12).nearest();
    if (!drop) {
        return false;
    }
    if (drop.distance() > 1 && !(await Traversal.walkResilient(drop.tile(), { radius: 1, attempts: 2, timeoutMs: 30_000, log }))) {
        return false;
    }
    const again = GroundItems.query().where(g => g.id === SC_ID.JAIL_KEY).within(12).nearest();
    if (!again || !(await again.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(SC_ID.JAIL_KEY) > 0, DOOR_MS);
}

async function killJailer(log: (m: string) => void): Promise<boolean> {
    const jailer = Npcs.query().name(JAILER_NPC).action('Attack').within(14).nearest();
    if (!jailer) {
        log(`scorpcatcher: no ${JAILER_NPC} in the prison corridor at (${SC_TILE.JAIL_DOOR.x},${SC_TILE.JAIL_DOOR.z})`);
        return false;
    }
    const index = jailer.index;
    const live = (): Npc | null => Npcs.all().find(npc => npc.index === index && npc.name === JAILER_NPC) ?? null;
    if (!(await jailer.interact('Attack'))) {
        return false;
    }
    log(`scorpcatcher: fighting the ${JAILER_NPC} for the jail key`);
    const deadline = performance.now() + KILL_MS;
    while (performance.now() < deadline) {
        await Sustain.run();
        if (heldId(SC_ID.JAIL_KEY) > 0) {
            return true;
        }
        if (!live()) {
            return takeJailKey(log);
        }
        await Execution.delayTicks(1);
    }
    log(`scorpcatcher: the ${JAILER_NPC} outlived ${KILL_MS / 1000}s of combat`);
    return false;
}

// Why: `unlock_taverley_jaildoor` takes the key on the way in only — the way out is the plain Open op — so the cell is left by op and entered by use.

async function unlockWithKey(keyId: number, locId: number, expect: () => boolean, what: string, log: (m: string) => void): Promise<boolean> {
    if (expect()) {
        return true;
    }
    await settleScene();
    const door = locById(locId, 5);
    const key = Inventory.items().find(item => item.id === keyId);
    if (!door || !key) {
        log(`scorpcatcher: no ${what} in reach or no key ${keyId} to unlock it with`);
        return false;
    }
    if (!(await key.useOn(door))) {
        return false;
    }
    return driveUntil(expect, [], log, DOOR_MS);
}

async function openLoc(locId: number, op: string, expect: () => boolean, what: string, log: (m: string) => void): Promise<boolean> {
    if (expect()) {
        return true;
    }
    await settleScene();
    const loc = locById(locId, 5);
    if (!loc || !(await loc.interact(op))) {
        log(`scorpcatcher: no ${what} to ${op.toLowerCase()} here`);
        return false;
    }
    return driveUntil(expect, [], log, DOOR_MS);
}

function inCell(): boolean {
    const at = here();
    return at !== null && at.level === 0 && at.z <= SC_TILE.JAIL_CELL.z && at.x >= 2928 && at.x <= 2934 && at.z >= 9683;
}

// Why: Velrak has no `wanderrange`, so he drifts five tiles around a cell whose walls make that a walk rather than a step, and the shared talk primitive answers an out-of-reach NPC by opening the door in front of it — which here is the cell door, and walks the run back out.

/** Talk to Velrak without leaving the cell: scene steps only, and no door is opened on the way. */
async function talkInCell(log: (m: string) => void): Promise<boolean> {
    await settleScene();
    const find = (): Npc | null => Npcs.query().name(VELRAK.npc).where(npc => talkOp(npc.actions()) !== null).nearest();
    let velrak = find();
    if (!velrak) {
        log(`scorpcatcher: no ${VELRAK.npc} in the cell`);
        return false;
    }
    if (velrak.distance() > 1) {
        await DirectNavigator.walkTo(velrak.tile(), 1, 20_000);
        velrak = find();
    }
    const op = velrak && talkOp(velrak.actions());
    if (!velrak || !op || !(await velrak.interact(op))) {
        log(`scorpcatcher: ${VELRAK.npc} refused the talk`);
        return false;
    }
    if (!(await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), DOOR_MS))) {
        log(`scorpcatcher: ${VELRAK.npc} never opened a dialogue`);
        return false;
    }
    return driveDialog(VELRAK.prefer, log);
}

/** Velrak's cell: kill the Jailer for his key, unlock the door, and take the dusty key off him. */
async function fetchDustyKey(log: (m: string) => void): Promise<boolean> {
    if (heldId(SC_ID.DUSTY_KEY) > 0) {
        return true;
    }
    if (!inCell()) {
        if (!(await walkTo(SC_TILE.JAIL_DOOR, 1, log))) {
            return false;
        }
        if (heldId(SC_ID.JAIL_KEY) === 0 && !(await killJailer(log))) {
            return false;
        }
        if (!(await walkTo(SC_TILE.JAIL_DOOR, 0, log))) {
            return false;
        }
        log('scorpcatcher: unlocking Velrak\'s cell');
        if (!(await unlockWithKey(SC_ID.JAIL_KEY, SC_ID.JAIL_DOOR, inCell, 'cell door', log))) {
            return false;
        }
        await settleScene();
    }
    if (!(await talkInCell(log))) {
        return false;
    }
    const got = await Execution.delayUntil(() => heldId(SC_ID.DUSTY_KEY) > 0, DOOR_MS);
    if (!got) {
        log('scorpcatcher: Velrak handed over no dusty key');
        return false;
    }
    // Why: the cell is a dead end, so the leg has to be back in the corridor before anything else routes from here.
    return openLoc(SC_ID.JAIL_DOOR, 'Open', () => !inCell(), 'cell door', log);
}

// Why: the entrance corridor from the Taverley ladder runs x 2881-2887 up the same z band as the deep half, and only a wall of solid rock at x 2888 separates them — so a plain "west of the gate" box would read the way in as the way through.

/** West of the dusty-key gate: the far half at x ≤ 2880, and the blue dragon cave east of it. */
function inDeepDungeon(): boolean {
    const at = here();
    if (at === null || at.level !== 0 || at.z < 9700) {
        return false;
    }
    return at.x <= 2880 || (at.x >= 2890 && at.x <= SC_TILE.DEEP_DUNGEON.x && at.z <= 9815);
}

// Why: blue dragons hit 30 through the corridor between the gate and the coffins and 50 when they roll through the defence check, which Protect from Magic caps at 10.
// Why: nothing behind the coffin wall breathes, and the catch in there runs for minutes, so the prayer comes down at the wall rather than at the gate.

async function dragonGuard(on: boolean, log: (m: string) => void): Promise<void> {
    if (Prayer.active(PROTECT_FROM_MAGIC) === on) {
        return;
    }
    if (await Prayer.set(PROTECT_FROM_MAGIC, on)) {
        log(`scorpcatcher: Protect from Magic ${on ? 'on for the dragon corridor' : 'off past the coffin wall'}`);
    }
}

/** Through the dusty-key gate into the blue dragon half of Taverley Dungeon. */
export async function enterDeepDungeon(log: (m: string) => void): Promise<boolean> {
    if (inDeepDungeon()) {
        await dragonGuard(!inSecretRoom(), log);
        return true;
    }
    if (!(await fetchDustyKey(log))) {
        return false;
    }
    if (!(await walkTo(SC_TILE.DEEP_GATE, 0, log))) {
        return false;
    }
    await dragonGuard(true, log);
    log('scorpcatcher: unlocking the deep dungeon gate');
    return unlockWithKey(SC_ID.DUSTY_KEY, SC_ID.DEEP_GATE, inDeepDungeon, 'deep dungeon gate', log);
}

// Why: the walker would path back out through this gate on its own, but one refused Open blacklists it for the session, and the way out is then gone.

/** Back through the gate, so the next leg starts on a route the walker owns. */
export async function leaveDeepDungeon(log: (m: string) => void): Promise<boolean> {
    if (!inDeepDungeon()) {
        return true;
    }
    if (!(await walkTo(SC_TILE.DEEP_DUNGEON, 0, log))) {
        return false;
    }
    const out = await openLoc(SC_ID.DEEP_GATE, 'Open', () => !inDeepDungeon(), 'deep dungeon gate', log);
    if (out) {
        await dragonGuard(false, log);
    }
    return out;
}

function inSecretRoom(): boolean {
    const at = here();
    return at !== null && at.level === 0 && at.x >= 2874 && at.x <= 2880 && at.z >= 9793 && at.z <= 9798;
}

// Why: the wall teleports rather than opens, and `check_axis` reads which side we are on, so the same Search works in both directions.

/** Search the old wall by the two coffins, in or out of the secret room. */
export async function crossSecretWall(inward: boolean, log: (m: string) => void): Promise<boolean> {
    if (inSecretRoom() === inward) {
        await dragonGuard(!inward, log);
        return true;
    }
    const stand = inward ? SC_TILE.SECRET_WALL : SC_TILE.SECRET_ROOM;
    if (!(await walkTo(stand, 0, log))) {
        return false;
    }
    // Why: the wall teleports rather than opens, so the corridor is reached in one tick and the prayer has to be up before the Search rather than after it.
    if (!inward) {
        await dragonGuard(true, log);
    }
    log(`scorpcatcher: searching the old wall to get ${inward ? 'into' : 'out of'} the secret room`);
    if (!(await openLoc(SC_ID.SECRET_WALL, 'Search', () => inSecretRoom() === inward, 'old wall', log))) {
        return false;
    }
    await settleScene();
    if (inward) {
        await dragonGuard(false, log);
    }
    return true;
}
