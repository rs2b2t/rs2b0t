import { Equipment } from '../../../../equipment/Equipment.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Skills } from '../../../../skills/Skills.js';
import { QUESTS } from '../../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { kitWanted } from '../fightarena/index.js';
import { wearKit } from '../fightarena/legs.js';
import {
    ANY_BELLOWS,
    CB_ID,
    CB_NAME,
    CB_NPC,
    CB_STAGE,
    CB_TILE
} from './areas.js';
import { arrowStep, feathersNeeded, walkTo } from './arrows.js';
import { settleScene } from '../../exec/prompts.js';
import { CookState, askKids, cookChompy, seasoningStep } from './cook.js';
import { type BoxDrive, talkBoxes } from './dialogue.js';
import { ChestState, catchToad, huntChompy, openChest, watchRantzShoot } from './hunt.js';
import { readChompyProgress } from './journal.js';
import { feathersStep, heldId, loadoutStep, scanBank, toolStep, toolsHeld, withdraw } from './supplies.js';

const custom = (name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep =>
    ({ kind: 'custom', name, run });

const TOADIES = 'How do we make the chompys come?';
const STABBERS = ["Ok, I'll make you some 'stabbers'.", "Ok, I'll make the 'stabbers' for you."];
const THANKS = 'Ok, thanks.';

const hasBellows = (snap: QuestSnapshot): boolean => ANY_BELLOWS.some(id => heldId(snap, id) > 0);
const bankHasBellows = (snap: QuestSnapshot): number | null =>
    ANY_BELLOWS.find(id => (snap.bankIds?.get(id) ?? 0) > 0) ?? null;

// Why: three in the pack is a fight that runs dry with the bird alive, and the quiver has no count on the wire — so a quivered stack is trusted and the pack is what has to reach this floor.

/** Enough ogre arrows to see a chompy off. */
const HUNT_ARROWS = 6;

const hasArrows = (snap: QuestSnapshot): boolean =>
    heldId(snap, CB_ID.ARROW) >= HUNT_ARROWS || (snap.wornIds?.has(CB_ID.ARROW) ?? false);

const hasBow = (snap: QuestSnapshot): boolean =>
    heldId(snap, CB_ID.BOW) > 0 || (snap.wornIds?.has(CB_ID.BOW) ?? false);

// Why: the bait clearing is fifteen tiles from Rantz, which is outside the range the npc list holds him in — a talk from there finds nobody and fails in a millisecond.

/** Walk to Rantz, then drive whatever his current stage answers with. */
async function talkRantz(drive: BoxDrive, log: (m: string) => void): Promise<boolean> {
    if (drive.expect?.()) {
        return true;
    }
    if (!(await walkTo(CB_TILE.RANTZ, 3, log))) {
        return false;
    }
    await settleScene();
    return talkBoxes(CB_NPC.RANTZ, drive, log);
}

function startQuest(log: (m: string) => void): Promise<boolean> {
    return talkRantz({ prefer: STABBERS, ms: 60_000 }, log);
}

// Why: the hand-over runs straight into the five-option toady menu, and the answer that moves the quest to 15 is the one the menu re-offers forever.

async function giveArrows(log: (m: string) => void): Promise<boolean> {
    const before = Inventory.countById(CB_ID.ARROW);
    await talkRantz({ prefer: [TOADIES, ...STABBERS, THANKS], once: [TOADIES], ms: 90_000 }, log);
    if (Inventory.countById(CB_ID.ARROW) > before - 6) {
        log('Rantz did not take the six ogre arrows');
        return false;
    }
    return true;
}

function askToadies(log: (m: string) => void): Promise<boolean> {
    return talkRantz({ prefer: [TOADIES, THANKS], once: [TOADIES], ms: 60_000 }, log);
}

function showToad(log: (m: string) => void): Promise<boolean> {
    return talkRantz({ prefer: [THANKS], ms: 60_000 }, log);
}

// Why: at 40 Rantz lends the bow through a two-page choice, and at 45 with no bow he sells a replacement first — one preference list covers both, and the bow in hand is the only proof either landed.

function getBow(log: (m: string) => void): Promise<boolean> {
    return talkRantz(
        {
            expect: () => Inventory.countById(CB_ID.BOW) > 0 || Equipment.contains(CB_NAME.BOW),
            prefer: ["Yes, I'll buy the bow.", 'Come on, let me have a go', "I'm actually quite strong"],
            ms: 90_000
        },
        log
    );
}

function showChompy(log: (m: string) => void): Promise<boolean> {
    return talkRantz({ prefer: [THANKS], ms: 60_000 }, log);
}

function handOver(log: (m: string) => void): Promise<boolean> {
    return talkRantz(
        { expect: () => Inventory.countById(CB_ID.SEASONED_CHOMPY) === 0, prefer: [THANKS], ms: 90_000 },
        log
    );
}

/** The best melee kit the account owns, for the wolves that carry the arrow tips. */
function kitStep(snap: QuestSnapshot): QuestStep | null {
    const wanted = kitWanted(snap);
    if (wanted.length === 0) {
        return null;
    }
    const carried = wanted.filter(name => (snap.inv.get(name.toLowerCase()) ?? 0) > 0);
    if (carried.length > 0) {
        return custom(`wear ${carried.join(', ')}`, log => wearKit(carried, log));
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    return withdraw(wanted.map(name => ({ name, qty: 1 })));
}

// Why: the chest is a hundred tiles from the quest and the bank is four hundred, so the chest is tried first and its refusal is what pays for the booth trip.

/** The rock off the ogre chest, or the pair the account already banked. */
function bellowsStep(snap: QuestSnapshot): QuestStep | null {
    if (hasBellows(snap)) {
        return null;
    }
    if (!ChestState.refused) {
        return custom('take the ogre bellows from the chest', openChest);
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const banked = bankHasBellows(snap);
    if (banked !== null) {
        return withdraw([{ name: 'Ogre bellows', qty: 1, id: banked }]);
    }
    return { kind: 'wait', reason: 'no ogre bellows in the chest or the bank' };
}

/** Feathers, shafts and tips, with an axe in the pack and the melee kit on before the wolves. */
function fletchLeg(snap: QuestSnapshot): QuestStep | null {
    // Why: an achey tree with no axe in the pack answers nothing at all — no refusal, no message.
    const loadout = loadoutStep(snap);
    if (loadout) {
        return loadout;
    }
    const feathers = feathersStep(snap, feathersNeeded(snap));
    if (feathers) {
        return feathers;
    }
    const next = arrowStep(snap);
    if (!next) {
        return null;
    }
    return next.kind === 'custom' && next.name.includes('wolf') ? kitStep(snap) ?? next : next;
}

// Why: Bugs answers the sale with a doubleobjbox, which suspends his script on a main modal no chat driver can see.

/** Buy the knife and chisel from Bugs for ten coins. */
async function buyTools(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(CB_TILE.BUGS, 4, log))) {
        return false;
    }
    return talkBoxes(
        CB_NPC.BUGS,
        {
            expect: () => Inventory.countById(CB_ID.KNIFE) > 0 && Inventory.countById(CB_ID.CHISEL) > 0,
            prefer: ["Ok, I'll give you 10 bright pretties.", THANKS],
            ms: 60_000
        },
        log
    );
}

/** Everything the six ogre arrows need: tools, coin, feathers, shafts and tips. */
function arrowLeg(snap: QuestSnapshot): QuestStep {
    // Why: the wolves are three hundred tiles past the bank, so the kit comes off the same booth trip as the coins rather than sending the run back for it after the shops.
    const kit = kitStep(snap);
    if (kit) {
        return kit;
    }
    const loadout = loadoutStep(snap);
    if (loadout) {
        return loadout;
    }
    if (!toolsHeld(snap)) {
        // Why: Bugs sells the pair for ten coins inside the cave, which is the only tool counter this quest walks past.
        return toolStep(snap) ?? custom('buy the knife and chisel from Bugs', buyTools);
    }
    return fletchLeg(snap) ?? custom('hand Rantz the six ogre arrows', giveArrows);
}

/** The chompy has to be shot before anything else can happen; this is what makes that possible. */
function shootingLeg(snap: QuestSnapshot): QuestStep | null {
    if (!hasBow(snap)) {
        return custom('borrow the ogre bow from Rantz', getBow);
    }
    if (!hasArrows(snap)) {
        if (!toolsHeld(snap)) {
            // Why: Bugs stops selling once the arrows are handed over, so past that point the tools have to already exist.
            return toolStep(snap) ?? { kind: 'wait', reason: 'no knife or chisel to fletch more ogre arrows with' };
        }
        const fletch = fletchLeg(snap);
        if (fletch) {
            return fletch;
        }
    }
    return bellowsStep(snap);
}

/** Ask the children, carry all six seasonings, then roast. */
function cookLeg(snap: QuestSnapshot): QuestStep {
    if (!CookState.kidsAsked) {
        return custom('ask Bugs and Fycie what they want', askKids);
    }
    const seasoning = seasoningStep(snap);
    if (seasoning) {
        return seasoning;
    }
    if (heldId(snap, CB_ID.RAW_CHOMPY) === 0) {
        return shootingLeg(snap) ?? custom('shoot and pluck a chompy bird', huntChompy);
    }
    return custom('roast the chompy on the ogre spit', cookChompy);
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

    if (stage === CB_STAGE.NOT_STARTED) {
        // Why: the kit, the axe and the feathers all come from the Lumbridge side of the map, so they are fetched before the walk to the Feldip Hills rather than after it.
        return kitStep(snap)
            ?? loadoutStep(snap)
            ?? feathersStep(snap, feathersNeeded(snap))
            ?? custom("agree to make Rantz his 'stabbers'", startQuest);
    }
    if (stage === CB_STAGE.STARTED) {
        return arrowLeg(snap);
    }
    // Why: a resume past the loan finds Rantz selling the replacement bow for 500-550 coins, and he answers an empty purse with "come back when you have" — a refusal no oracle here can tell from a dropped click; the axe is left out, since only the arrow leg needs one.
    const provisions = loadoutStep(snap, false);
    if (provisions) {
        return provisions;
    }
    if (stage === CB_STAGE.GIVEN_ARROWS && heldId(snap, CB_ID.TOAD) === 0) {
        return custom('ask Rantz how to make the chompys come', askToadies);
    }
    if (stage < CB_STAGE.SHOWN_TOAD) {
        if (heldId(snap, CB_ID.TOAD) > 0) {
            return custom('show Rantz the bloated toad', showToad);
        }
        return bellowsStep(snap) ?? custom('inflate a swamp toad', catchToad);
    }
    if (stage < CB_STAGE.RANTZ_MISSED) {
        return bellowsStep(snap) ?? custom('bait the clearing and watch Rantz shoot', watchRantzShoot);
    }
    if (stage < CB_STAGE.KILLED_CHOMPY) {
        return shootingLeg(snap) ?? custom('shoot and pluck a chompy bird', huntChompy);
    }
    if (stage === CB_STAGE.KILLED_CHOMPY) {
        if (heldId(snap, CB_ID.RAW_CHOMPY) === 0) {
            return shootingLeg(snap) ?? custom('shoot and pluck a chompy bird', huntChompy);
        }
        return custom('show Rantz the raw chompy', showChompy);
    }
    if (stage === CB_STAGE.TOLD_TO_COOK) {
        return cookLeg(snap);
    }
    // Why: the spit accepts a second chompy at stage 60, so a burnt or dropped one is recoverable rather than terminal.
    if (heldId(snap, CB_ID.SEASONED_CHOMPY) === 0) {
        return cookLeg(snap);
    }
    return custom('hand Rantz the seasoned chompy', handOver);
}

function warnReadiness(): string | null {
    const gaps: string[] = [];
    if (Skills.level('crafting') < 5) {
        gaps.push('Crafting 5 (the chisel refuses wolf bones below it)');
    }
    if (Skills.level('attack') < 20 || Skills.level('strength') < 20) {
        gaps.push('a melee kit and about 40 combat (the arrow tips come off level-64 wolves)');
    }
    return gaps.length > 0 ? `untested below ${gaps.join(' and ')}` : null;
}

export const chompybird: QuestModule = {
    record: QUESTS.find(r => r.id === 'chompybird')!,
    bank: CB_TILE.YANILLE_BANK,
    ownsInventory: true,
    readProgress: readChompyProgress,
    warnReadiness,
    decide
};
