// docs/QUESTS.md
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

// Why: the fence has one gate and crossing it outbound is a conversation, so a bank or shop leg that starts inside walks into a prompt the nav's door handler cannot answer.

/** Any leg that leaves Hemenster has to go through the gate first. */
function outside(snap: QuestSnapshot, step: QuestStep | null): QuestStep | null {
    if (step === null || !inCompound(snap.tile)) {
        return step;
    }
    return { kind: 'custom', name: 'leave the competition ground', run: leaveCompound };
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    if (snap.journal === 'complete') {
        return { kind: 'done' };
    }
    const stage = snap.stage;
    if (stage === undefined) {
        return { kind: 'wait', reason: 'Fishing Contest journal stage unavailable' };
    }

    switch (stage) {
        // Why: the garlic is in Draynor and the spade in Falador, both on the road to the tunnel — fetching them after the dwarf hands the pass over is the same walk twice.
        case FC_STAGE.NOT_STARTED:
            return sourceGarlic(snap)
                ?? sourceSpade(snap)
                ?? { kind: 'custom', name: 'ask the Mountain Dwarf for the competition pass', run: startQuest };

        case FC_STAGE.STARTED:
            return outside(snap, sourcePass(snap)
                ?? sourceGarlic(snap)
                ?? sourceRod(snap)
                ?? sourceWorms(snap, WORM_TARGET)
                ?? sourceFee(snap))
                ?? { kind: 'custom', name: 'pay Bonzo the contest entry fee', run: payEntryFee };

        // Why: the willow spot yields sardines whatever the bait, so this stage never fishes — it stashes the garlic, or unwinds a round that already did.
        case FC_STAGE.IN_COMP:
            if (heldId(snap, FC_ID.GARLIC) > 0) {
                return { kind: 'custom', name: 'stash the garlic in the wall pipe', run: stashGarlic };
            }
            if (heldId(snap, FC_ID.RAW_SARDINE) > 0) {
                return { kind: 'custom', name: 'hand the sardines to Bonzo and re-enter', run: handOverCatch };
            }
            return outside(snap, sourcePass(snap) ?? sourceGarlic(snap))
                ?? { kind: 'wait', reason: 'the willow spot cannot win and there is no garlic to move the stranger' };

        // Why: the pass is checked here too — a death or a teleport out of the fence leaves a paid-up contest that Morris will not let the bot back into.
        case FC_STAGE.GARLIC_COMP:
            return outside(snap, sourcePass(snap) ?? sourceRod(snap) ?? sourceWorms(snap, 1))
                ?? { kind: 'custom', name: 'fish the contest beside the pipes', run: fishAtPipes };

        case FC_STAGE.WON_COMP: {
            if (heldId(snap, FC_ID.TROPHY) > 0) {
                return { kind: 'custom', name: 'take the trophy to the Mountain Dwarf', run: deliverTrophy };
            }
            const banked: QuestStep | null = bankedId(snap, FC_ID.TROPHY) > 0
                ? { kind: 'withdraw', items: [{ name: ITEM.TROPHY, qty: 1, id: FC_ID.TROPHY }] }
                : null;
            return outside(snap, banked ?? sourcePass(snap))
                ?? { kind: 'custom', name: 'ask Bonzo for a spare trophy', run: claimSpareTrophy };
        }

        default:
            return { kind: 'wait', reason: `no leg for Fishing Contest stage ${stage}` };
    }
}

export const fishingcontest: QuestModule = {
    record: QUESTS.find(r => r.id === 'fishingcompo')!,
    // Why: the quest runs from Draynor to Kandarin, so no one booth is near more than a leg of it.
    bank: 'nearest',
    food: 8,
    tools: ['fishing pass', 'garlic', 'fishing rod', 'spade', 'red vine worm', 'fishing trophy', 'raw giant carp', 'coins'],
    // Literals, not QuestFood.name: this object is built at import, when the setting still holds its default.
    sustain: { foods: ['Lobster', 'Swordfish', 'Tuna'], eatBelowHp: 0.5 },
    readStage: readFishingContestStage,
    warnReadiness: () =>
        'Fishing Contest walks over White Wolf Mountain — its level 64 and 73 wolves stay aggressive below 146 combat',
    decide
};

export { FC_STAGE };
