import { Quests } from '../../../../ui/questlog/Quests.js';
import { Skills } from '../../../../skills/Skills.js';
import { QUESTS } from '../../data/quests.js';
import { flagValue, hasFlag, type QuestModule, type QuestSnapshot, type QuestStep } from '../../engine/types.js';
import { TROLL_QUEST } from '../trollstronghold/journal.js';
import {
    BURNTMEAT_TALK,
    EADGAR_TALK,
    ER_ITEM,
    SANFEW_FINISH,
    SANFEW_START,
    TEGID_ROBE,
    banked,
    eadgarZone,
    held
} from './areas.js';
import { EADGAR_FLAG, EADGAR_STAGE, SCARECROW_NEED, readEadgarProgress } from './journal.js';
import { sourceParrot } from './parrot.js';
import { retrieveParrot, takeGoutweed, takeStoreroomKey, unlockStoreroom } from './storeroom.js';
import {
    SCARECROW_FOOD_TARGET,
    foodNames,
    prepare,
    scanBank,
    sourceAxe,
    sourceChickens,
    sourceGrain,
    sourceLogs,
    withdraw
} from './supplies.js';
import { guarded, guardedTalk } from './travel.js';
import { freeEadgar, hideParrot, sourceTrollPotion } from './trollheim.js';

export { EADGAR_FLAG, EADGAR_QUEST, EADGAR_STAGE, parseEadgarJournal, readEadgarProgress } from './journal.js';
export { eadgarZone, committed } from './areas.js';

const HERBLORE_REQ = 31;

/** What the scarecrow still wants, read from the journal at stage 70 and assumed complete before it. */
function scarecrowNeed(snap: QuestSnapshot, stage: number): { logs: number; chickens: number; grain: number } {
    if (stage !== EADGAR_STAGE.NEEDS_ITEMS) {
        return { logs: SCARECROW_NEED.logs, chickens: SCARECROW_NEED.chickens, grain: SCARECROW_NEED.grain };
    }
    return {
        logs: hasFlag(snap.progress, EADGAR_FLAG.NEED_LOGS) ? 1 : 0,
        chickens: flagValue(snap.progress, EADGAR_FLAG.NEED_CHICKENS) ?? 0,
        grain: flagValue(snap.progress, EADGAR_FLAG.NEED_GRAIN) ?? 0
    };
}

// Why: the food float only has to shrink while the grain and the chickens are still filling the pack — holding it down for the rest of stage 70 sends the character up the thrower gauntlet on four lobsters, which is what killed three live runs.

/** Pack slots the scarecrow still has to fill. */
function scarecrowSlots(snap: QuestSnapshot, stage: number): number {
    const need = scarecrowNeed(snap, stage);
    return need.logs + need.chickens + need.grain;
}

/** Above this, the scarecrow load is what the pack is for and the food float gives way to it. */
const SCARECROW_SLOT_SLACK = 4;

/** Fetch whatever the scarecrow is still short of. Null once the pack can satisfy the turn-in. */
function sourceScarecrow(snap: QuestSnapshot, stage: number): QuestStep | null {
    const need = scarecrowNeed(snap, stage);
    return (need.logs > 0 ? sourceLogs(snap, need.logs) : null)
        ?? (need.chickens > 0 ? sourceChickens(snap, need.chickens) : null)
        ?? (need.grain > 0 ? sourceGrain(snap, need.grain) : null);
}

// Why: Tegid only parts with a robe while the quest sits at stage 70 and neither the pack nor the
// bank already holds one, so a banked robe has to come out rather than be asked for again.
function sourceRobe(snap: QuestSnapshot): QuestStep | null {
    if (!hasFlag(snap.progress, EADGAR_FLAG.NEED_CLOTHES) || held(snap, ER_ITEM.DIRTY_ROBE) > 0) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank(snap);
    }
    if (banked(snap, ER_ITEM.DIRTY_ROBE) > 0) {
        return withdraw(snap, [{ name: ER_ITEM.DIRTY_ROBE.name, id: ER_ITEM.DIRTY_ROBE.id, qty: 1 }]);
    }
    return { kind: 'talk', stop: TEGID_ROBE };
}

