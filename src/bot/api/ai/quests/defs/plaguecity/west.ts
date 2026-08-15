import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { DirectNavigator } from '../../../../../event/webwalk/DirectNavigator.js';
import type Tile from '../../../../../geometry/Tile.js';
import { driveChoice, heldId, settleScene } from '../../exec/prompts.js';
import { PC_ITEM, PC_LOC, PC_NPC, PC_TILE } from './areas.js';
import { talkAt } from './east.js';
import { area, goCellar, goUpstairs, locById, walkTo } from './travel.js';

const JETHICK_PREFER = ["I'm looking for a woman from East Ardougne."];
const MOURNER_PREFER = ['I fear not a mere plague.', 'How do I get clearance?'];
const CLERK_PREFER = ['I need permission to enter a plague house.', 'This is urgent though!'];
const BRAVEK_RECIPE_PREFER = ['This is really important though!', 'Do you know what is in the cure?'];
const BRAVEK_WARRANT_PREFER = ["They won't listen to me!"];

async function answerPrompt(prefer: string[], log: (m: string) => void): Promise<boolean> {
    if (!(await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 8000))) {
        return true;
    }
    const answered = await driveChoice(prefer, log);
    await Execution.delayTicks(2);
    return answered;
}

async function openDoor(id: number, near: Tile, prefer: string[], log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(near, 1, log))) {
        return false;
    }
    await settleScene();
    const door = locById(id, 'Open', 6);
    if (!door) {
        log(`no shut door ${id} near (${near.x},${near.z}) — already open`);
        return true;
    }
    if (!(await door.interact('Open'))) {
        return false;
    }
    return answerPrompt(prefer, log);
}

export const showPicture = (log: (m: string) => void): Promise<boolean> =>
    talkAt(PC_NPC.JETHICK, PC_TILE.JETHICK, JETHICK_PREFER, log);

async function returnBook(log: (m: string) => void): Promise<boolean> {
    if (!(await openDoor(PC_LOC.REHNISON_DOOR, PC_TILE.REHNISON_DOOR, [], log))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(PC_ITEM.TURNIP_BOOK.id) === 0, 10_000);
}

export const askParents = (log: (m: string) => void): Promise<boolean> =>
    talkAt(PC_NPC.TED, PC_TILE.REHNISON_TED, [], log);

// Why: the journal renders stages 20 and 21 identically, so one leg covers the book hand-over and the question after it.
// Why: a shut Rehnison door is the only state where the family refuses to talk, which is what sends this back to Jethick.
export async function enterRehnisons(log: (m: string) => void): Promise<boolean> {
    if (heldId(PC_ITEM.TURNIP_BOOK.id) > 0 && !(await returnBook(log))) {
        return false;
    }
    if (await askParents(log)) {
        return true;
    }
    log('the Rehnisons would not talk — asking Jethick for another book');
    return showPicture(log);
}

export async function askMilli(log: (m: string) => void): Promise<boolean> {
    if (!(await goUpstairs(log))) {
        return false;
    }
    return talkAt(PC_NPC.MILLI, PC_TILE.MILLI, [], log);
}

// Why: doors.rs2 gates every branch of this door on `npc_find(coord, mournertwb, 14, 0)`, and with
// no mourner in range the op returns without a message, a door state or a dialogue to wait on.
const MOURNER_EARSHOT = 14;

async function knockPlagueDoor(prefer: string[], log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(PC_TILE.PLAGUE_DOOR, 0, log))) {
        return false;
    }
    await settleScene();
    const heard = await Execution.delayUntil(() => {
        const mourner = Npcs.query().name(PC_NPC.MOURNER).nearest();
        return mourner !== null && mourner.distance() <= MOURNER_EARSHOT;
    }, 30_000);
    if (!heard) {
        log(`no ${PC_NPC.MOURNER} within ${MOURNER_EARSHOT} tiles of the plague house door — the op does nothing without one`);
        return false;
    }
    const door = locById(PC_LOC.PLAGUE_DOOR, 'Open', 6);
    if (!door) {
        return true;
    }
    if (!(await door.interact('Open'))) {
        return false;
    }
    return answerPrompt(prefer, log);
}

export const askAboutClearance = (log: (m: string) => void): Promise<boolean> =>
    knockPlagueDoor(MOURNER_PREFER, log);

// Why: the clerk calls Bravek in only while the player is within 7 tiles of him, and
// Bravek carries no wanderrange, so he drifts the default five tiles around his desk.
const CLERK_LEASH = 7;

