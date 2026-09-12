import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { Skills } from '../../../../skills/Skills.js';
import { QUESTS } from '../../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { formatTile } from '../../engine/trace.js';
import { drawGear, meleeCarried, wearGear } from '../upass/supplies.js';
import {
    RG_ITEM,
    RG_MIXES,
    RG_TILE,
    carried,
    countHeld,
    held,
    regicideArea,
    type RegicideArea,
    type RegicideItem
} from './areas.js';
import {
    catchRabbit,
    cookRabbit,
    distilNaphtha,
    fillTar,
    fuseBomb,
    grindQuicklime,
    grindSulphur,
    heatQuicklime,
    mixBomb,
    takeBarrel,
    takePot,
    takeSulphur,
    weaveCloth
} from './bomb.js';
import { feedLazyGuard, fireCatapult, meetArianwyn, reportToIorwerth, reportToLathas } from './finish.js';
import { managePack, type PackPlan } from './pack.js';
import { pocketAt } from './pockets.js';
import {
    askIorwerth,
    askTracker,
    briefFromLathas,
    enterCamp,
    followTracks,
    killSoldier,
    meetScouts,
    takeSummons
} from './isafdar.js';
import { RG_FLAG, RG_STAGE, readRegicideProgress } from './journal.js';
import { enterTirannwn, leaveTirannwn } from './pass.js';
import { COAL_TARGET, KEEP_IDS, KIT, RETURN_KIT, STILL_FOOD, kitShortfall, sourceCoal, sourceKit, type Supply } from './supplies.js';

