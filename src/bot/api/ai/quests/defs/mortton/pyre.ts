import { Execution } from '../../../../execution/Execution.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs, type Loc } from '../../../../locs/Locs.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { settleScene, useOnLoc } from '../../exec/prompts.js';
import { SM_ID, SM_LOC, SM_LOC_ID, SM_TILE } from './areas.js';
import { sacredOilDoses } from './temple.js';

const PYRE_RADIUS = 10;
/** Normal logs need two doses of sacred oil. */
export const DOSES_PER_PYRE_LOG = 2;

const pyreOfType = (id: number): Loc | null =>
    Locs.query().where(l => l.id === id).within(PYRE_RADIUS).nearest();

export const emptyPyre = (): Loc | null => pyreOfType(SM_LOC_ID.PYRE_EMPTY);
export const loadedPyre = (): Loc | null => pyreOfType(SM_LOC_ID.PYRE_LOGS);
export const bodiedPyre = (): Loc | null => pyreOfType(SM_LOC_ID.PYRE_BONES);

/** Pour sacred oil over a log to make a pyre log. */
export async function makePyreLogs(log: (m: string) => void): Promise<boolean> {
    if (sacredOilDoses() < DOSES_PER_PYRE_LOG) {
        log(`only ${sacredOilDoses()} dose(s) of sacred oil — a pyre log wants ${DOSES_PER_PYRE_LOG}`);
        return false;
    }
    const oil = [SM_ID.SACRED_OIL4, SM_ID.SACRED_OIL3, SM_ID.SACRED_OIL2]
        .map(id => Inventory.items().find(i => i.id === id))
        .find(item => item !== undefined);
    const logs = Inventory.items().find(i => i.id === SM_ID.LOGS);
    if (!oil || !logs) {
        log('no sacred oil vial or no logs in the pack');
        return false;
    }
    const before = Inventory.countById(SM_ID.PYRE_LOGS);
    if (!(await oil.useOn(logs))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.countById(SM_ID.PYRE_LOGS) > before, 10_000);
}

async function atPyres(log: (m: string) => void): Promise<boolean> {
    if (emptyPyre() ?? loadedPyre() ?? bodiedPyre()) {
        return true;
    }
    if (!(await Traversal.walkResilient(SM_TILE.PYRE, { radius: 3, attempts: 3, timeoutMs: 240_000, log }))) {
        return false;
    }
    await settleScene();
    return true;
}

// Why: `%pyre_loc` binds the funeral to the one loc the logs went on, and every later step reads "This funeral pyre is not yours." off any other, so each stage targets the loc type our own pyre is in.

/** Stack the pyre logs on a funeral pyre. */
export async function stackPyre(log: (m: string) => void): Promise<boolean> {
    if (loadedPyre() ?? bodiedPyre()) {
        return true;
    }
    if (!(await atPyres(log))) {
        return false;
    }
    return useOnLoc(
        SM_ID.PYRE_LOGS,
        { name: SM_LOC.PYRE, near: SM_TILE.PYRE, id: SM_LOC_ID.PYRE_EMPTY, within: PYRE_RADIUS },
        [],
        () => loadedPyre() !== null,
        log
    );
}

/** Lay the shade's remains on the stacked logs. */
export async function layRemains(log: (m: string) => void): Promise<boolean> {
    if (bodiedPyre()) {
        return true;
    }
    if (!(await atPyres(log))) {
        return false;
    }
    return useOnLoc(
        SM_ID.REMAINS,
        { name: SM_LOC.PYRE, near: SM_TILE.PYRE, id: SM_LOC_ID.PYRE_LOGS, within: PYRE_RADIUS },
        [],
        () => bodiedPyre() !== null,
        log
    );
}

/** Set the cremation alight. */
export async function lightPyre(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(SM_ID.TINDERBOX) === 0) {
        log('no tinderbox in the pack — the pyre cannot be lit');
        return false;
    }
    if (!(await atPyres(log))) {
        return false;
    }
    const pyre = bodiedPyre();
    if (!pyre) {
        log('no loaded funeral pyre in reach');
        return false;
    }
    if (!(await pyre.interact('Light'))) {
        return false;
    }
    // The pyre reverts to its empty type once the reward queue has run.
    const burned = await Execution.delayUntil(() => bodiedPyre() === null, 90_000);
    await Modals.closeIfOpen();
    if (!burned) {
        log('the funeral pyre never caught');
    }
    return burned;
}
