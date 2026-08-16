import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Shop } from '../../../../shop/Shop.js';
import type Tile from '../../../../../geometry/Tile.js';
import { driveUntil, settleScene } from '../../exec/prompts.js';
import { BIO_ITEM, BIO_LOC, BIO_NPC, BIO_TILE, VIALS, inGuidorQuarter, type BioItem } from './areas.js';
import { heldId, wear } from './gear.js';
import { locById, talkAt, walkTo } from './travel.js';

// Why: the first option hands the chemist the plague sample and he confiscates it, and the
// touch-paper-for-the-sample line does the same — only the Guidor errand keeps it.
const CHEMIST_PREFER = ["It's ok, I'm Elena's friend.", 'for a guy called Guidor'];
// Why: the third page comes after the stage has already moved, so a run that abandons it still
// finishes the quest — and reports the leg failed, which is a lie the next leg has to walk back.
const GUIDOR_PREFER = [
    "I've come to ask your assistance in stopping a plague.",
    "I've been sent by your old pupil Elena.",
    'So what does that mean exactly?'
];
// Why: the boys who lost a vial open a two-way choice whose branches are both harmless, and
// `talkStrict` abandons the dialogue rather than guessing.
const COLLECT_PREFER = ['No! Nothing could be further from the truth!', "I'm getting a bad feeling about this."];

interface Errand {
    npc: string;
    vial: BioItem;
    give: string;
    stand: Tile;
}

// Why: Hops drinks anything but the broline, Chancy sells anything but the honey, and DeVinci
// paints with anything but the ethenea — a wrong pairing destroys that vial.
export const ERRANDS: readonly Errand[] = [
    { npc: BIO_NPC.HOPS, vial: BIO_ITEM.SULPHURIC_BROLINE, give: 'vial of sulphuric broline', stand: BIO_TILE.HOPS },
    { npc: BIO_NPC.DEVINCI, vial: BIO_ITEM.ETHENEA, give: 'vial of ethenea', stand: BIO_TILE.DEVINCI },
    { npc: BIO_NPC.CHANCY, vial: BIO_ITEM.LIQUID_HONEY, give: 'vial of liquid honey', stand: BIO_TILE.CHANCY }
];

const PRIEST_SUIT: readonly BioItem[] = [BIO_ITEM.PRIEST_GOWN, BIO_ITEM.PRIEST_ROBE];

/** Coins in the pack below which the priest-suit float is redrawn; the halves cost ten. */
export const PRIEST_SUIT_GP = 200;

export const getTouchPaper = (log: (m: string) => void): Promise<boolean> =>
    talkAt(BIO_NPC.CHEMIST, BIO_TILE.CHEMIST, CHEMIST_PREFER, log);

/** Hand every vial still in the pack to the boy who will not ruin it. */
export async function handToErrandBoys(log: (m: string) => void): Promise<boolean> {
    let given = 0;
    for (const errand of ERRANDS) {
        if (heldId(errand.vial.id) === 0) {
            continue;
        }
        if (!(await talkAt(errand.npc, errand.stand, [errand.give], log))) {
            log(`${errand.npc} would not take the ${errand.vial.name}`);
            continue;
        }
        if (await Execution.delayUntil(() => heldId(errand.vial.id) === 0, 8000)) {
            given++;
            log(`${errand.npc} is carrying the ${errand.vial.name} to Varrock`);
        }
    }
    return given > 0;
}

/** Collect from all three at the Dancing Donkey. A boy who ruined his vial gives nothing back. */
export async function collectFromErrandBoys(log: (m: string) => void): Promise<boolean> {
    let got = 0;
    for (const errand of ERRANDS) {
        if (heldId(errand.vial.id) > 0) {
            continue;
        }
        if (!(await talkAt(errand.npc, BIO_TILE.DANCING_DONKEY, COLLECT_PREFER, log, 4))) {
            continue;
        }
        if (await Execution.delayUntil(() => heldId(errand.vial.id) > 0, 4000)) {
            got++;
        } else {
            log(`${errand.npc} did not hand back the ${errand.vial.name}`);
        }
    }
    return got > 0;
}

