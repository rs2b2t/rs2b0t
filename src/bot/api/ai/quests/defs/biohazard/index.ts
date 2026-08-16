import { QUESTS } from '../../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import {
    BIO_ITEM,
    VIALS,
    bioArea,
    held,
    inGuidorQuarter,
    owned,
    worn,
    type BioArea
} from './areas.js';
import { BIO_STAGE, readBiohazardProgress } from './journal.js';
import {
    askElenaForReplacements,
    askJerico,
    confrontLathas,
    feedTheTower,
    handOverDistillator,
    releasePigeons,
    reportToElena,
    startQuest,
    takeBirdfeed,
    takePigeons
} from './ardougne.js';
import {
    HANDBACK_SLOTS,
    ownsAll,
    reclaim,
    scanBank,
    sourceCoins,
    sourceFood,
    tidy
} from './supplies.js';
import { goMainland, goWest } from './travel.js';
import {
    PRIEST_SUIT_GP,
    buyPriestSuit,
    collectFromErrandBoys,
    crossEastGate,
    getTouchPaper,
    handToErrandBoys,
    leaveQuarter,
    visitGuidor
} from './varrock.js';
import { poisonTheStew, searchTheCrate, takeDoctorGown, takeMournerKey, takeRottenApples } from './west.js';

const custom = (name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep =>
    ({ kind: 'custom', name, run });

const TO_MAINLAND = custom('leave for the East Ardougne side', goMainland);
const TO_WEST = custom("cross the wall on Omart's rope ladder", goWest);

/** Slots kept free outside the mourner headquarters, where nothing can be banked. */
const TIDY_FLOOR = 8;

/** How many failed collection passes before the boys are treated as having ruined a vial. */
const COLLECT_GIVE_UP = 2;

const PRIEST_SUIT = [BIO_ITEM.PRIEST_GOWN, BIO_ITEM.PRIEST_ROBE] as const;

function onMainland(area: BioArea, step: QuestStep): QuestStep {
    return area === 'mainland' ? step : TO_MAINLAND;
}

function inWest(area: BioArea, step: QuestStep): QuestStep {
    return area === 'west' || area === 'hq' || area === 'hqUpstairs' ? step : TO_WEST;
}

// Why: the meal and the priest suit's float come out here rather than at the wall — Jerico's house is nine tiles from the Ardougne booth, and the watchtower where the next stage ends is sixty.
/** The distraction leg: seed from Jerico's cupboard, birds from behind his house, then the tower. */
function distractionStep(snap: QuestSnapshot, area: BioArea): QuestStep {
    const kit = sourceFood(snap) ?? sourceCoins(snap, PRIEST_SUIT_GP, false);
    if (kit) {
        return onMainland(area, kit);
    }
    const feed = reclaim(snap, BIO_ITEM.BIRDFEED)
        ?? (held(snap, BIO_ITEM.BIRDFEED) > 0 ? null : custom("take bird feed from Jerico's cupboard", takeBirdfeed));
    if (feed) {
        return onMainland(area, feed);
    }
    const birds = pigeonStep(snap);
    return onMainland(area, birds ?? custom('throw the bird feed onto the watchtower', feedTheTower));
}

function pigeonStep(snap: QuestSnapshot): QuestStep | null {
    if (held(snap, BIO_ITEM.PIGEONS) > 0) {
        return null;
    }
    return reclaim(snap, BIO_ITEM.PIGEONS)
        ?? custom("take a pigeon cage from behind Jerico's house", takePigeons);
}

/** Everything the mourner headquarters leg needs, in the order the building demands it. */
function distillatorStep(snap: QuestSnapshot, area: BioArea): QuestStep {
    if (owned(snap, BIO_ITEM.DOCTOR_GOWN) === 0) {
        return inWest(area, custom("search the nurse's cupboard for a doctors' gown", takeDoctorGown));
    }
    // Why: the cupboard hands nothing over while one is banked, so the banked copy is the only one
    // this stage will ever have — and West Ardougne has no booth to draw it from.
    if (held(snap, BIO_ITEM.DOCTOR_GOWN) === 0 && !worn(snap, BIO_ITEM.DOCTOR_GOWN)) {
        const gown = reclaim(snap, BIO_ITEM.DOCTOR_GOWN);
        return gown ? onMainland(area, gown) : { kind: 'wait', reason: "the doctors' gown is nowhere the bot can reach" };
    }
    if (held(snap, BIO_ITEM.MOURNER_KEY) === 0) {
        const key = reclaim(snap, BIO_ITEM.MOURNER_KEY);
        return key ? onMainland(area, key) : inWest(area, custom('take the key off the sick mourner', takeMournerKey));
    }
    return inWest(area, custom("search the crate for Elena's distillator", searchTheCrate));
}

// Why: Elena hands back three vials and the sample one at a time, each gated on `inv_freespace > 1`,
// so a pack with four slots free silently loses the last of them.
function returnDistillatorStep(snap: QuestSnapshot, area: BioArea): QuestStep {
    if (held(snap, BIO_ITEM.DISTILLATOR) === 0) {
        const banked = reclaim(snap, BIO_ITEM.DISTILLATOR);
        return banked ?? inWest(area, custom("search the crate for Elena's distillator", searchTheCrate));
    }
    return onMainland(area, tidy(snap, HANDBACK_SLOTS) ?? custom('hand Elena her distillator', handOverDistillator));
}

// Why: an errand boy taking a vial and Elena's own vials being lost look identical from the pack,
// so the reissue is never offered here — only the sample, which no errand boy is ever given.

/** Draw whatever Elena already handed over out of the bank, and replace a lost sample. */
function reagentStep(snap: QuestSnapshot, area: BioArea): QuestStep | null {
    for (const item of [...VIALS, BIO_ITEM.PLAGUE_SAMPLE]) {
        const banked = reclaim(snap, item);
        if (banked) {
            return banked;
        }
    }
    if (held(snap, BIO_ITEM.PLAGUE_SAMPLE) > 0) {
        return null;
    }
    return onMainland(area, custom('ask Elena to replace the sample she gave me', askElenaForReplacements));
}

/** Rimmington and Varrock proper: hand the vials over, dress as a priest, then cross the gate. */
function outsideQuarterStep(snap: QuestSnapshot, area: BioArea): QuestStep {
    const reagents = reagentStep(snap, area);
    if (reagents) {
        return reagents;
    }
    if (VIALS.some(vial => held(snap, vial) > 0)) {
        return custom('give the errand boys their vials', handToErrandBoys);
    }
    if (!ownsAll(snap, PRIEST_SUIT)) {
        return sourceCoins(snap, PRIEST_SUIT_GP) ?? custom('buy a priest gown from Thessalia', buyPriestSuit);
    }
    const suit = reclaim(snap, BIO_ITEM.PRIEST_GOWN) ?? reclaim(snap, BIO_ITEM.PRIEST_ROBE);
    return suit ?? custom("walk through the gate to Varrock's east quarter", crossEastGate);
}

/** Leave the quarter through the guarded gate, then run the errand that sent us out. */
function outside(name: string, errand: (log: (m: string) => void) => Promise<boolean>): QuestStep {
    return custom(name, async log => (await leaveQuarter(log)) && errand(log));
}

// Why: nothing in the quarter touches a bank — the nearest booth is on the far side of the gate,
// and a vial carried back through it is confiscated, which is a wedge rather than a recovery.
function inQuarterStep(snap: QuestSnapshot): QuestStep {
    if (owned(snap, BIO_ITEM.TOUCH_PAPER) === 0) {
        return outside('ask the chemist for touch paper', getTouchPaper);
    }
    if (held(snap, BIO_ITEM.PLAGUE_SAMPLE) === 0) {
        return outside('ask Elena to replace the sample she gave me', askElenaForReplacements);
    }
    if (VIALS.some(vial => held(snap, vial) === 0)) {
        // Why: a boy who drank, sold or painted his vial gives nothing back and only Elena reissues one — the walk out loses whatever is still carried to the gate guard, which is what makes her hand over a full set rather than the remainder.
        return snap.noProgress >= COLLECT_GIVE_UP
            ? outside('ask Elena to replace the vials the errand boys ruined', askElenaForReplacements)
            : custom('collect the vials at the Dancing Donkey', collectFromErrandBoys);
    }
    return custom('take the kit to Guidor', visitGuidor);
}

function smuggleStep(snap: QuestSnapshot, area: BioArea): QuestStep {
    if (inGuidorQuarter(snap.tile)) {
        return inQuarterStep(snap);
    }
    if (owned(snap, BIO_ITEM.TOUCH_PAPER) === 0) {
        return onMainland(area, custom('ask the chemist for touch paper', getTouchPaper));
    }
    return reclaim(snap, BIO_ITEM.TOUCH_PAPER) ?? outsideQuarterStep(snap, area);
}

function stageStep(snap: QuestSnapshot, area: BioArea, stage: number): QuestStep {
    switch (stage) {
        case BIO_STAGE.NOT_STARTED:
            return onMainland(area, custom('ask Elena about her distillator', startQuest));
        case BIO_STAGE.STARTED:
            return onMainland(area, custom('ask Jerico how to cross the wall', askJerico));
        case BIO_STAGE.SPOKEN_JERICO:
            return distractionStep(snap, area);
        case BIO_STAGE.USED_BIRDFEED:
            return onMainland(area, pigeonStep(snap) ?? custom('open the pigeon cage by the wall', releasePigeons));
        case BIO_STAGE.RELEASED_PIGEONS:
            return TO_WEST;
        // Why: the apples are a free respawning spawn a few tiles from the cauldron, so this leg
        // never consults the bank — which is what keeps a fresh start in West Ardougne moving.
        case BIO_STAGE.CLIMBED_LADDER:
            if (held(snap, BIO_ITEM.ROTTEN_APPLES) === 0) {
                return inWest(area, custom('take the rotten apples in West Ardougne', takeRottenApples));
            }
            return inWest(area, custom("poison the mourners' stew", poisonTheStew));
        case BIO_STAGE.POISONED_STEW:
            return distillatorStep(snap, area);
        case BIO_STAGE.FOUND_DISTILLATOR:
            return returnDistillatorStep(snap, area);
        case BIO_STAGE.GIVEN_DISTILLATOR:
            return reagentStep(snap, area)
                ?? onMainland(area, custom('ask the chemist for touch paper', getTouchPaper));
        case BIO_STAGE.SPOKEN_CHEMIST:
            return smuggleStep(snap, area);
        case BIO_STAGE.FOUND_SECRET:
            return onMainland(area, custom('tell Elena what Guidor found', reportToElena));
        case BIO_STAGE.REPORTED_ELENA:
            return onMainland(area, custom('confront King Lathas about the plague', confrontLathas));
        default:
            return { kind: 'wait', reason: `Biohazard stage ${stage} is not implemented` };
    }
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    const area = bioArea(snap.tile);
    if (area === 'unknown') {
        return { kind: 'wait', reason: 'player location unavailable' };
    }
    const stage = snap.progress?.stage ?? snap.stage;
    if (snap.journal === 'complete' || (stage ?? -1) >= BIO_STAGE.COMPLETE) {
        return { kind: 'done' };
    }
    if (stage === undefined) {
        return { kind: 'wait', reason: 'Biohazard journal stage unavailable' };
    }
    // Why: `ownsInventory` skips the engine's provisioning, so nothing else ever opens a booth and a gown, vial or key sitting in the bank stays invisible until this module reads one — but past the wall the navigator answers "unreachable" for every booth in the game, so the read waits for the mainland.
    if (!snap.bankKnown) {
        if (area === 'mainland') {
            return scanBank();
        }
        if (stage >= BIO_STAGE.POISONED_STEW) {
            return TO_MAINLAND;
        }
    }
    const spillover = area === 'mainland' ? tidy(snap, TIDY_FLOOR) : null;
    const step = spillover ?? stageStep(snap, area, stage);
    // Why: West Ardougne has no booth and the headquarters is sealed behind a door the navigator
    // has no edge for, so a bank leg decided over there walks at a booth it can prove no route to.
    return bankless(area) && banking(step) ? TO_MAINLAND : step;
}

function bankless(area: BioArea): boolean {
    return area === 'hq' || area === 'hqUpstairs' || area === 'west' || area === 'sewer';
}

function banking(step: QuestStep): boolean {
    return step.kind === 'withdraw' || step.kind === 'deposit' || step.kind === 'scanBank';
}

export const biohazard: QuestModule = {
    record: QUESTS.find(record => record.id === 'biohazard')!,
    bank: 'nearest',
    ownsInventory: true,
    readProgress: readBiohazardProgress,
    sustain: { foods: ['Lobster', 'Swordfish', 'Tuna'], eatBelowHp: 0.5 },
    decide
};
