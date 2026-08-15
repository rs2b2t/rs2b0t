import { Execution } from '../../../../execution/Execution.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory, type InvItem } from '../../../../inventory/Inventory.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { driveUntil, heldId, promptLoc, type LocPrompt } from '../../exec/prompts.js';
import { MURDER_LOC, MURDER_OBJ, MURDER_TILE, type LocStop, type Suspect } from './areas.js';

const LIFT_MS = 8000;

// Why: `Reach.locOp` walks when the loc is out of scene and reports `retry` without ever clicking it, so a first call from anywhere else in the mansion is the approach and the second is the op.
// Why: one leg here visits four locs, and a step that gives up on the walk restarts the hunt at the first suspect — which never gets past the second.
const LOC_TRIES = 3;

async function reachLoc(step: LocPrompt, log: (m: string) => void): Promise<boolean> {
    for (let i = 0; i < LOC_TRIES; i++) {
        if (await promptLoc(step, log)) {
            return true;
        }
    }
    return false;
}

function liveItem(id: number): InvItem | null {
    return Inventory.items().find(item => item.id === id) ?? null;
}

export function takeThread(log: (m: string) => void): Promise<boolean> {
    return reachLoc({
        name: 'Smashed window',
        op: 'Investigate',
        near: MURDER_TILE.STUDY,
        id: MURDER_LOC.WINDOW,
        within: 6,
        expect: () => heldId(MURDER_OBJ.THREAD_RED) + heldId(MURDER_OBJ.THREAD_GREEN) + heldId(MURDER_OBJ.THREAD_BLUE) > 0
    }, log);
}

async function takeDagger(log: (m: string) => void): Promise<boolean> {
    if (heldId(MURDER_OBJ.DAGGER) > 0 || heldId(MURDER_OBJ.DAGGER_DUST) > 0) {
        return true;
    }
    if (!(await Traversal.walkResilient(MURDER_TILE.STUDY, { radius: 1, attempts: 3, timeoutMs: 90_000, log }))) {
        return false;
    }
    const dagger = GroundItems.query().where(g => g.id === MURDER_OBJ.DAGGER).within(8).nearest();
    if (!dagger) {
        log(`murder: no dagger on the study floor at (${MURDER_TILE.STUDY.x},${MURDER_TILE.STUDY.z})`);
        return false;
    }
    if (!(await dagger.interact('Take'))) {
        return false;
    }
    // Why: the Take is answered with a mesbox, so the wait has to drive the box shut before anything else can act.
    return driveUntil(() => heldId(MURDER_OBJ.DAGGER) > 0, [], log, LIFT_MS);
}

function searchBarrel(barrel: LocStop, silver: number, log: (m: string) => void): Promise<boolean> {
    return reachLoc({
        name: barrel.name,
        op: 'Search',
        near: barrel.near,
        id: barrel.id,
        within: 6,
        expect: () => heldId(silver) > 0
    }, log);
}

// Why: the sacks and the flour barrel each hand over one at a time and each dusting spends one of both, so a trip that takes a single sheet is three walks per suspect rather than one.

/** How many sheets one visit to the sacks is worth. */
const PAPER_STOCK = 3;

async function takeFlypaper(log: (m: string) => void): Promise<boolean> {
    if (heldId(MURDER_OBJ.FLYPAPER) > 0) {
        return true;
    }
    for (let want = 1; want <= PAPER_STOCK; want++) {
        const took = await reachLoc({
            name: 'Sacks',
            op: 'Investigate',
            near: MURDER_TILE.SACKS,
            id: MURDER_LOC.SACKS,
            within: 6,
            prefer: ['Yes, it might be useful'],
            expect: () => heldId(MURDER_OBJ.FLYPAPER) >= want
        }, log);
        if (!took) {
            break;
        }
    }
    return heldId(MURDER_OBJ.FLYPAPER) > 0;
}

