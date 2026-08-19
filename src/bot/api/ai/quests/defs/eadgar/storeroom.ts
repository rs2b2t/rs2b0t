import { Execution } from '../../../../execution/Execution.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { promptLoc, settleScene } from '../../exec/prompts.js';
import { ER_ITEM, ER_LOC, ER_TILE } from './areas.js';

const heldId = (id: number): number => Inventory.countById(id);

/** Open the kitchen drawers, then search the fake bottom for the Storeroom key. */
export async function takeStoreroomKey(log: (m: string) => void): Promise<boolean> {
    if (heldId(ER_ITEM.STOREROOM_KEY.id) > 0) {
        return true;
    }
    if (!(await Traversal.walkResilient(ER_TILE.KITCHEN_DRAWERS, { radius: 2, attempts: 3, timeoutMs: 240_000, log }))) {
        return false;
    }
    await settleScene();
    const shut = Locs.query().where(loc => loc.id === ER_LOC.KITCHEN_DRAWERS).action('Open').within(6).nearest();
    if (shut) {
        if (!(await shut.interact('Open'))) {
            return false;
        }
        await Execution.delayUntil(
            () => Locs.query().where(loc => loc.id === ER_LOC.KITCHEN_DRAWERS_OPEN).within(6).nearest() !== null,
            8000
        );
    }
    return promptLoc(
        {
            name: 'Kitchen Drawers',
            op: 'Search',
            near: ER_TILE.KITCHEN_DRAWERS,
            id: ER_LOC.KITCHEN_DRAWERS_OPEN,
            within: 6,
            expect: () => heldId(ER_ITEM.STOREROOM_KEY.id) > 0
        },
        log
    );
}

// Why: the door reads the key out of the pack, so a spent key is the only client-visible proof the
// unlock landed — the stage varp itself is not transmitted.

/** Unlock the Storeroom Door from the corridor south of it. */
export async function unlockStoreroom(log: (m: string) => void): Promise<boolean> {
    if (heldId(ER_ITEM.STOREROOM_KEY.id) === 0) {
        log('no Storeroom key in the pack');
        return false;
    }
    if (!(await Traversal.walkResilient(ER_TILE.STOREROOM_DOOR_OUT, { radius: 1, attempts: 3, timeoutMs: 240_000, log }))) {
        return false;
    }
    await settleScene();
    return promptLoc(
        {
            name: 'Storeroom Door',
            op: 'Open',
            near: ER_TILE.STOREROOM_DOOR_OUT,
            id: ER_LOC.STOREROOM_DOOR,
            within: 4,
            expect: () => heldId(ER_ITEM.STOREROOM_KEY.id) === 0
        },
        log
    );
}

// Why: eight guards patrol the crate maze and each knock costs up to six hitpoints and a teleport
// back to the antechamber, so the walk in is expected to fail several times before it lands.

/** Search the Goutweed Crate, riding out the patrol knockouts. */
export async function takeGoutweed(log: (m: string) => void): Promise<boolean> {
    for (let attempt = 0; attempt < 12; attempt++) {
        if (heldId(ER_ITEM.GOUTWEED.id) > 0) {
            return true;
        }
        const got = await promptLoc(
            {
                name: 'Goutweed Crate',
                op: 'Search',
                near: ER_TILE.GOUTWEED_CRATE,
                id: ER_LOC.GOUTWEED_CRATE,
                within: 6,
                expect: () => heldId(ER_ITEM.GOUTWEED.id) > 0
            },
            log
        );
        if (got) {
            return true;
        }
        log(`knocked back from the goutweed crate (attempt ${attempt + 1}/12)`);
        await Execution.delayTicks(3);
    }
    return false;
}

/** Take the parrot back out from under the torture rack. */
export function retrieveParrot(log: (m: string) => void): Promise<boolean> {
    return promptLoc(
        {
            name: 'Rack',
            op: 'Search',
            near: ER_TILE.RACK,
            id: ER_LOC.RACK,
            within: 6,
            expect: () => heldId(ER_ITEM.DRUNK_PARROT.id) > 0
        },
        log
    );
}
