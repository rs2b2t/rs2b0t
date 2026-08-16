import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { driveUntil, settleScene } from '../../exec/prompts.js';
import { BIO_ITEM, BIO_LOC, BIO_NPC, BIO_TILE, inPigeonZone } from './areas.js';
import { heldId } from './gear.js';
import { locById, talkAt, walkTo } from './travel.js';

const START_PREFER = ["I'll try to retrieve it for you."];
const REISSUE_PREFER = ["I'm afraid I've lost some of the stuff that you gave me"];
const LATHAS_PREFER = ["I don't understand"];

export const startQuest = (log: (m: string) => void): Promise<boolean> =>
    talkAt(BIO_NPC.ELENA, BIO_TILE.ELENA, START_PREFER, log);

export const askJerico = (log: (m: string) => void): Promise<boolean> =>
    talkAt(BIO_NPC.JERICO, BIO_TILE.JERICO, [], log);

export const handOverDistillator = (log: (m: string) => void): Promise<boolean> =>
    talkAt(BIO_NPC.ELENA, BIO_TILE.ELENA, [], log);

export const reportToElena = (log: (m: string) => void): Promise<boolean> =>
    talkAt(BIO_NPC.ELENA, BIO_TILE.ELENA, [], log);

// Why: Elena reissues every vial and the sample she still owes, gated on the pack rather than the
// bank, so this is the only recovery for a vial an errand boy drank, sold or painted with.
export const askElenaForReplacements = (log: (m: string) => void): Promise<boolean> =>
    talkAt(BIO_NPC.ELENA, BIO_TILE.ELENA, REISSUE_PREFER, log);

// Why: the second branch closes the dialogue without queueing quest_biohazard_complete.
export const confrontLathas = (log: (m: string) => void): Promise<boolean> =>
    talkAt(BIO_NPC.LATHAS, BIO_TILE.LATHAS, LATHAS_PREFER, log);

/** Open Jerico's cupboard, then search it. It refuses a second bag while one is banked. */
export async function takeBirdfeed(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(BIO_TILE.JERICO_CUPBOARD, 1, log))) {
        return false;
    }
    await settleScene();
    const open = locById(BIO_LOC.JERICO_CUPBOARD_OPEN, 'Search', 6);
    if (open) {
        if (!(await open.interact('Search'))) {
            return false;
        }
        return driveUntil(() => heldId(BIO_ITEM.BIRDFEED.id) > 0, [], log, 10_000);
    }
    const shut = locById(BIO_LOC.JERICO_CUPBOARD_SHUT, 'Open', 6);
    if (!shut || !(await shut.interact('Open'))) {
        log("no cupboard in Jerico's house");
        return false;
    }
    return Execution.delayUntil(() => locById(BIO_LOC.JERICO_CUPBOARD_OPEN, 'Search', 6) !== null, 6000);
}

// Why: `pigeoncage` renders "Pigeon cage" too, so a spent cage dropped here would answer a
// name query and the Take would put an empty one back in the pack.
export async function takePigeons(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(BIO_TILE.PIGEON_SPAWN, 1, log))) {
        return false;
    }
    await settleScene();
    const cage = GroundItems.query().where(item => item.id === BIO_ITEM.PIGEONS.id).within(8).nearest();
    if (!cage) {
        log(`no full Pigeon cage at (${BIO_TILE.PIGEON_SPAWN.x},${BIO_TILE.PIGEON_SPAWN.z}) — waiting for the respawn`);
        await Execution.delayTicks(4);
        return false;
    }
    if (!(await cage.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(BIO_ITEM.PIGEONS.id) > 0, 8000);
}

/** Throw the seed onto the tower. The mourners do not react until the birds follow it. */
export async function feedTheTower(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(BIO_TILE.WATCHTOWER, 1, log))) {
        return false;
    }
    await settleScene();
    const tower = locById(BIO_LOC.WATCHTOWER, null, 8);
    const feed = Inventory.items().find(item => item.id === BIO_ITEM.BIRDFEED.id);
    if (!tower || !feed) {
        log(`no ${tower ? 'Bird feed' : 'Watchtower'} for the distraction`);
        return false;
    }
    if (!(await feed.useOn(tower))) {
        return false;
    }
    if (!(await driveUntil(() => heldId(BIO_ITEM.BIRDFEED.id) === 0, [], log, 15_000))) {
        return false;
    }
    // Why: the script deletes the seed, waits two ticks and only then moves the stage, so returning
    // on the empty slot hands the next decide a journal that still says "fetch bird feed".
    await Execution.delayTicks(4);
    return true;
}

// Why: `opheld1,pigeons` only fires inside 2559..2565 x 3299..3307 — outside it the cage answers
// "The pigeons don't want to leave" and the stage never moves.
export async function releasePigeons(log: (m: string) => void): Promise<boolean> {
    if (!inPigeonZone(Game.tile()) && !(await walkTo(BIO_TILE.WATCHTOWER, 1, log))) {
        return false;
    }
    if (!inPigeonZone(Game.tile())) {
        const here = Game.tile();
        log(`(${here?.x},${here?.z}) is outside the pigeon-release box — the cage would not open`);
        return false;
    }
    const cage = Inventory.items().find(item => item.id === BIO_ITEM.PIGEONS.id);
    if (!cage || !(await cage.interact('Open'))) {
        log('no full Pigeon cage in the pack to open');
        return false;
    }
    return driveUntil(() => heldId(BIO_ITEM.PIGEONS.id) === 0, [], log, 20_000);
}
