import { QUESTS } from '../../data/quests.js';
import { QuestFood } from '../../food.js';
import { gpShort } from '../../engine/provisioning.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { ARMOUR_KEEP, armourWanted } from './armour.js';
import {
    GALAHAD,
    GRAIL_TILE,
    HIGH_PRIEST,
    ITEM,
    KING_ARTHUR_FINISH,
    KING_ARTHUR_START,
    LADY_OF_THE_LAKE,
    eastOfTitan,
    inBlightedRealm,
    inFisherRealm,
    inRenewedRealm
} from './areas.js';
import { GRAIL_STAGE, readHolyGrailProgress } from './journal.js';
import {
    draynorWhistles,
    freePercival,
    merlinLeg,
    realmLeg,
    takeGrail,
    unequipAll,
    wearArmour,
    whistleIn,
    whistleOut
} from './legs.js';

const EXCALIBUR_PRICE = 500;

function held(snap: QuestSnapshot, name: string): number {
    return snap.inv.get(name.toLowerCase()) ?? 0;
}

function banked(snap: QuestSnapshot, name: string): number {
    return snap.bank?.get(name.toLowerCase()) ?? 0;
}

function worn(snap: QuestSnapshot, name: string): boolean {
    return snap.worn.has(name.toLowerCase());
}

