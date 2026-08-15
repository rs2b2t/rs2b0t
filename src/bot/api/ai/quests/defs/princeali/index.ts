// docs/reference/quest-engine.md#quest-state
import { QUESTS } from '../../data/quests.js';
import { gotoNpc, talkStrict } from '../../exec/primitives.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { HASSAN_REWARD, HASSAN_START, LEELA_STOP, OSMAN_BRIEF, PA_TILE } from './areas.js';
import {
    disguiseComplete,
    makeAshes,
    makeBlondWig,
    makePaste,
    sourceOnions,
    sourcePasteGoods,
    sourcePinkSkirt,
    sourceShears,
    sourceTinderbox,
    sourceWool
} from './disguise.js';
import { decideJailbreak, sourceBeers, sourceRopes } from './jailbreak.js';
import { PRINCE_STAGE, readPrinceProgress } from './journal.js';
import {
    collectKey,
    haveKey,
    makeSoftClay,
    sourceBronzeBar,
    sourceClay,
    sourcePickaxe,
    sourceWater,
    takeKeyPrint
} from './key.js';
import { PURSE_FLOOR, PURSE_TOP, scanBank, sourceCoins } from './supplies.js';

type Leg = (snap: QuestSnapshot) => QuestStep | null;

// Why: read top to bottom this is the route — Al-Kharid, Lumbridge, Varrock, Rimmington and Port Sarim, Draynor, Lady Keli, Osman.
// Why: each leg returns null once it is satisfied, so a resumed run rejoins the tour wherever it left off.
const PREP: readonly Leg[] = [
    sourceBronzeBar,
    sourceWater,
    sourceTinderbox,
    sourceShears,
    sourceOnions,
    sourceWool,
    sourcePinkSkirt,
    sourcePickaxe,
    sourceClay,
    sourcePasteGoods,
    sourceBeers,
    makeAshes,
    makeBlondWig,
    makePaste,
    sourceRopes,
    makeSoftClay,
    takeKeyPrint,
    collectKey
];

function prepLeg(snap: QuestSnapshot): QuestStep | null {
    for (const leg of PREP) {
        const step = leg(snap);
        if (step) {
            return step;
        }
    }
    return null;
}

async function leelaHandover(log: (m: string) => void): Promise<boolean> {
    if (!(await gotoNpc(LEELA_STOP, [], log))) {
        return false;
    }
    return talkStrict(LEELA_STOP.npc, LEELA_STOP.prefer, log);
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    if (snap.journal === 'complete' || (snap.stage ?? -1) >= PRINCE_STAGE.COMPLETE) {
        return { kind: 'done' };
    }
    const stage = snap.stage;
    if (stage === undefined) {
        return { kind: 'wait', reason: 'Prince Ali Rescue journal stage unavailable' };
    }

    if (!snap.bankKnown) {
        return scanBank();
    }
    // Why: Al-Kharid is reachable only through the 10gp toll gate or the Shantay Pass, and the walker pre-avoids a crossing it cannot pay for.
    // Why: Hassan and Osman are both behind it, so the purse comes before the first step that walks anywhere.
    // Why: completing the quest makes the gate free, hence the stage bound.
    if (stage < PRINCE_STAGE.SAVED) {
        const purse = sourceCoins(snap, PURSE_FLOOR, PURSE_TOP);
        if (purse) {
            return purse;
        }
    }

    switch (stage) {
        case PRINCE_STAGE.NOT_STARTED:
            return { kind: 'talk', stop: HASSAN_START };

        case PRINCE_STAGE.STARTED:
            return { kind: 'talk', stop: OSMAN_BRIEF };

        case PRINCE_STAGE.SPOKEN_OSMAN: {
            const prep = prepLeg(snap);
            if (prep) {
                return prep;
            }
            if (!haveKey(snap) || !disguiseComplete(snap)) {
                return { kind: 'wait', reason: 'every prep leg is satisfied but the disguise or key is not in the pack' };
            }
            return { kind: 'custom', name: 'show Leela the disguise and collect the key', run: leelaHandover };
        }

        // Dying here drops the non-tradeable quest items, so the prep legs run at these
        // stages too rather than parking on a disguise that can be rebuilt.
        case PRINCE_STAGE.PREP_FINISHED:
        case PRINCE_STAGE.GUARD_DRUNK:
        case PRINCE_STAGE.TIED_KELI:
            return prepLeg(snap) ?? decideJailbreak(snap);

        case PRINCE_STAGE.SAVED:
            return { kind: 'talk', stop: HASSAN_REWARD };

        default:
            return { kind: 'wait', reason: `Prince Ali Rescue stage ${stage} is not implemented` };
    }
}

export const princeali: QuestModule = {
    record: QUESTS.find(record => record.id === 'prince')!,
    bank: PA_TILE.DRAYNOR_BANK,
    ownsInventory: true,
    readProgress: readPrinceProgress,
    decide
};
