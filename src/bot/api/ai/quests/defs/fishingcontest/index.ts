// docs/QUESTS.md
import { customStep, waitForJournal, waitStep } from '../../engine/questSteps.js';
import { QUESTS } from '../../data/quests.js';
import { bankedId, heldId, type QuestModule, type QuestSnapshot, type QuestStep } from '../../engine/types.js';
import { FC_ID, inCompound } from './areas.js';
import {
    claimSpareTrophy,
    deliverTrophy,
    fishAtPipes,
    handOverCatch,
    leaveCompound,
    payEntryFee,
    startQuest,
    stashGarlic
} from './contest.js';
import { FC_STAGE, readFishingContestStage } from './journal.js';
import { ITEM, sourceFee, sourceGarlic, sourcePass, sourceRod, sourceSpade, sourceWorms, WORM_TARGET } from './supplies.js';

// Why: Outbound crossing opens dialogue that the generic door handler cannot continue.

/** Any leg that leaves Hemenster has to go through the gate first. */
function outside(snap: QuestSnapshot, step: QuestStep | null): QuestStep | null {
    if (step === null || !inCompound(snap.tile)) {
        return step;
    }
    return customStep('leave the competition ground', leaveCompound);
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'unknown') {
        return waitForJournal();
    }
    if (snap.journal === 'complete') {
        return { kind: 'done' };
    }
    const stage = snap.stage;
    if (stage === undefined) {
        return waitStep('Fishing Contest journal stage unavailable');
    }

    switch (stage) {
        // Why: the garlic is in Draynor and the spade in Falador, both on the road to the tunnel, so fetching them after the pass is the same walk twice.
        case FC_STAGE.NOT_STARTED:
            return sourceGarlic(snap)
                ?? sourceSpade(snap)
                ?? customStep('ask the Mountain Dwarf for the competition pass', startQuest);

        case FC_STAGE.STARTED:
            return outside(snap, sourcePass(snap)
                ?? sourceGarlic(snap)
                ?? sourceRod(snap)
                ?? sourceWorms(snap, WORM_TARGET)
                ?? sourceFee(snap))
                ?? customStep('pay Bonzo the contest entry fee', payEntryFee);

        // Why: the willow spot yields sardines whatever the bait, so this stage never fishes; it stashes the garlic or unwinds a round that already did.
        case FC_STAGE.IN_COMP:
            if (heldId(snap, FC_ID.GARLIC) > 0) {
                return customStep('stash the garlic in the wall pipe', stashGarlic);
            }
            if (heldId(snap, FC_ID.RAW_SARDINE) > 0) {
                return customStep('hand the sardines to Bonzo and re-enter', handOverCatch);
            }
            return outside(snap, sourcePass(snap) ?? sourceGarlic(snap))
                ?? waitStep('the willow spot cannot win and there is no garlic to move the stranger');

        // Why: the pass is checked here too; a death or teleport out of the fence leaves a paid-up contest Morris won't let the bot back into.
        case FC_STAGE.GARLIC_COMP:
            return outside(snap, sourcePass(snap) ?? sourceRod(snap) ?? sourceWorms(snap, 1))
                ?? customStep('fish the contest beside the pipes', fishAtPipes);

        case FC_STAGE.WON_COMP: {
            if (heldId(snap, FC_ID.TROPHY) > 0) {
                return customStep('take the trophy to the Mountain Dwarf', deliverTrophy);
            }
            const banked: QuestStep | null = bankedId(snap, FC_ID.TROPHY) > 0
                ? { kind: 'withdraw', items: [{ name: ITEM.TROPHY, qty: 1, id: FC_ID.TROPHY }] }
                : null;
            return outside(snap, banked ?? sourcePass(snap))
                ?? customStep('ask Bonzo for a spare trophy', claimSpareTrophy);
        }

        default:
            return waitStep(`no leg for Fishing Contest stage ${stage}`);
    }
}

export const fishingcontest: QuestModule = {
    record: QUESTS.find(r => r.id === 'fishingcompo')!,
    // Why: the quest runs from Draynor to Kandarin, so no one booth is near more than a leg of it.
    bank: 'nearest',
    food: 8,
    tools: ['fishing pass', 'garlic', 'fishing rod', 'spade', 'red vine worm', 'fishing trophy', 'raw giant carp', 'coins'],
    // Literals; this object is built at import, when QuestFood.name still holds its default.
    sustain: { foods: ['Lobster', 'Swordfish', 'Tuna'], eatBelowHp: 0.5 },
    readStage: readFishingContestStage,
    warnReadiness: () =>
        'Fishing Contest walks over White Wolf Mountain — its level 64 and 73 wolves stay aggressive below 146 combat',
    decide
};

export { FC_STAGE };
