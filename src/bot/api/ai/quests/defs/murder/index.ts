// docs/QUESTS.md
import { QUESTS } from '../../data/quests.js';
import { hasFlag, type QuestModule, type QuestSnapshot, type QuestStep } from '../../engine/types.js';
import {
    ARHEIN,
    GUARD_HANDIN,
    GUARD_START,
    MURDER_EVIDENCE,
    MURDER_OBJ,
    MURDER_TILE,
    suspectOrder
} from './areas.js';
import { takePrints, takeThread } from './evidence.js';
import { POISON_PROVED, readMurderProgress } from './journal.js';
import { provePoison } from './poison.js';
import { accused, banked, held, heldThread } from './state.js';

// Why: Arhein's pot is a gold piece and every dusting spends one load of flour, so the pack carries enough to fill the dagger and both thread-matched suspects in one visit to the barrel.
const POT_TARGET = 3;
const POT_GP = 100;

function custom(name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep {
    return { kind: 'custom', name, run };
}

// Why: a barrel, the window and the study floor all refuse while a copy sits in the bank, so anything banked has to come back out before the leg that needs it can run at all.
function reclaim(snap: QuestSnapshot): QuestStep | null {
    const items = MURDER_EVIDENCE
        .filter(obj => held(snap, obj.id) === 0 && banked(snap, obj.id) > 0)
        .map(obj => ({ name: obj.name, id: obj.id, qty: 1 }));
    return items.length === 0 ? null : { kind: 'withdraw', items, bank: MURDER_TILE.BANK };
}

/** The empty pot the flour barrel fills; the nearest stock is Arhein's in Catherby. */
export function sourcePot(snap: QuestSnapshot): QuestStep | null {
    if (held(snap, MURDER_OBJ.POT) > 0 || held(snap, MURDER_OBJ.POT_FLOUR) > 0) {
        return null;
    }
    if (!snap.bankKnown) {
        return { kind: 'scanBank', bank: MURDER_TILE.BANK };
    }
    if (banked(snap, MURDER_OBJ.POT) > 0) {
        return { kind: 'withdraw', items: [{ name: 'Pot', id: MURDER_OBJ.POT, qty: 1 }], bank: MURDER_TILE.BANK };
    }
    return { kind: 'buy', item: 'Pot', qty: POT_TARGET, shop: ARHEIN, estGp: POT_GP };
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    if (snap.journal === 'complete') {
        return { kind: 'done' };
    }
    const progress = snap.progress;
    if (snap.journal !== 'notStarted' && progress === undefined) {
        return { kind: 'wait', reason: 'Murder Mystery journal stage unavailable' };
    }

    const reclaimed = reclaim(snap);
    if (reclaimed) {
        return reclaimed;
    }

    const printed = held(snap, MURDER_OBJ.KILLERS_PRINT) > 0;
    if (!printed) {
        const pot = sourcePot(snap);
        if (pot) {
            return pot;
        }
    }
    if (snap.journal === 'notStarted') {
        return { kind: 'talk', stop: GUARD_START };
    }

    const thread = heldThread(snap);
    if (thread === null) {
        return custom('take the thread from the smashed window', takeThread);
    }
    if (!printed) {
        const order = suspectOrder(thread);
        return custom("match the murderer's fingerprints", log => takePrints(order, log));
    }
    if (!hasFlag(progress, POISON_PROVED)) {
        const named = accused(snap, thread);
        const order = named ? [named] : suspectOrder(thread);
        return custom('prove the family lied about the poison', log => provePoison(order, log));
    }
    return { kind: 'talk', stop: GUARD_HANDIN };
}

export const murder: QuestModule = {
    record: QUESTS.find(r => r.id === 'murder')!,
    bank: MURDER_TILE.BANK,
    food: 4,
    tools: ['pot', 'criminals', 'silver', 'flypaper', 'print', 'thread'],
    readProgress: readMurderProgress,
    decide
};
