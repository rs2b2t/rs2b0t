import { QUESTS } from '../../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { EC_ID, EC_STAGE, EC_TILE, ODDENSTEIN, VERONICA } from './areas.js';
import { basementRegion, fetchOilCan, inAlcove, leaveManorBasement } from './basement.js';
import { fetchPressureGauge, fetchRubberTube, inCloset, leaveCloset } from './items.js';
import { readErnestProgress } from './journal.js';
import { heldId, kit } from './supplies.js';

const talk = (stop: typeof VERONICA): QuestStep => ({ kind: 'talk', stop });

// Why: the tube, oil can and basement are all inside the manor, so only the gauge leg goes outside: one exit and one re-entry.

/** The next of tube, oil can, gauge that is still outstanding. */
function parts(snap: QuestSnapshot): QuestStep {
    if (heldId(snap, EC_ID.RUBBER_TUBE) === 0) {
        return { kind: 'custom', name: 'fetch the rubber tube', run: fetchRubberTube };
    }
    if (heldId(snap, EC_ID.OIL_CAN) === 0) {
        return { kind: 'custom', name: 'fetch the oil can', run: fetchOilCan };
    }
    if (heldId(snap, EC_ID.PRESSURE_GAUGE) === 0) {
        return { kind: 'custom', name: 'fetch the pressure gauge', run: fetchPressureGauge };
    }
    return talk(ODDENSTEIN);
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    if (snap.journal === 'complete') {
        return { kind: 'done' };
    }
    const stage = snap.progress?.stage ?? snap.stage;
    if (stage === undefined) {
        return { kind: 'wait', reason: 'quest stage not readable' };
    }
    // Why: the 3 sealed pockets are only reachable by scripted teleport, and a leg that starts inside one burns its budget failing to walk out.
    // Why: runs ahead of the bank trip, which is itself a walk.
    if (inCloset(snap.tile)) {
        return { kind: 'custom', name: 'leave the closet', run: leaveCloset };
    }
    // Escape only after obtaining the can; `fetchOilCan` controls basement movement until then.
    if (heldId(snap, EC_ID.OIL_CAN) > 0 && (inAlcove(snap.tile) || basementRegion(snap.tile) !== 'outside')) {
        return { kind: 'custom', name: 'leave the manor basement', run: leaveManorBasement };
    }
    const supplies = kit(snap);
    if (supplies) {
        return supplies;
    }
    switch (stage) {
        case EC_STAGE.NOT_STARTED:
            return talk(VERONICA);
        case EC_STAGE.STARTED:
            return talk(ODDENSTEIN);
        case EC_STAGE.SPOKEN_ODDENSTEIN:
            return parts(snap);
        default:
            return { kind: 'done' };
    }
}

export const ernest: QuestModule = {
    record: QUESTS.find(r => r.id === 'haunted')!,
    bank: EC_TILE.DRAYNOR_BANK,
    // Why: the record lists the 3 parts as acquirable, and the engine would call a gather fn, skipping decide(), while any is missing, fetching the oil can before Veronica is spoken to.
    // Why: ownsInventory hands the loop to decide(), and kit() takes over the spade and food the engine no longer withdraws.
    ownsInventory: true,
    tools: [
        'spade', 'poison', 'fish food', 'poisoned fish food', 'key',
        'rubber tube', 'oil can', 'pressure gauge', 'coins'
    ],
    // Literals: this object is built at import, when QuestFood.name still holds its default. The host merges the configured food in.
    sustain: { foods: ['Lobster', 'Swordfish', 'Tuna'], eatBelowHp: 0.5 },
    readProgress: readErnestProgress,
    decide
};
