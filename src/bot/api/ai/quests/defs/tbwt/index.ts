import { Skills } from '../../../../skills/Skills.js';
import { QUESTS } from '../../data/quests.js';
import { hasFlag, type QuestModule, type QuestSnapshot, type QuestStep } from '../../engine/types.js';
import {
    inCutscene,
    KARAMBWAN_BAIT,
    KARAMBWANJI_WANTED,
    TB_ID,
    TB_LUBUFU,
    TB_MAIN,
    TB_NPC,
    TB_TAMAYU,
    TB_TIADECHE,
    TB_TILE,
    TB_TINSAY
} from './areas.js';
import {
    becomeApprentice,
    claimReward,
    giveKarambwanji,
    giveManual,
    giveTamayu,
    giveTinsay,
    huntShaikahan,
    meetLubufu,
    meetTamayu,
    meetTiadeche,
    meetTinsay,
    spareVessel,
    startQuest,
    tiadecheCatch
} from './brothers.js';
import {
    burnJogreBones,
    buyRum,
    combine,
    cookOnFire,
    fishKarambwan,
    fishKarambwanji,
    grind,
    killFor,
    loadVessel,
    makeSandwich,
    pasteBones,
    pickBanana,
    poisonSpear
} from './crafting.js';
import { TB_FLAG, readTbwtProgress } from './journal.js';
import { heldId, lubufuStage, prepare, readiness, tamayuStage, tiadecheStage, tinsayStage } from './supplies.js';
import { useOnNpc, type Log } from './talk.js';

export { TBWT_QUEST, TB_ID, TB_LUBUFU, TB_MAIN, TB_TAMAYU, TB_TIADECHE, TB_TINSAY } from './areas.js';
export { parseTbwtJournal, readTbwtProgress, TB_FLAG } from './journal.js';
export { outstandingSupplies, prepare, TB_PROVEN } from './supplies.js';

const custom = (name: string, run: (log: Log) => Promise<boolean>): QuestStep => ({ kind: 'custom', name, run });
const wait = (reason: string): QuestStep => ({ kind: 'wait', reason });

/** The vessel in whichever state the pack holds it. */
function vesselHeld(snap: QuestSnapshot): number {
    return heldId(snap, TB_ID.VESSEL) > 0 ? TB_ID.VESSEL : (heldId(snap, TB_ID.VESSEL_LOADED) > 0 ? TB_ID.VESSEL_LOADED : 0);
}

/** A baited vessel, sourcing the vessel and the bait if either is gone. */
function baitedVessel(snap: QuestSnapshot): QuestStep | null {
    if (heldId(snap, TB_ID.VESSEL_LOADED) > 0) {
        return null;
    }
    if (heldId(snap, TB_ID.VESSEL) === 0) {
        return custom('ask Lubufu for another Karambwan vessel', spareVessel);
    }
    if (heldId(snap, TB_ID.RAW_KARAMBWANJI) === 0) {
        return custom('net a Karambwanji for bait', fishKarambwanji(1));
    }
    return custom('bait the Karambwan vessel', loadVessel);
}

// Why: Lubufu counts the twenty in himself, so a part-load is progress and the pack never has to hold all of them at once.

function lubufuLeg(snap: QuestSnapshot, stage: number): QuestStep {
    if (stage < TB_LUBUFU.FETCH_KARAMBWANJI) {
        return custom('introduce yourself to Lubufu', meetLubufu);
    }
    if (stage < TB_LUBUFU.GIVEN_KARAMBWANJI) {
        const owed = KARAMBWANJI_WANTED - (stage - TB_LUBUFU.FETCH_KARAMBWANJI);
        const carrying = heldId(snap, TB_ID.RAW_KARAMBWANJI);
        const free = snap.freeSlots ?? 0;
        if (carrying >= owed || (carrying > 0 && free <= 1)) {
            return custom(`hand Lubufu ${carrying} of the ${owed} Karambwanji he still wants`, giveKarambwanji);
        }
        return custom(`net Karambwanji (${carrying}/${owed})`, fishKarambwanji(Math.min(owed, carrying + free)));
    }
    return custom("take up Lubufu's apprenticeship", becomeApprentice);
}

function tiadecheCatchLeg(snap: QuestSnapshot, stage: number): QuestStep {
    if (stage < TB_TIADECHE.RETURN_WHEN_CAUGHT) {
        return custom('bring Tiadeche the news', meetTiadeche);
    }
    if (stage === TB_TIADECHE.CAUGHT) {
        return custom('ask Tiadeche what he needs next', meetTiadeche);
    }
    return baitedVessel(snap) ?? custom('hand Tiadeche the baited vessel', tiadecheCatch);
}

// Why: only a spear that is both stronger than bronze and Karambwan-poisoned satisfies Tamayu, and
// the poison is a poorly cooked Karambwan ground with a pestle — his own gift is the first one of those.