const custom = (name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep =>
    ({ kind: 'custom', name, run });

function flag(snap: QuestSnapshot, name: string): boolean {
    return snap.progress?.flags.has(name) ?? false;
}

// Why: Distillation and forest pickups need free slots; deposit only when removable items exist or the planner repeats a no-op bank step.
const SLOTS_NEEDED = 6;

/** Everything Tirannwn consumes, drawn and worn while a bank is still reachable. */
function outfit(snap: QuestSnapshot, area: RegicideArea): QuestStep | null {
    if (area !== 'mainland') {
        return null;
    }
    const junk = [...(snap.invIds ?? [])].some(([id]) => !KEEP_IDS.includes(id));
    if (junk && (snap.freeSlots ?? SLOTS_NEEDED) < SLOTS_NEEDED) {
        return { kind: 'deposit', keep: [RG_ITEM.SHARK.name], keepIds: KEEP_IDS, bank: RG_TILE.ARDOUGNE_BANK };
    }
    // Why: the armour goes on before the kit comes out. The kit is 24 of the pack's 28 slots and `wearGear` draws the set 5 pieces at a time, so sourcing first leaves 3 free slots and the withdraw never fits. Worn armour costs no slot.
    return wearGear(snap) ?? sourceKit(snap);
}

// Why: past the Arandar palisade there's one shop and no bank, and the way back in is the Underground Pass walked end to end, so a pack short of the kit stops on the mainland and says what's missing.
function readyForTirannwn(snap: QuestSnapshot, kit: readonly Supply[]): QuestStep | null {
    const missing = kitShortfall(snap, kit);
    // Why: The route crosses aggressive soldiers, elf warriors, and a grizzly bear with no equipment source beyond the gate.
    if (!meleeCarried(snap)) {
        missing.push('a melee weapon (the soldiers and the elf warriors), have none');
    }
    return missing.length === 0 ? null : { kind: 'wait', reason: `not equipped for Tirannwn: ${missing.join('; ')}` };
}

// Why: the fire arrow is built inside the pass with Koftik's damp cloth in hand, and `make_clotharrow` tests `inv_itemspace` before it deletes the cloth. 2 spare slots is the cloth and the arrow it becomes; a pack that crosses full reads "You don't have space to do that." at the bridge with no bank within an hour's walk.
const FIRE_ARROW_SLOTS = 3;

// Why: the walk back is planned. `sourceKit` only adds, so a pack that finished the still crosses carrying leftover coal and food with no room for the fire arrow. The leftovers have to be banked on the way past, which a kit list can't say and a plan can.
const returnRun = (): PackPlan => ({
    what: 'the walk back through the pass',
    allow: [],
    caps: RETURN_KIT.map(supply => ({ item: supply.item, qty: supply.qty })),
    freeNeeded: FIRE_ARROW_SLOTS
});

/** Into Tirannwn the only way it opens before the deed is done: the pass, and the Well of Voyage. */
function crossIn(snap: QuestSnapshot): QuestStep {
    const carryingBomb = held(snap, RG_ITEM.BARREL_FUSED) > 0 || held(snap, RG_ITEM.BARREL_LID) > 0;
    const kit = carryingBomb ? RETURN_KIT : KIT;
    // Why: shaped only on the mainland: from inside the pass a bank step aims the walk at Ardougne, the wrong side of every crossing already made.
    if (regicideArea(snap.tile) === 'mainland') {
        const shaped = carryingBomb ? managePack(snap, returnRun()) : sourceKit(snap, kit);
        if (shaped) {
            return shaped;
        }
    }
    return readyForTirannwn(snap, kit) ?? custom('walk the Underground Pass to the Well of Voyage', enterTirannwn);
}

function inTirannwn(snap: QuestSnapshot, area: RegicideArea, step: QuestStep): QuestStep {
    return area === 'tirannwn' ? step : crossIn(snap);
}

// The bomb

/** True once the barrel is somewhere along the naphtha chain, so a second one is not fetched. */
function barrelInPlay(snap: QuestSnapshot): boolean {
    return held(snap, RG_ITEM.BARREL_TAR) > 0
        || held(snap, RG_ITEM.BARREL_NAPHTHA) > 0
        || countHeld(snap, RG_MIXES) > 0
        || held(snap, RG_ITEM.BARREL_LID) > 0
        || held(snap, RG_ITEM.BARREL_FUSED) > 0;
}

function quicklimeDone(snap: QuestSnapshot): boolean {
    return held(snap, RG_ITEM.QUICKLIME_DUST) > 0
        || held(snap, RG_ITEM.MIX_QUICKLIME) > 0
        || held(snap, RG_ITEM.BARREL_LID) > 0
        || held(snap, RG_ITEM.BARREL_FUSED) > 0;
}

function sulphurDone(snap: QuestSnapshot): boolean {
    return held(snap, RG_ITEM.SULPHUR_DUST) > 0
        || held(snap, RG_ITEM.MIX_SULPHUR) > 0
        || held(snap, RG_ITEM.BARREL_LID) > 0
        || held(snap, RG_ITEM.BARREL_FUSED) > 0;
}

function clothDone(snap: QuestSnapshot): boolean {
    return held(snap, RG_ITEM.CLOTH) > 0 || held(snap, RG_ITEM.BARREL_FUSED) > 0;
}

function rabbitDone(snap: QuestSnapshot): boolean {
    return held(snap, RG_ITEM.RAW_RABBIT) > 0 || held(snap, RG_ITEM.COOKED_RABBIT) > 0;
}

// Why: every raw ingredient is inside Tirannwn and the still that turns tar into naphtha is in Rimmington, so the gathering finishes in one pass through the forest; the way back in is the Underground Pass, and nobody wants to walk it twice for a forgotten ball of wool.

// Why: ordered by where each thing is: the loom, the barrel and the pot are in the elf camp, the tar and the sulphur in the old camp's swamp, and the quarry on the way out to the palisade. What the forest can't finish is left for the mainland leg.

/** True once the quarry is close enough that the generic mining step can walk the rest itself. */
function nearQuarry(tile: QuestSnapshot['tile']): boolean {
    return tile !== null && tile !== undefined
        && Math.max(Math.abs(tile.x - RG_TILE.QUARRY.x), Math.abs(tile.z - RG_TILE.QUARRY.z)) <= 12;
}

/** The next thing the forest still owes the bomb, or null once the pack can leave. */
function gatherLeg(snap: QuestSnapshot): QuestStep | null {
    if (!clothDone(snap)) {
        return custom('weave the balls of wool into cloth', weaveCloth);
    }
    if (!quicklimeDone(snap) && held(snap, RG_ITEM.POT) === 0) {
        return custom('take a pot from the elf camp', takePot);
    }
    if (!barrelInPlay(snap)) {
        return held(snap, RG_ITEM.BARREL) === 0
            ? custom('take an empty barrel from the elf camp', takeBarrel)
            : custom('fill the barrel from the coal-tar seep', fillTar);
    }
    if (!rabbitDone(snap)) {
        return custom('catch a rabbit for the catapult guard', catchRabbit);
    }
    if (!sulphurDone(snap)) {
        return held(snap, RG_ITEM.SULPHUR) === 0
            ? custom('break a lump off a sulphur formation', takeSulphur)
            : custom('grind the sulphur to dust', grindSulphur);
    }
    if (!quicklimeDone(snap) && held(snap, RG_ITEM.QUICKLIME) === 0 && held(snap, RG_ITEM.LIMESTONE) === 0) {
        // Why: the quarry is on the Arandar side of the palisade and `regicideArea` still calls that Tirannwn, so the gathering leg owns it, but the walk crosses a seam. A bare `mineRock` anchors a plain `walkResilient`, which from any forest pocket answers "no path to (2323,3269): unreachable" and mines nothing.
        return nearQuarry(snap.tile)
            ? { kind: 'mineRock', rock: 'Limestone', item: RG_ITEM.LIMESTONE.name, qty: 1, anchor: RG_TILE.QUARRY }
            : custom('cross out to the Arandar quarry', log => leaveTirannwn(RG_TILE.QUARRY, snap.stage ?? RG_STAGE.SPOKEN_IORWERTH2, log));
    }
    return null;
}


// Why: the coal run carries the chain, the 2 tools that build it and a short food float. Coal doesn't stack, so the 12 the still burns want 12 slots free before the first swing, and the kit is 24 slots and leaves 4.
// Why: the room asked for is what's left to mine. Coal accumulates in the pack, so a plan still asking for 12 free once 6 are held parks a leg one swing from finishing: "needs 12 free slot(s) and the pack has 11".
const coalRun = (snap: QuestSnapshot): PackPlan => ({
    what: 'the coal run',
    allow: [
        RG_ITEM.BARREL_TAR.id, RG_ITEM.BARREL_NAPHTHA.id, RG_ITEM.CLOTH.id,
        RG_ITEM.SULPHUR_DUST.id, RG_ITEM.QUICKLIME_DUST.id, RG_ITEM.POT.id,
        RG_ITEM.COOKED_RABBIT.id, RG_ITEM.PICKAXE.id, RG_ITEM.PESTLE.id, RG_ITEM.COAL.id
    ],
    caps: [{ item: RG_ITEM.SHARK, qty: STILL_FOOD }],
    freeNeeded: Math.max(0, COAL_TARGET - carried(snap, RG_ITEM.COAL))
});

/** The chemistry the forest can't do: a furnace, a range, coal, and Rimmington's still. */
function mainlandLeg(snap: QuestSnapshot): QuestStep {
    if (held(snap, RG_ITEM.RAW_RABBIT) > 0) {
        return custom('cook the rabbit on the Ardougne range', cookRabbit);
    }
    if (!quicklimeDone(snap)) {
        return held(snap, RG_ITEM.QUICKLIME) === 0
            ? custom('burn the limestone to quicklime', heatQuicklime)
            : custom('grind the quicklime into a pot', grindQuicklime);
    }
    if (held(snap, RG_ITEM.BARREL_LID) > 0 || held(snap, RG_ITEM.BARREL_FUSED) > 0) {
        return held(snap, RG_ITEM.BARREL_FUSED) > 0
            ? crossIn(snap)
            : custom('stuff the cloth through the barrel as a fuse', fuseBomb);
    }
    if (held(snap, RG_ITEM.BARREL_NAPHTHA) > 0 || countHeld(snap, RG_MIXES) > 0) {
        return custom('mix the powders into the naphtha', mixBomb);
    }
    if (carried(snap, RG_ITEM.COAL) < COAL_TARGET) {
        const shaped = managePack(snap, coalRun(snap));
        if (shaped) {
            return shaped;
        }
    }
    return sourceCoal(snap) ?? custom('distil the coal tar into naphtha', distilNaphtha);
}

function bombLeg(snap: QuestSnapshot, area: RegicideArea): QuestStep {
    if (held(snap, RG_ITEM.BARREL_FUSED) > 0) {
        if (area !== 'tirannwn') {
            return crossIn(snap);
        }
        // Why: `regicide_cross_over3` clears `^regicide_given_rabbit` whenever it's taken inside mapsquare 34_49 and the walk from the Isafdar entry to the catapult takes that crossing, so the rabbit is handed over beside the catapult, never before setting out.
        return held(snap, RG_ITEM.COOKED_RABBIT) > 0
            ? custom('give the cooked rabbit to the catapult guard', feedLazyGuard)
            : custom('fire the barrel bomb over the trees', fireCatapult);
    }
    if (area === 'tirannwn') {
        const gather = gatherLeg(snap);
        if (gather) {
            return gather;
        }
        return custom('leave Tirannwn through the Arandar palisade', log => leaveTirannwn(RG_TILE.ARDOUGNE_BANK, RG_STAGE.SPOKEN_IORWERTH2, log));
    }
    if (area === 'mainland') {
        return mainlandLeg(snap);
    }
    return crossIn(snap);
}

function stageStep(snap: QuestSnapshot, area: RegicideArea, stage: number): QuestStep {
    // Why: armour in the pack is 5 slots the bomb needs and a soldier fought in what the walk left on, so anything wearable goes on wherever it's found. The forest has no bank to shed it into either.
    const gear = drawGear(snap);
    if (gear) {
        return gear;
    }
    switch (stage) {
        case RG_STAGE.NOT_STARTED:
            return outfit(snap, area) ?? custom("wait for the King's messenger", takeSummons);
        case RG_STAGE.RECEIVED_MESSAGE:
            return outfit(snap, area) ?? custom('take the commission from King Lathas', briefFromLathas);
        case RG_STAGE.SPOKEN_LATHAS:
            return outfit(snap, area)
                ?? inTirannwn(snap, area, custom('stand still for the elf scouts', meetScouts));
        case RG_STAGE.SPOKEN_SCOUTS:
            return inTirannwn(snap, area, custom('report to Lord Iorwerth', log => askIorwerth(stage, log)));
        case RG_STAGE.SPOKEN_IORWERTH:
            return inTirannwn(snap, area, custom('find the tracker at the old camp', log => askTracker(stage, log)));
        case RG_STAGE.SPOKEN_TRACKER:
            // Why: the tracker wants proof, and Iorwerth only hands the pendant over once he's been asked.
            return inTirannwn(
                snap,
                area,
                carried(snap, RG_ITEM.PENDANT) > 0 || flag(snap, RG_FLAG.PENDANT)
                    ? custom('show the tracker the crystal pendant', log => askTracker(stage, log))
                    : custom('ask Lord Iorwerth for a token of his trust', log => askIorwerth(stage, log))
            );
        case RG_STAGE.SHOWN_PENDANT:
            return inTirannwn(snap, area, custom('search the west end of the old camp', followTracks));
        case RG_STAGE.FOUND_FOOTPRINTS:
            return inTirannwn(snap, area, custom('ask the tracker how to follow the tracks', log => askTracker(stage, log)));
        case RG_STAGE.SPOKEN_TRACKER2:
            return inTirannwn(snap, area, custom('kill the soldier in the dense wood', killSoldier));
        case RG_STAGE.DEFEATED_GUARD:
            return inTirannwn(snap, area, custom("squeeze into King Tyras's camp", enterCamp));
        case RG_STAGE.ENTERED_CAMP:
            return inTirannwn(snap, area, custom('tell Lord Iorwerth where the camp is', log => askIorwerth(stage, log)));
        case RG_STAGE.SPOKEN_IORWERTH2:
            return bombLeg(snap, area);
        case RG_STAGE.KILLED_TYRAS:
            return inTirannwn(snap, area, custom('tell Lord Iorwerth the deed is done', reportToIorwerth));
        case RG_STAGE.REPORTED_IORWERTH:
            return area === 'tirannwn'
                ? custom('leave Tirannwn through the Arandar palisade', log => leaveTirannwn(RG_TILE.ARDOUGNE_BANK, stage, log))
                : custom('take the Ardougne road past Arianwyn', meetArianwyn);
        case RG_STAGE.SPOKEN_ARIANWYN:
            return area === 'tirannwn'
                ? custom('leave Tirannwn through the Arandar palisade', log => leaveTirannwn(RG_TILE.ARDOUGNE_BANK, stage, log))
                : custom('hand King Lathas the letter', reportToLathas);
        default:
            return { kind: 'wait', reason: `Regicide stage ${stage} is not implemented` };
    }
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    const area = regicideArea(snap.tile);
    if (area === 'unknown') {
        return { kind: 'wait', reason: 'player location unavailable' };
    }
    if (snap.journal === 'complete' || (snap.stage ?? -1) >= RG_STAGE.COMPLETE) {
        return { kind: 'done' };
    }
    if (snap.stage === undefined) {
        return { kind: 'wait', reason: 'Regicide journal stage unavailable' };
    }
    return stageStep(snap, area, snap.stage);
}

export const regicide: QuestModule = {
    record: QUESTS.find(record => record.id === 'regicide')!,
    bank: RG_TILE.ARDOUGNE_BANK,
    ownsInventory: true,
    readProgress: readRegicideProgress,
    // Why: the forest's traps are timer damage taken while crossing a chokepoint, a failed pitfall jump is a flat 15 and the tripwires poison, so the eat threshold is high.
    sustain: { foods: [RG_ITEM.SHARK.name], eatBelowHp: 0.7 },
    warnReadiness: () =>
        `Regicide needs Underground Pass complete, Agility 56 and Crafting 10, and burns about ${COAL_TARGET} coal at the still.`,
    // Why: `no inventory change` alone hid a ground-decor refusal and a missing letter, so a parked leg says where it is, what it carries that the step is keyed on, and what the server last said. The refusal is almost always already in the chat.
    // Why: 3 lines, joined: the harness surfaces a bounded number of log lines per poll, so one line per item arrives as the last line and reads as silence.
    observe: (snap, step) => {
        const at = snap.tile;
        const pocket = at && at.level === 0 ? pocketAt(at) : null;
        // Why: hand-labelled, because the 5 barrel states all begin with "Barrel" and a name-derived key prints `barrel=0 barrel=0 barrel=0`, saying nothing about where along the chain the bomb is.
        const kit = (label: string, item: RegicideItem): string => `${label}=${held(snap, item)}`;
        const said = GameMessages.recent(3).map(m => m.text).join(' / ');
        return [
            `regicide: stage=${snap.stage ?? '?'} ${formatTile(at)} area=${regicideArea(at)}${pocket ? `/${pocket}` : ''}`
                + ` step=${step.kind === 'custom' ? step.name : step.kind} free=${snap.freeSlots ?? '?'} hp=${Math.round(Skills.hpFraction() * 100)}%`,
            `regicide: ${[kit('summons', RG_ITEM.SUMMONS), kit('letter', RG_ITEM.MESSAGE), kit('pendant', RG_ITEM.PENDANT),
                kit('spade', RG_ITEM.SPADE), kit('rope', RG_ITEM.ROPE), kit('arrows', RG_ITEM.BRONZE_ARROW),
                kit('bow', RG_ITEM.SHORTBOW), kit('tinderbox', RG_ITEM.TINDERBOX), kit('coal', RG_ITEM.COAL),
                kit('rabbit', RG_ITEM.COOKED_RABBIT), kit('food', RG_ITEM.SHARK)].join(' ')}`
                + ` | bomb: ${[kit('empty', RG_ITEM.BARREL), kit('tar', RG_ITEM.BARREL_TAR), kit('naphtha', RG_ITEM.BARREL_NAPHTHA),
                    kit('lidded', RG_ITEM.BARREL_LID), kit('fused', RG_ITEM.BARREL_FUSED), kit('cloth', RG_ITEM.CLOTH),
                    kit('sulphur', RG_ITEM.SULPHUR_DUST), kit('quicklime', RG_ITEM.QUICKLIME_DUST)].join(' ')}`,
            said === '' ? 'regicide: the server has said nothing recently' : `regicide: last said — ${said}`
        ];
    },
    decide
};
