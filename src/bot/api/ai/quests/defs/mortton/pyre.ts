import { Execution } from '../../../../execution/Execution.js';
import { EventSignal } from '../../../../execution/EventSignal.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs, type Loc } from '../../../../locs/Locs.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { settleScene } from '../../exec/prompts.js';
import { Skills } from '../../../../skills/Skills.js';
import type Tile from '../../../../../geometry/Tile.js';
import { SM_ID, SM_LOC_ID, SM_TILE } from './areas.js';
import { sacredOilDoses } from './temple.js';

const PYRE_RADIUS = 10;
/** Normal logs need 2 doses of sacred oil. */
export const DOSES_PER_PYRE_LOG = 2;

const pyreOfType = (id: number): Loc | null =>
    Locs.query().where(l => l.id === id).within(PYRE_RADIUS).nearest();

export const emptyPyre = (): Loc | null => pyreOfType(SM_LOC_ID.PYRE_EMPTY);
let activePyre: { tile: Tile; expires: number } | null = null;

function ownedPyre(): Loc | null {
    if (!activePyre || Date.now() >= activePyre.expires) {
        activePyre = null;
        return null;
    }
    const tile = activePyre.tile;
    const pyre = Locs.query().where(loc => loc.tile().equals(tile)
        && (loc.id === SM_LOC_ID.PYRE_LOGS || loc.id === SM_LOC_ID.PYRE_BONES)).within(PYRE_RADIUS).nearest();
    if (!pyre) activePyre = null;
    return pyre;
}

export const loadedPyre = (): Loc | null => {
    const pyre = ownedPyre();
    return pyre?.id === SM_LOC_ID.PYRE_LOGS ? pyre : null;
};
export const bodiedPyre = (): Loc | null => {
    const pyre = ownedPyre();
    return pyre?.id === SM_LOC_ID.PYRE_BONES ? pyre : null;
};

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

export async function stackPyre(log: (m: string) => void): Promise<boolean> {
    if (ownedPyre()) return true;
    if (!(await atPyres(log))) return false;
    const pyre = emptyPyre();
    const logs = Inventory.items().find(item => item.id === SM_ID.PYRE_LOGS);
    if (!pyre || !logs) {
        log('need an empty funeral pyre and replacement pyre logs');
        return false;
    }
    const before = Inventory.countById(SM_ID.PYRE_LOGS);
    if (!(await logs.useOn(pyre))) return false;
    const stacked = await Execution.delayUntil(() => Inventory.countById(SM_ID.PYRE_LOGS) < before
        && Locs.query().where(loc => loc.id === SM_LOC_ID.PYRE_LOGS && loc.tile().equals(pyre.tile())).nearest() !== null, 8000);
    activePyre = stacked ? { tile: pyre.tile(), expires: Date.now() + 29_400 } : null;
    return stacked;
}

export async function layRemains(log: (m: string) => void): Promise<boolean> {
    if (bodiedPyre()) return true;
    const pyre = loadedPyre();
    const remains = Inventory.items().find(item => item.id === SM_ID.REMAINS);
    if (!pyre || !remains) {
        log('need our stacked funeral pyre and Loar remains');
        return false;
    }
    const before = Inventory.countById(SM_ID.REMAINS);
    if (!(await remains.useOn(pyre))) return false;
    activePyre = { tile: pyre.tile(), expires: Date.now() + 29_400 };
    return Execution.delayUntil(() => Inventory.countById(SM_ID.REMAINS) < before
        && bodiedPyre() !== null, 8000);
}

export async function lightPyre(log: (m: string) => void): Promise<boolean> {
    const pyre = bodiedPyre();
    if (!pyre || Inventory.countById(SM_ID.TINDERBOX) === 0) {
        log('need our funeral pyre with remains and a tinderbox');
        return false;
    }
    const before = Skills.xp('firemaking');
    if (!(await pyre.interact('Light'))) return false;
    const burned = await Execution.delayUntil(() => Skills.xp('firemaking') > before, 35_000);
    await Modals.closeIfOpen();
    if (burned) activePyre = null;
    else log('no cremation experience received; rechecking the pyre and supplies');
    return burned;
}

export async function cremateShade(log: (m: string) => void): Promise<boolean> {
    if (EventSignal.pending()) return false;
    if (Inventory.countById(SM_ID.TINDERBOX) === 0
        || (!bodiedPyre() && Inventory.countById(SM_ID.REMAINS) === 0)) {
        log('prepare a tinderbox and Loar remains before starting the funeral');
        return false;
    }
    return (await stackPyre(log)) && !EventSignal.pending()
        && (await layRemains(log)) && !EventSignal.pending() && lightPyre(log);
}