function karambwanSpear(snap: QuestSnapshot): QuestStep | null {
    if (heldId(snap, TB_ID.SPEAR_KP) > 0) {
        return null;
    }
    if (heldId(snap, TB_ID.KARAMBWAN_POISON_PASTE) > 0) {
        return custom('smear the Karambwan paste over the iron spear', poisonSpear);
    }
    if (heldId(snap, TB_ID.POORLY_COOKED_KARAMBWAN) > 0) {
        return custom('grind the cooked Karambwan into poison', grind(TB_ID.POORLY_COOKED_KARAMBWAN, TB_ID.KARAMBWAN_POISON_PASTE));
    }
    if (heldId(snap, TB_ID.RAW_KARAMBWAN) > 0) {
        return custom('cook the Karambwan on the jungle fire', cookOnFire(TB_ID.RAW_KARAMBWAN, TB_ID.POORLY_COOKED_KARAMBWAN, 'raw Karambwan'));
    }
    // Why: two spare Karambwanji ride along, so a burn is re-cooked from this trip rather than another.
    if (heldId(snap, TB_ID.RAW_KARAMBWANJI) < KARAMBWAN_BAIT) {
        return custom('net bait for the Karambwan shoal', fishKarambwanji(KARAMBWAN_BAIT));
    }
    if (vesselHeld(snap) === 0) {
        return custom('ask Lubufu for another Karambwan vessel', spareVessel);
    }
    return custom('lower the vessel for a Karambwan', fishKarambwan());
}

function tamayuLeg(snap: QuestSnapshot, stage: number): QuestStep {
    if (stage < TB_TAMAYU.SLAY_SHAIKAHAN) {
        return custom('bring Tamayu the news', meetTamayu);
    }
    if (stage < TB_TAMAYU.WATCHED_CUTSCENE) {
        return custom("watch Tamayu's hunt", huntShaikahan);
    }
    if (!hasFlag(snap.progress, TB_FLAG.AGILITY)) {
        return custom('give Tamayu the agility potion', giveTamayu(TB_ID.AGILITY_POTION_4));
    }
    if (!hasFlag(snap.progress, TB_FLAG.SPEAR)) {
        return karambwanSpear(snap) ?? custom('give Tamayu the Karambwan-poisoned spear', giveTamayu(TB_ID.SPEAR_KP));
    }
    return custom('follow Tamayu on the killing hunt', huntShaikahan);
}

function rumLeg(snap: QuestSnapshot): QuestStep {
    if (heldId(snap, TB_ID.RUM_SLICED) > 0) {
        return custom('give Tinsay the sliced banana in Karamjan rum', giveTinsay(TB_ID.RUM_SLICED));
    }
    if (heldId(snap, TB_ID.SLICED_BANANA) === 0) {
        if (heldId(snap, TB_ID.BANANA) === 0) {
            return custom('pick a banana in the plantation', pickBanana);
        }
        return custom('slice the banana', log => combine(TB_ID.KNIFE, TB_ID.BANANA, TB_ID.SLICED_BANANA, log));
    }
    if (heldId(snap, TB_ID.RUM) === 0) {
        return custom('buy Karamjan rum from Zambo', buyRum);
    }
    return custom('drop the banana slices into the rum', log => combine(TB_ID.SLICED_BANANA, TB_ID.RUM, TB_ID.RUM_SLICED, log));
}

// Why: nobody else on the island will skin a monkey, and Tamayu only does it once his own hunt is over.

function sandwichLeg(snap: QuestSnapshot): QuestStep {
    if (heldId(snap, TB_ID.SANDWICH) > 0) {
        return custom('give Tinsay the seaweed sandwich', giveTinsay(TB_ID.SANDWICH));
    }
    if (heldId(snap, TB_ID.MONKEY_SKIN) === 0) {
        if (heldId(snap, TB_ID.MONKEY_CORPSE) === 0) {
            return custom('shoot a monkey for its corpse', killFor(TB_NPC.MONKEY, TB_TILE.MONKEYS, TB_ID.MONKEY_CORPSE, 'Monkey corpse'));
        }
        return custom('ask Tamayu to skin the monkey', giveTamayu(TB_ID.MONKEY_CORPSE));
    }
    return custom('sandwich the seaweed into the monkey skin', makeSandwich);
}

function bonesLeg(snap: QuestSnapshot): QuestStep {
    if (heldId(snap, TB_ID.MARINATED_JOGRE_BONES) > 0) {
        return custom('give Tinsay the marinated Jogre bones', giveTinsay(TB_ID.MARINATED_JOGRE_BONES));
    }
    if (heldId(snap, TB_ID.PASTY_JOGRE_BONES) > 0) {
        return custom('marinate the bones on the jungle fire', cookOnFire(TB_ID.PASTY_JOGRE_BONES, TB_ID.MARINATED_JOGRE_BONES, 'pasty Jogre bones'));
    }
    if (heldId(snap, TB_ID.BURNT_JOGRE_BONES) > 0) {
        if (heldId(snap, TB_ID.KARAMBWANJI_PASTE) > 0) {
            return custom('smother the bones in Karambwanji paste', pasteBones);
        }
        if (heldId(snap, TB_ID.RAW_KARAMBWANJI) === 0) {
            return custom('net a Karambwanji for the marinade', fishKarambwanji(1));
        }
        return custom('grind the Karambwanji into paste', grind(TB_ID.RAW_KARAMBWANJI, TB_ID.KARAMBWANJI_PASTE));
    }
    if (heldId(snap, TB_ID.JOGRE_BONES) === 0) {
        return custom('kill a Jogre for its bones', killFor(TB_NPC.JOGRE, TB_TILE.JOGRES, TB_ID.JOGRE_BONES, 'Jogre bones'));
    }
    return custom('burn the Jogre bones', burnJogreBones);
}