function custom(name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep {
    return { kind: 'custom', name, run };
}

/** Excalibur is not consumed by Merlin's Crystal, so the bank almost always has it. */
export function excaliburPlan(snap: QuestSnapshot): QuestStep {
    if (banked(snap, ITEM.EXCALIBUR) > 0) {
        return { kind: 'withdraw', items: [{ name: ITEM.EXCALIBUR, qty: 1 }] };
    }
    if (held(snap, ITEM.COINS) >= EXCALIBUR_PRICE) {
        return { kind: 'talk', stop: LADY_OF_THE_LAKE };
    }
    if (gpShort(snap, EXCALIBUR_PRICE) > 0) {
        return { kind: 'wait', reason: `need ${EXCALIBUR_PRICE} gp to buy Excalibur back from the Lady of the Lake` };
    }
    return { kind: 'withdraw', items: [{ name: ITEM.COINS, qty: EXCALIBUR_PRICE }] };
}

// Why: the monk's search covers held and worn alike, so the pack has to be down to coin and food before the boat is even walked to.
const ENTRANA_KEEP = [ITEM.COINS.toLowerCase()];

function entranaSpillover(snap: QuestSnapshot, food: string | null): string[] {
    const keep = food ? [...ENTRANA_KEEP, food.toLowerCase()] : ENTRANA_KEEP;
    return [...snap.inv.keys()].filter(name => !keep.includes(name));
}

// Why: the gear comes off before the deposit, not after — stripping second puts it straight back in the pack and buys a second bank trip.
function entranaLeg(snap: QuestSnapshot, food: string | null): QuestStep {
    if (snap.worn.size > 0) {
        return custom('remove weapons and armour for Entrana', unequipAll);
    }
    if (entranaSpillover(snap, food).length > 0) {
        return {
            kind: 'deposit',
            keep: food ? [ITEM.COINS, food] : [ITEM.COINS],
            bank: GRAIL_TILE.DRAYNOR_BANK,
            exactKeep: true
        };
    }
    return { kind: 'talk', stop: HIGH_PRIEST };
}

/** Re-arm after the Entrana strip: Excalibur first, then whatever armour the bank holds. */
function armStep(snap: QuestSnapshot): QuestStep | null {
    if (!worn(snap, ITEM.EXCALIBUR)) {
        if (held(snap, ITEM.EXCALIBUR) === 0) {
            return excaliburPlan(snap);
        }
        return { kind: 'equip', item: ITEM.EXCALIBUR };
    }
    const wanted = armourWanted(snap);
    if (wanted.length === 0) {
        return null;
    }
    const carried = wanted.filter(name => held(snap, name) > 0);
    if (carried.length > 0) {
        return custom(`wear ${carried.join(', ')}`, log => wearArmour(carried, log));
    }
    return { kind: 'withdraw', items: wanted.map(name => ({ name, qty: 1 })) };
}

function napkinStep(snap: QuestSnapshot): QuestStep | null {
    if (held(snap, ITEM.NAPKIN) > 0) {
        return null;
    }
    if (banked(snap, ITEM.NAPKIN) > 0) {
        return { kind: 'withdraw', items: [{ name: ITEM.NAPKIN, qty: 1 }] };
    }
    return { kind: 'talk', stop: GALAHAD };
}

// Why: the whistles are the way in and the way home, and the door only drops them for a character carrying the napkin — so every leg that needs one has to check the cloth first.
// Why: Galahad replaces a lost napkin at stages 4 and 7 alone, so past that a missing one is a park with a reason rather than a walk to Seers'.

/** Withdraw the napkin if needed, then fetch whistles; null once `want` are in the pack. */
function whistleStep(snap: QuestSnapshot, want: number): QuestStep | null {
    if (held(snap, ITEM.WHISTLE) >= want) {
        return null;
    }
    if (held(snap, ITEM.NAPKIN) === 0) {
        if (banked(snap, ITEM.NAPKIN) > 0) {
            return { kind: 'withdraw', items: [{ name: ITEM.NAPKIN, qty: 1 }] };
        }
        return { kind: 'wait', reason: 'no Holy table napkin, and Galahad replaces one only before Sir Percival is the errand' };
    }
    return custom('collect Magic whistles from Draynor Manor', log => draynorWhistles(2, log));
}

/** Stages 4 and 7 are the same errand: arm, fetch two whistles, cross, and see the Fisher King. */
function crossingLeg(snap: QuestSnapshot): QuestStep {
    if (inBlightedRealm(snap.tile)) {
        // Excalibur is needed on the far side of the titan and cannot be fetched from in here.
        if (eastOfTitan(snap.tile) && !worn(snap, ITEM.EXCALIBUR)) {
            if (held(snap, ITEM.EXCALIBUR) > 0) {
                return { kind: 'equip', item: ITEM.EXCALIBUR };
            }
            return custom('leave the realm to fetch Excalibur', whistleOut);
        }
        return custom('cross the realm to the Fisher King', realmLeg);
    }
    if (inRenewedRealm(snap.tile)) {
        return custom('leave the renewed realm', whistleOut);
    }
    const napkin = napkinStep(snap);
    if (napkin) {
        return napkin;
    }
    const arm = armStep(snap);
    if (arm) {
        return arm;
    }
    // Why: two — one is spent giving Sir Percival his ride home, and the other is the only way out of the realm.
    return whistleStep(snap, 2) ?? custom("blow the whistle at Karamja's six heads", whistleIn);
}

function percivalLeg(snap: QuestSnapshot): QuestStep {
    if (inFisherRealm(snap.tile)) {
        return custom('leave the realm to find Sir Percival', whistleOut);
    }
    return whistleStep(snap, 1) ?? custom('free Sir Percival from the Goblin Village sacks', freePercival);
}

function grailLeg(snap: QuestSnapshot): QuestStep {
    if (held(snap, ITEM.GRAIL) > 0) {
        return inFisherRealm(snap.tile)
            ? custom('carry the Grail out of the realm', whistleOut)
            : { kind: 'talk', stop: KING_ARTHUR_FINISH };
    }
    if (inRenewedRealm(snap.tile)) {
        return custom('take the Holy Grail from the round table', takeGrail);
    }
    if (inBlightedRealm(snap.tile)) {
        return custom('leave the blighted realm', whistleOut);
    }
    return whistleStep(snap, 1) ?? custom("blow the whistle at Karamja's six heads", whistleIn);
}

function selectedFood(): string | null {
    const food = QuestFood.name?.trim();
    return food ? food : null;
}

export function decide(snap: QuestSnapshot, food: string | null = selectedFood()): QuestStep {
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
    // Why: `ownsInventory` is off, but the armour planner reads the bank, and an unread bank looks empty.
    if (!snap.bankKnown && !inFisherRealm(snap.tile)) {
        return { kind: 'scanBank' };
    }
    switch (stage) {
        case GRAIL_STAGE.NOT_STARTED:
            return { kind: 'talk', stop: KING_ARTHUR_START };
        case GRAIL_STAGE.STARTED:
            return custom("talk to Merlin in Camelot's workshop", merlinLeg);
        case GRAIL_STAGE.SPOKEN_MERLIN:
            return entranaLeg(snap, food);
        case GRAIL_STAGE.SPOKEN_CRONE:
        case GRAIL_STAGE.FAILED_TITAN:
            return crossingLeg(snap);
        case GRAIL_STAGE.FINDING_PERCIVAL:
            return percivalLeg(snap);
        case GRAIL_STAGE.GIVEN_WHISTLE:
            return grailLeg(snap);
        default:
            return { kind: 'wait', reason: `unmapped Holy Grail stage ${stage}` };
    }
}

export const holygrail: QuestModule = {
    record: QUESTS.find(r => r.id === 'grail')!,
    // Why: the quest crosses Camelot, Entrana, Seers', Draynor, Karamja and the Goblin Village — no one bank is near enough to pin.
    bank: 'nearest',
    food: 12,
    grind: ['Black Knight Titan'],
    tools: [
        ITEM.EXCALIBUR.toLowerCase(),
        ITEM.NAPKIN.toLowerCase(),
        ITEM.WHISTLE.toLowerCase(),
        ITEM.BELL.toLowerCase(),
        ITEM.GRAIL.toLowerCase(),
        'coins',
        ...ARMOUR_KEEP
    ],
    sustain: { foods: ['Lobster', 'Swordfish', 'Tuna'], eatBelowHp: 0.5 },
    gather: { excalibur: excaliburPlan },
    readProgress: readHolyGrailProgress,
    warnReadiness: () => 'Holy Grail fights a level-120 Black Knight Titan (142 hp, 91 defence); the proven floor is 70 combat in rune with Lobsters',
    decide
};

export { GRAIL_STAGE };