async function askClerk(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(PC_TILE.CLERK, 1, log))) {
        return false;
    }
    const near = await Execution.delayUntil(() => {
        const bravek = Npcs.query().name(PC_NPC.BRAVEK).nearest();
        return bravek !== null && bravek.distance() <= CLERK_LEASH;
    }, 30_000);
    if (!near) {
        const here = Game.tile();
        const bravek = Npcs.query().name(PC_NPC.BRAVEK).nearest();
        log(`Bravek is ${bravek?.distance() ?? '?'} tiles from (${here?.x},${here?.z}) — too far for the clerk to call him in`);
        return false;
    }
    return talkAt(PC_NPC.CLERK, PC_TILE.CLERK, CLERK_PREFER, log, 1);
}

function inBravekRoom(): boolean {
    const here = Game.tile();
    return here !== null && here.level === 0
        && here.x >= 2530 && here.x <= 2539 && here.z >= 3312 && here.z <= 3316;
}

// Why: his door reverts two ticks after it lets anyone through, so walking back to the stand from inside would shut it and reopen it every leg.
// Why: it also refuses everyone until the clerk calls him in, and the walker will otherwise spend minutes retrying the crossing.
async function reachBravek(log: (m: string) => void): Promise<boolean> {
    if (inBravekRoom()) {
        return true;
    }
    if (!(await openDoor(PC_LOC.BRAVEK_DOOR, PC_TILE.BRAVEK_DOOR, [], log))) {
        return false;
    }
    if (inBravekRoom()) {
        return true;
    }
    log('Bravek is still busy — the clerk has not called him in yet');
    return false;
}

async function askBravekForRecipe(log: (m: string) => void): Promise<boolean> {
    if (!(await reachBravek(log))) {
        return false;
    }
    return talkAt(PC_NPC.BRAVEK, PC_TILE.BRAVEK, BRAVEK_RECIPE_PREFER, log);
}

export async function giveHangoverCure(log: (m: string) => void): Promise<boolean> {
    if (!(await reachBravek(log))) {
        return false;
    }
    return talkAt(PC_NPC.BRAVEK, PC_TILE.BRAVEK, BRAVEK_WARRANT_PREFER, log);
}

// Why: stages 24 and 25 render the same journal line, and the clerk's stage-25 answer is a single harmless line, so one leg covers both.
export async function getAudience(log: (m: string) => void): Promise<boolean> {
    if (!(await askClerk(log))) {
        return false;
    }
    return askBravekForRecipe(log);
}

// Why: the door is not a baked edge — it opens for a warrant holder mid-conversation, so the last
// tile is a scene step the pathfinder never sees.
async function enterPlagueHouse(log: (m: string) => void): Promise<boolean> {
    if (!(await knockPlagueDoor([], log))) {
        return false;
    }
    await DirectNavigator.walkTo(PC_TILE.PLAGUE_DOOR_INSIDE, 0, 6000);
    if (insidePlagueHouse()) {
        return true;
    }
    log('the mourner did not turn their back — the plague house door stayed shut');
    return false;
}

// Why: the house's north wall steps back a tile east of the door, so a flat box either
// claims the doorstep as inside or the east strip as outside.
function insidePlagueHouse(): boolean {
    const here = Game.tile();
    if (here === null || here.level !== 0 || here.x < 2532 || here.x > 2541) {
        return false;
    }
    return here.z >= 3268 && here.z <= (here.x >= 2535 ? 3272 : 3271);
}

export async function rescueElena(log: (m: string) => void): Promise<boolean> {
    if (area() !== 'cellar' && !insidePlagueHouse() && !(await enterPlagueHouse(log))) {
        return false;
    }
    if (area() !== 'cellar' && heldId(PC_ITEM.ELENA_KEY.id) === 0 && !(await searchBarrel(log))) {
        return false;
    }
    return freeElena(log);
}

async function searchBarrel(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(PC_TILE.BARREL, 1, log))) {
        return false;
    }
    await settleScene();
    const barrel = locById(PC_LOC.BARREL, 'Search', 6);
    if (!barrel || !(await barrel.interact('Search'))) {
        log('no Barrel offering Search on the plague house floor');
        return false;
    }
    return Execution.delayUntil(() => heldId(PC_ITEM.ELENA_KEY.id) > 0, 10_000);
}

async function freeElena(log: (m: string) => void): Promise<boolean> {
    if (!(await goCellar(log))) {
        return false;
    }
    if (!(await walkTo(PC_TILE.ELENA_GATE, 1, log))) {
        return false;
    }
    await settleScene();
    const gate = locById(PC_LOC.ELENA_GATE, 'Open', 6);
    if (gate) {
        const key = Inventory.items().find(item => item.id === PC_ITEM.ELENA_KEY.id);
        if (!key) {
            log("no key for Elena's cell door");
            return false;
        }
        if (!(await key.useOn(gate))) {
            return false;
        }
        await answerPrompt([], log);
    }
    return talkAt(PC_NPC.ELENA, PC_TILE.ELENA, [], log);
}