function tinsayLeg(snap: QuestSnapshot, stage: number): QuestStep {
    if (stage < TB_TINSAY.FETCH_RUM) {
        return custom('bring Tinsay the news', meetTinsay);
    }
    // Handing an item over sets the "given" stage; only the next talk asks for the one after it.
    if (stage === TB_TINSAY.GIVEN_RUM || stage === TB_TINSAY.GIVEN_SANDWICH) {
        return custom('ask Tinsay what he needs next', meetTinsay);
    }
    if (stage === TB_TINSAY.FETCH_RUM) {
        return rumLeg(snap);
    }
    if (stage === TB_TINSAY.FETCH_SANDWICH) {
        return sandwichLeg(snap);
    }
    return bonesLeg(snap);
}

function tiadecheManualLeg(snap: QuestSnapshot): QuestStep {
    if (heldId(snap, TB_ID.CRAFTING_MANUAL) > 0) {
        return custom('give Tiadeche the crafting manual', giveManual);
    }
    const vessel = vesselHeld(snap);
    if (vessel === 0) {
        return custom('ask Lubufu for another Karambwan vessel', spareVessel);
    }
    return custom('take a vessel to Tinsay for the crafting instructions', log =>
        useOnNpc(vessel, TB_NPC.TINSAY, TB_TILE.TINSAY, [], log));
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'unknown') {
        return wait('quest journal not loaded');
    }
    if (snap.journal === 'complete') {
        return { kind: 'done' };
    }
    const main = snap.stage;
    if (main === undefined) {
        return wait('Tai Bwo Wannai Trio stage not readable');
    }
    // The hunt teleports the player into a sealed instance; nothing out there can be acted on from it.
    if (inCutscene(snap.tile)) {
        return wait('watching Tamayu hunt the Shaikahan');
    }
    if (main >= TB_MAIN.ALL_BROTHERS) {
        return custom("claim Timfraku's reward", claimReward);
    }
    // Why: Timfraku is across a 30gp ferry each way, so the pack is filled before the first
    // crossing rather than after it — including the coin the crossing itself is priced in.
    const kit = prepare(snap);
    if (kit) {
        return kit;
    }
    if (main <= TB_MAIN.ASKED_FOR_HELP) {
        return custom('ask Timfraku for the job', startQuest);
    }

    const lubufu = lubufuStage(snap);
    const tiadeche = tiadecheStage(snap);
    const tamayu = tamayuStage(snap);
    const tinsay = tinsayStage(snap);

    // The vessel is the spine: Tiadeche cannot catch without it and Tinsay will not write without one.
    if (lubufu < TB_LUBUFU.COMPLETE) {
        return lubufuLeg(snap, lubufu);
    }
    // His first catch is the raw Karambwan the poisoned spear is ground from.
    if (tiadeche < TB_TIADECHE.REQUEST_MANUAL) {
        return tiadecheCatchLeg(snap, tiadeche);
    }
    if (tamayu < TB_TAMAYU.COMPLETE) {
        return tamayuLeg(snap, tamayu);
    }
    if (tinsay < TB_TINSAY.COMPLETE) {
        return tinsayLeg(snap, tinsay);
    }
    if (tiadeche < TB_TIADECHE.COMPLETE) {
        return tiadecheManualLeg(snap);
    }
    return wait('all four brothers are done — waiting for the quest varp to catch up');
}

function observe(snap: QuestSnapshot): string[] {
    return [
        `lubufu=${lubufuStage(snap)} tiadeche=${tiadecheStage(snap)} tamayu=${tamayuStage(snap)}`
        + ` tinsay=${tinsayStage(snap)} agility=${hasFlag(snap.progress, TB_FLAG.AGILITY)} spear=${hasFlag(snap.progress, TB_FLAG.SPEAR)}`
    ];
}

export const tbwt: QuestModule = {
    record: QUESTS.find(record => record.id === 'tbwt')!,
    // Why: Karamja has no bank until Shilo Village is complete, and this quest does not require it — Ardougne West is the nearest booth to the Brimhaven ferry.
    bank: TB_TILE.ARDOUGNE_BANK,
    ownsInventory: true,
    readProgress: readTbwtProgress,
    warnReadiness: () => readiness(skill => Skills.level(skill)),
    observe,
    decide
};