/** The parrot Eadgar wants back in hand before it can be hidden. */
function parrotInHand(snap: QuestSnapshot): QuestStep | null {
    if (held(snap, ER_ITEM.DRUNK_PARROT) > 0) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank(snap);
    }
    if (banked(snap, ER_ITEM.DRUNK_PARROT) > 0) {
        return withdraw(snap, [{ name: ER_ITEM.DRUNK_PARROT.name, id: ER_ITEM.DRUNK_PARROT.id, qty: 1 }]);
    }
    // Eadgar hands out a replacement once neither the pack nor the bank has one.
    return { kind: 'talk', stop: EADGAR_TALK };
}

// Why: Burntmeat only takes the dummy out of the pack, and Eadgar keeps a spare — "You bumbling
// imbecile!" hands over another one, so a lost fake man is a walk rather than a dead run.
function fakeManInHand(snap: QuestSnapshot): QuestStep | null {
    if (held(snap, ER_ITEM.FAKE_MAN) > 0) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank(snap);
    }
    if (banked(snap, ER_ITEM.FAKE_MAN) > 0) {
        return withdraw(snap, [{ name: ER_ITEM.FAKE_MAN.name, id: ER_ITEM.FAKE_MAN.id, qty: 1 }]);
    }
    return { kind: 'talk', stop: EADGAR_TALK };
}

function sourceStoreroomKey(snap: QuestSnapshot): QuestStep | null {
    if (held(snap, ER_ITEM.STOREROOM_KEY) > 0) {
        return null;
    }
    if (snap.bankKnown && banked(snap, ER_ITEM.STOREROOM_KEY) > 0) {
        return withdraw(snap, [{ name: ER_ITEM.STOREROOM_KEY.name, id: ER_ITEM.STOREROOM_KEY.id, qty: 1 }]);
    }
    return guarded('search the kitchen drawers for the storeroom key', takeStoreroomKey);
}

export function decide(snap: QuestSnapshot): QuestStep {
    const stage = snap.progress?.stage ?? snap.stage;
    if (snap.journal === 'complete' || (stage ?? 0) >= EADGAR_STAGE.COMPLETE) {
        return { kind: 'done' };
    }
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    if (stage === undefined) {
        return { kind: 'wait', reason: "Eadgar's Ruse journal stage unavailable" };
    }
    if (stage === EADGAR_STAGE.NOT_STARTED && Quests.status(TROLL_QUEST) !== 'complete') {
        return { kind: 'wait', reason: "Troll Stronghold must be complete before Eadgar's Ruse" };
    }

    const zone = eadgarZone(snap.tile);
    const prep = (foodWant?: number): QuestStep | null => prepare(snap, zone, foodWant);

    // Why: every Eadgar leg walks into a cave he is only standing in once his cell has been opened.
    if (!hasFlag(snap.progress, EADGAR_FLAG.EADGAR_FREED)) {
        return prep() ?? guarded('free Mad Eadgar from the troll prison', freeEadgar);
    }

    switch (stage) {
        case EADGAR_STAGE.NOT_STARTED:
            return prep() ?? { kind: 'talk', stop: SANFEW_START };
        case EADGAR_STAGE.STARTED:
            return prep() ?? guardedTalk(EADGAR_TALK);
        case EADGAR_STAGE.SPOKE_EADGAR:
            return prep() ?? guardedTalk(BURNTMEAT_TALK);
        case EADGAR_STAGE.SPOKE_BURNTMEAT_FIRST:
        case EADGAR_STAGE.SPOKE_BURNTMEAT:
            return prep() ?? guardedTalk(EADGAR_TALK);
        // Why: the knife, the pineapple, the vodka and the axe all sit in the Tree Gnome Stronghold, so the axe the scarecrow's logs need at stage 60 is bought on this trip rather than paying for a second one.
        // Why: the axe goes first, as the parrot leg ends four hundred tiles away in Ardougne and coming back for one is the walk this ordering exists to avoid.
        case EADGAR_STAGE.NEEDS_PARROT:
            return prep() ?? sourceAxe(snap) ?? sourceParrot(snap) ?? guardedTalk(EADGAR_TALK);
        case EADGAR_STAGE.EXPLAINED_PLAN:
            return prep() ?? parrotInHand(snap) ?? guarded('hide the parrot under the prison rack', hideParrot);
        case EADGAR_STAGE.HID_PARROT:
        case EADGAR_STAGE.NEEDS_ITEMS:
            return prep(scarecrowSlots(snap, stage) > SCARECROW_SLOT_SLACK ? SCARECROW_FOOD_TARGET : undefined)
                ?? (stage === EADGAR_STAGE.NEEDS_ITEMS ? sourceRobe(snap) : null)
                ?? sourceScarecrow(snap, stage)
                ?? guardedTalk(EADGAR_TALK);
        case EADGAR_STAGE.NEEDS_POTION:
            return prep() ?? sourceTrollPotion(snap) ?? guardedTalk(EADGAR_TALK);
        case EADGAR_STAGE.NEEDS_PARROT_BACK:
            return prep() ?? guarded('fetch the parrot back from under the rack', retrieveParrot);
        case EADGAR_STAGE.GOT_PARROT_BACK:
            return prep() ?? guardedTalk(EADGAR_TALK);
        case EADGAR_STAGE.GOT_FAKE_MAN:
            return prep() ?? fakeManInHand(snap) ?? guardedTalk(BURNTMEAT_TALK);
        case EADGAR_STAGE.GOT_BURNT_MEAT:
            return prep()
                ?? sourceStoreroomKey(snap)
                ?? guarded('unlock the troll storeroom', unlockStoreroom);
        case EADGAR_STAGE.UNLOCKED_STOREROOM:
            if (held(snap, ER_ITEM.GOUTWEED) > 0) {
                return { kind: 'talk', stop: SANFEW_FINISH };
            }
            // Why: Sanfew reads the goutweed out of the pack, so a banked one still finishes the quest.
            if (snap.bankKnown && banked(snap, ER_ITEM.GOUTWEED) > 0) {
                return withdraw(snap, [{ name: ER_ITEM.GOUTWEED.name, id: ER_ITEM.GOUTWEED.id, qty: 1 }]);
            }
            return prep() ?? guarded('take goutweed from the storeroom crate', takeGoutweed);
        default:
            return { kind: 'wait', reason: `unrecognized Eadgar's Ruse stage ${stage}` };
    }
}