async function fillPot(log: (m: string) => void): Promise<boolean> {
    if (heldId(MURDER_OBJ.POT_FLOUR) > 0) {
        return true;
    }
    const empties = heldId(MURDER_OBJ.POT);
    if (empties === 0) {
        log('murder: no empty pot to take flour in');
        return false;
    }
    for (let want = 1; want <= empties; want++) {
        const filled = await reachLoc({
            name: 'Barrel of flour',
            op: 'Take From',
            near: MURDER_TILE.FLOUR_BARREL,
            id: MURDER_LOC.FLOUR_BARREL,
            within: 6,
            expect: () => heldId(MURDER_OBJ.POT_FLOUR) >= want
        }, log);
        if (!filled) {
            break;
        }
    }
    return heldId(MURDER_OBJ.POT_FLOUR) > 0;
}

async function useHeld(itemId: number, targetId: number, expect: () => boolean, log: (m: string) => void): Promise<boolean> {
    const item = liveItem(itemId);
    const target = liveItem(targetId);
    if (!item || !target) {
        log(`murder: cannot use ${itemId} on ${targetId} — one of them is not in the pack`);
        return false;
    }
    if (!(await item.useOn(target))) {
        return false;
    }
    return driveUntil(expect, [], log, LIFT_MS);
}

async function flourOnto(clean: number, dust: number, log: (m: string) => void): Promise<boolean> {
    if (heldId(dust) > 0) {
        return true;
    }
    if (!(await fillPot(log))) {
        return false;
    }
    return useHeld(MURDER_OBJ.POT_FLOUR, clean, () => heldId(dust) > 0, log);
}

async function liftPrint(dust: number, print: number, log: (m: string) => void): Promise<boolean> {
    if (heldId(print) > 0) {
        return true;
    }
    if (!(await takeFlypaper(log))) {
        return false;
    }
    return useHeld(MURDER_OBJ.FLYPAPER, dust, () => heldId(print) > 0, log);
}

// Why: a mismatch destroys the suspect's print, but only once its mesbox is dismissed, so "the print is gone" is not readable until the box has been driven shut.
async function compare(print: number, log: (m: string) => void): Promise<boolean> {
    return useHeld(
        MURDER_OBJ.UNKNOWN_PRINT,
        print,
        () => heldId(MURDER_OBJ.KILLERS_PRINT) > 0 || heldId(print) === 0,
        log
    );
}

async function testSuspect(suspect: Suspect, log: (m: string) => void): Promise<boolean> {
    if (heldId(suspect.print) === 0) {
        if (heldId(suspect.dust) === 0 && !(await searchBarrel(suspect.barrel, suspect.silver, log))) {
            return false;
        }
        if (!(await flourOnto(suspect.silver, suspect.dust, log))) {
            return false;
        }
        if (!(await liftPrint(suspect.dust, suspect.print, log))) {
            return false;
        }
    }
    return compare(suspect.print, log);
}

// Why: the loop cursor is local, so a restart re-tests a suspect it had already cleared — one pot of flour and one sheet of flypaper, against a cleared-set that no client-visible state could hold.

/** Lift the murderer's print off the dagger and match it, suspect by suspect. */
export async function takePrints(order: readonly Suspect[], log: (m: string) => void): Promise<boolean> {
    if (heldId(MURDER_OBJ.KILLERS_PRINT) > 0) {
        return true;
    }
    if (heldId(MURDER_OBJ.UNKNOWN_PRINT) === 0) {
        if (!(await takeDagger(log))) {
            return false;
        }
        if (!(await flourOnto(MURDER_OBJ.DAGGER, MURDER_OBJ.DAGGER_DUST, log))) {
            return false;
        }
        if (!(await liftPrint(MURDER_OBJ.DAGGER_DUST, MURDER_OBJ.UNKNOWN_PRINT, log))) {
            return false;
        }
    }
    for (const suspect of order) {
        if (heldId(MURDER_OBJ.KILLERS_PRINT) > 0) {
            return true;
        }
        log(`murder: taking ${suspect.stop.npc}'s prints`);
        if (!(await testSuspect(suspect, log))) {
            return false;
        }
        await Execution.delayTicks(1);
    }
    return heldId(MURDER_OBJ.KILLERS_PRINT) > 0;
}