export async function buyPriestSuit(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(BIO_TILE.THESSALIA, 3, log))) {
        return false;
    }
    if (!(await Shop.open(BIO_NPC.THESSALIA))) {
        log(`could not open ${BIO_NPC.THESSALIA}'s shop`);
        return false;
    }
    let bought = 0;
    for (const half of PRIEST_SUIT) {
        if (heldId(half.id) > 0) {
            continue;
        }
        // Why: both halves render "Priest gown", so a name buy takes the top twice.
        bought += await Shop.buyById(half.id, 1);
    }
    await Shop.close();
    if (bought === 0) {
        log('Thessalia sold no priest gown — out of stock or out of coins');
    }
    return bought > 0;
}

/** Robe up, get past Guidor's wife, and hand the kit over. */
export async function visitGuidor(log: (m: string) => void): Promise<boolean> {
    for (const half of PRIEST_SUIT) {
        if (!(await wear(half, log))) {
            return false;
        }
    }
    if (!(await walkTo(BIO_TILE.GUIDOR_DOOR, 0, log))) {
        return false;
    }
    await settleScene();
    const door = locById(BIO_LOC.GUIDOR_DOOR, 'Open', 6);
    if (door && !(await door.interact('Open'))) {
        return false;
    }
    await Execution.delayTicks(2);
    if (!(await talkAt(BIO_NPC.GUIDOR, BIO_TILE.GUIDOR, GUIDOR_PREFER, log))) {
        return false;
    }
    return driveUntil(() => heldId(BIO_ITEM.PLAGUE_SAMPLE.id) === 0, [], log, 15_000);
}

// Why: between given_distillator and found_secret the guard stops everyone within two tiles of the gate for a two-page search, and the walker's own door crossing has no answer for either page — so this leg drives the gate itself rather than leaving it to a route.

/** Open the Varrock east gate and sit out the guard's search, in whichever direction. */
async function passVarrockGate(log: (m: string) => void): Promise<boolean> {
    const before = inGuidorQuarter(Game.tile());
    const stand = before ? BIO_TILE.GATE_INSIDE : BIO_TILE.GATE_OUTSIDE;
    const landing = before ? BIO_TILE.GATE_OUTSIDE : BIO_TILE.GATE_INSIDE;
    if (!(await walkTo(stand, 0, log))) {
        return false;
    }
    await settleScene();
    const gate = locById(BIO_LOC.VARROCK_GATE, 'Open', 6);
    if (!gate) {
        log(`no Varrock east gate at (${BIO_TILE.GATE_OUTSIDE.x},${BIO_TILE.GATE_OUTSIDE.z})`);
        return false;
    }
    if (!(await gate.interact('Open'))) {
        return false;
    }
    // Why: the search ends by teleporting onto the gate's own tile in either direction, so the
    // landing is a step clear of the gateway rather than the far side of the wall.
    await driveUntil(() => {
        const here = Game.tile();
        return here !== null && here.x !== stand.x;
    }, [], log, 25_000);
    return walkTo(landing, 0, log);
}

/** Walk into the walled quarter the gate guards, carrying nothing it would confiscate. */
export async function crossEastGate(log: (m: string) => void): Promise<boolean> {
    if (VIALS.some(vial => heldId(vial.id) > 0)) {
        log('the gate guard would take these vials — they have to go with the errand boys first');
        return false;
    }
    if (!inGuidorQuarter(Game.tile()) && !(await passVarrockGate(log))) {
        return false;
    }
    return walkTo(BIO_TILE.DANCING_DONKEY, 4, log);
}

/** Get back out to Elena or the chemist; the guard takes any vial still carried. */
export async function leaveQuarter(log: (m: string) => void): Promise<boolean> {
    if (!inGuidorQuarter(Game.tile())) {
        return true;
    }
    return passVarrockGate(log);
}
