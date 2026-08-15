import { QUESTS } from '../../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { DREZEL, inGrotto, NS_HOPS, NS_ID, NS_STAGE } from './areas.js';
import { askToHelp, bloomWithScroll, feedStones, journalLeg, mirrorLeg, solvePuzzle, talkFilliman } from './camp.js';
import { bloomWithSickle, fillPouch, killGhast } from './ghasts.js';
import { blessSickle, enterGrotto, exitAfterQuest, leaveGrotto, talkInGrotto } from './grotto.js';
import { NS_FLAG, readDruidProgress } from './journal.js';
import { amulet, heldId, NS_TOOLS, sickleStep } from './supplies.js';

const custom = (name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep =>
    ({ kind: 'custom', name, run });

const GHOST_TOPIC = "I'm wearing an amulet of ghost speak!";
const ANOTHER_SCROLL = 'Could I have another bloom scroll please?';
const THANKS = ['Ok thanks.', 'Ok, thanks.'];

const harvestHeld = (snap: QuestSnapshot): number =>
    heldId(snap, NS_ID.PEAR) + heldId(snap, NS_ID.STEM) + heldId(snap, NS_ID.FUNGI);

// Why: the grotto is a sealed pocket, and a branch that acts on the surface from inside it walks at a tile with no route to it.

/** Leave the pocket before any step that acts outside it. */
function outside(snap: QuestSnapshot, step: QuestStep): QuestStep {
    return inGrotto(snap.tile) ? custom('leave the grotto', leaveGrotto) : step;
}

// Why: the bloomed log reverts 25 ticks after it grows, so a resume with no fungus has to cast again rather than look for one that has gone.

/** A fungus in the pack, by whatever route is open. */
function fungus(snap: QuestSnapshot): QuestStep {
    if (heldId(snap, NS_ID.SPELL) === 0) {
        return custom('ask for another bloom scroll', log => talkFilliman(ANOTHER_SCROLL, log));
    }
    return custom('bloom the swamp for a fungus', bloomWithScroll);
}

function ritual(snap: QuestSnapshot): QuestStep {
    const flags = snap.progress?.flags ?? new Set<string>();
    if (!flags.has(NS_FLAG.NATURE) && heldId(snap, NS_ID.FUNGI) === 0) {
        return fungus(snap);
    }
    if (!flags.has(NS_FLAG.NATURE) || !flags.has(NS_FLAG.SPIRIT)) {
        return custom('feed the ritual stones', log => feedStones(flags, log));
    }
    return custom('solve the ritual', solvePuzzle);
}

/** Bloom, fill, hunt — the loop the last four stages share. */
function ghastLoop(snap: QuestSnapshot): QuestStep {
    if (heldId(snap, NS_ID.SICKLE_BLESSED) === 0) {
        return heldId(snap, NS_ID.SICKLE) > 0
            ? custom('bless the sickle', blessSickle)
            : (sickleStep(snap) ?? custom('bless the sickle', blessSickle));
    }
    if (heldId(snap, NS_ID.POUCH) > 0) {
        return custom('kill a ghast', killGhast);
    }
    if (harvestHeld(snap) >= 3) {
        return custom('fill the druid pouch', fillPouch);
    }
    return custom('harvest natures bounty', bloomWithSickle);
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
    // Why: without the amulet both spirits answer in gibberish and no dialogue advances, so it is worn before anything else is attempted.
    // Why: that includes before the first word with Drezel, as nothing about the amulet is quest-gated and starting first sends the bot east to the mausoleum, west to Lumbridge for the amulet, and east again.
    const wearing = amulet(snap);
    if (wearing) {
        return outside(snap, wearing);
    }
    if (stage === NS_STAGE.NOT_STARTED) {
        return outside(snap, { kind: 'talk', stop: DREZEL });
    }
    switch (stage) {
        case NS_STAGE.STARTED:
        case NS_STAGE.ENTERED_SWAMP:
        case NS_STAGE.FAILED_TALK:
            return outside(snap, custom('find Filliman', log => talkFilliman(GHOST_TOPIC, log)));
        case NS_STAGE.SPOKEN_FILLIMAN:
            return outside(snap, custom('mirror', mirrorLeg));
        case NS_STAGE.SHOWN_MIRROR:
            return outside(snap, custom("Tarlock's journal", journalLeg));
        case NS_STAGE.GIVEN_JOURNAL:
            return outside(snap, custom('offer to help', askToHelp));
        case NS_STAGE.RECEIVED_SPELL:
            return outside(snap, { kind: 'talk', stop: DREZEL });
        // Why: a held fungus is unambiguous evidence the pick landed, and the journal read trails it by a tick — branching on the page alone sent the bot back to Filliman for a scroll it no longer needed.
        case NS_STAGE.BLESSED:
        case NS_STAGE.CASTED_SPELL:
        case NS_STAGE.PICKED_FUNGI:
        case NS_STAGE.SPOKEN_FILLIMAN2:
            return outside(snap, ritual(snap));
        case NS_STAGE.PERFORMED_RITUAL:
            return custom('enter the grotto', enterGrotto);
        case NS_STAGE.ENTERED_GROTTO:
            return custom('watch the transformation', log => talkInGrotto(THANKS, log));
        case NS_STAGE.FULL_TRANSFORM: {
            if (heldId(snap, NS_ID.SICKLE) > 0 || heldId(snap, NS_ID.SICKLE_BLESSED) > 0) {
                return custom('hand over the sickle', log => talkInGrotto(THANKS, log));
            }
            const fetch = sickleStep(snap);
            return fetch ? outside(snap, fetch) : custom('hand over the sickle', log => talkInGrotto(THANKS, log));
        }
        case NS_STAGE.BLESSED_SICKLE:
        case NS_STAGE.CASTED_SICKLE_BLOOM:
        case NS_STAGE.PICKED_SICKLE:
        case NS_STAGE.ADDED_POUCH:
        case NS_STAGE.KILLED_GHAST1:
        case NS_STAGE.KILLED_GHAST2:
            return outside(snap, ghastLoop(snap));
        case NS_STAGE.KILLED_GHAST3:
            return custom('claim the reward', log => talkInGrotto(THANKS, log));
        default:
            return { kind: 'done' };
    }
}

export const druidspirit: QuestModule = {
    record: QUESTS.find(r => r.id === 'druidspirit')!,
    // Paterdomus, the swamp and Al Kharid: pinning one booth costs a kingdom crossing on the sickle leg.
    bank: 'nearest',
    tools: [...NS_TOOLS],
    ownsInventory: true,
    hops: NS_HOPS,
    readProgress: readDruidProgress,
    exit: exitAfterQuest,
    decide
};