function warnEadgarReadiness(): string | null {
    const bits: string[] = [];
    if (Skills.level('herblore') < HERBLORE_REQ) {
        bits.push(`Herblore ${HERBLORE_REQ} is required — Sanfew will not hand out the quest below it`);
    }
    if (Skills.level('agility') < 15) {
        bits.push('Agility 15 is required for the Trollheim climbing rocks');
    }
    if (Skills.level('thieving') < 30) {
        bits.push('Thieving 30 is what steals Cell key 2 if Mad Eadgar still needs freeing');
    }
    const combat = Math.min(Skills.level('attack'), Skills.level('strength'), Skills.level('defence'));
    if (combat < 40 || Skills.level('hitpoints') < 40) {
        bits.push(`combat looks light for the troll pass (att/str/def≈${combat}, hp=${Skills.level('hitpoints')})`);
    }
    return bits.length > 0 ? `Eadgar's Ruse: ${bits.join('; ')}` : null;
}

function observe(snap: QuestSnapshot, step: QuestStep): readonly string[] {
    const need = scarecrowNeed(snap, snap.progress?.stage ?? snap.stage ?? -1);
    return [
        `zone=${eadgarZone(snap.tile)} flags=[${[...(snap.progress?.flags ?? [])].join(', ')}]`,
        `scarecrow still wants logs=${need.logs} chickens=${need.chickens} grain=${need.grain}`,
        `step=${step.kind}`
    ];
}

export const eadgar: QuestModule = {
    record: QUESTS.find(r => r.id === 'eadgar')!,
    bank: 'nearest',
    grind: ['Chicken'],
    tools: [
        ...Object.values(ER_ITEM).map(item => item.name.toLowerCase()),
        ...foodNames().map(name => name.toLowerCase())
    ],
    ownsInventory: true,
    readProgress: readEadgarProgress,
    // Why: the mountain is a ranged gauntlet with nothing to fight back at, so the margin is food
    // and the only lever on it is eating sooner.
    sustain: { foods: foodNames(), eatBelowHp: 0.7 },
    warnReadiness: warnEadgarReadiness,
    observe,
    decide
};
