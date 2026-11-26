import { customStep, decideJournalStage, talkTo as talk } from '../../engine/questSteps.js';
import { questRecord } from '../../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { EC_ID, EC_STAGE, EC_TILE, ODDENSTEIN, VERONICA } from './areas.js';
import { basementRegion, fetchOilCan, inAlcove, leaveManorBasement } from './basement.js';
import { fetchPressureGauge, fetchRubberTube, inCloset, leaveCloset } from './items.js';
import { readErnestProgress } from './journal.js';
import { heldId, kit } from './supplies.js';

// Why: the tube, oil can and basement are all inside the manor, so only the gauge leg goes outside: one exit and one re-entry.

/** The next of tube, oil can, gauge that is still outstanding. */
function parts(snap: QuestSnapshot): QuestStep {
    if (heldId(snap, EC_ID.RUBBER_TUBE) === 0) {
        return customStep('fetch the rubber tube', fetchRubberTube);
    }
    if (heldId(snap, EC_ID.OIL_CAN) === 0) {
        return customStep('fetch the oil can', fetchOilCan);
    }
    if (heldId(snap, EC_ID.PRESSURE_GAUGE) === 0) {
        return customStep('fetch the pressure gauge', fetchPressureGauge);
    }
    return talk(ODDENSTEIN);
}

export function decide(snap: QuestSnapshot): QuestStep {
    return decideJournalStage(snap, decideStage);
}

function decideStage(snap: QuestSnapshot, stage: number): QuestStep {
    // Why: the 3 sealed pockets are only reachable by scripted teleport, and a leg that starts inside one burns its budget failing to walk out.
    // Why: runs ahead of the bank trip, which is itself a walk.
    if (inCloset(snap.tile)) {
        return customStep('leave the closet', leaveCloset);
    }
    // Escape only after obtaining the can; `fetchOilCan` controls basement movement until then.
    if (heldId(snap, EC_ID.OIL_CAN) > 0 && (inAlcove(snap.tile) || basementRegion(snap.tile) !== 'outside')) {
        return customStep('leave the manor basement', leaveManorBasement);
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
    record: questRecord('haunted'),
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
