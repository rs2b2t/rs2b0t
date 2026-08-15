import { QUESTS } from '../../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { PC_ITEM, PC_TILE, held, owned, plagueArea, worn, type PlagueArea } from './areas.js';
import { PC_STAGE, readPlagueProgress } from './journal.js';
import {
    askAboutDigging,
    fillBuckets,
    giveDwellberries,
    pourWater,
    pullTheGrill,
    readScroll,
    searchCupboard,
    startQuest,
    thankEdmond,
    tieRope
} from './east.js';
import { goEast, goSewer, goWest } from './travel.js';
import {
    askAboutClearance,
    askMilli,
    askParents,
    getAudience,
    giveHangoverCure,
    rescueElena,
    enterRehnisons,
    showPicture
} from './west.js';
import {
    BUCKET_TARGET,
    reclaim,
    scanBank,
    sourceBucket,
    sourceChocolateBar,
    sourceDwellberries,
    sourceMilk,
    sourcePestle,
    sourcePicture,
    sourceRope,
    sourceShoppingFloat,
    sourceSnapeGrass,
    sourceSpade,
    withdrawFrom
} from './supplies.js';

const KEEP_IDS: readonly number[] = Object.values(PC_ITEM).map(item => item.id);

const TIDY_FLOOR = 4;

const custom = (name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep =>
    ({ kind: 'custom', name, run });

const TO_EAST = custom('walk back to East Ardougne', goEast);
const TO_WEST = custom('cross into West Ardougne', goWest);
const TO_SEWER = custom('drop into the Ardougne sewer', goSewer);

/** Bank spillover before a leg that has to pick something up. */
function tidy(snap: QuestSnapshot, area: PlagueArea): QuestStep | null {
    if (area !== 'east' || (snap.freeSlots ?? 28) >= TIDY_FLOOR) {
        return null;
    }
    return { kind: 'deposit', keep: [], keepIds: KEEP_IDS, bank: PC_TILE.BANK };
}

function sourceGasMask(snap: QuestSnapshot): QuestStep | null {
    if (held(snap, PC_ITEM.GAS_MASK) > 0 || worn(snap, PC_ITEM.GAS_MASK)) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    if (owned(snap, PC_ITEM.GAS_MASK) > 0) {
        return withdrawFrom([{ name: PC_ITEM.GAS_MASK.name, id: PC_ITEM.GAS_MASK.id, qty: 1 }]);
    }
    return custom("search Alrena's cupboard for the spare gas mask", searchCupboard);
}

/** The kit every crossing into West Ardougne needs: a spade for the garden, a mask for the pipe. */
function westKit(snap: QuestSnapshot): QuestStep | null {
    return sourceGasMask(snap) ?? sourceSpade(snap);
}

function inEast(area: PlagueArea, step: QuestStep): QuestStep {
    return area === 'east' ? step : TO_EAST;
}

function inSewer(snap: QuestSnapshot, area: PlagueArea, step: QuestStep): QuestStep {
    if (area === 'sewer') {
        return step;
    }
    return area === 'east' ? (sourceSpade(snap) ?? TO_SEWER) : TO_SEWER;
}

function inWest(snap: QuestSnapshot, area: PlagueArea, step: QuestStep): QuestStep {
    if (area === 'west') {
        return step;
    }
    return area === 'east' ? (westKit(snap) ?? TO_WEST) : TO_WEST;
}

// Why: the four buckets are gathered before the fountain, so the leg is one fill trip and one
// pour trip — filling whatever is in the pack sends the bot back for the next three pours.
function waterLeg(snap: QuestSnapshot, area: PlagueArea): QuestStep {
    const empty = held(snap, PC_ITEM.BUCKET);
    const water = held(snap, PC_ITEM.BUCKET_WATER);
    if (water > 0 && empty === 0) {
        return inEast(area, custom('pour water on the garden soil', pourWater));
    }
    if (water + empty >= BUCKET_TARGET) {
        return inEast(area, custom('fill buckets at the Ardougne fountain', fillBuckets));
    }
    const more = sourceBucket(snap, BUCKET_TARGET - water);
    return inEast(area, more ?? { kind: 'wait', reason: 'no bucket for the garden soil' });
}

// Why: the cow field, the snape grass spawns, Taverley and Port Sarim are one eastward
// loop, so every raw ingredient is gathered before the first mix rather than between them.
function cureLeg(snap: QuestSnapshot, area: PlagueArea): QuestStep | null {
    if (held(snap, PC_ITEM.HANGOVER_CURE) > 0) {
        return null;
    }
    if (held(snap, PC_ITEM.CHOCOLATY_MILK) > 0) {
        return inEast(area, sourceSnapeGrass(snap) ?? mix(PC_ITEM.SNAPE_GRASS, PC_ITEM.CHOCOLATY_MILK, PC_ITEM.HANGOVER_CURE));
    }
    if (held(snap, PC_ITEM.CHOCOLATE_DUST) > 0) {
        return inEast(area, sourceMilk(snap) ?? mix(PC_ITEM.CHOCOLATE_DUST, PC_ITEM.BUCKET_MILK, PC_ITEM.CHOCOLATY_MILK));
    }
    const raw = sourceShoppingFloat(snap)
        ?? sourceMilk(snap)
        ?? sourceSnapeGrass(snap)
        ?? sourcePestle(snap)
        ?? sourceChocolateBar(snap);
    return inEast(area, raw ?? mix(PC_ITEM.PESTLE, PC_ITEM.CHOCOLATE_BAR, PC_ITEM.CHOCOLATE_DUST));
}

function mix(item: { name: string }, target: { name: string }, product: { name: string }): QuestStep {
    return {
        kind: 'useOn',
        item: item.name,
        targetKind: 'item',
        target: target.name,
        anchor: PC_TILE.BANK,
        product: product.name
    };
}

function stageStep(snap: QuestSnapshot, area: PlagueArea, stage: number): QuestStep {
    switch (stage) {
        // Why: the float comes out on the opening bank trip, so the rope, pestle and chocolate
        // bar are bought where the walk already passes rather than off a later detour.
        case PC_STAGE.NOT_STARTED:
            return inEast(area, sourceShoppingFloat(snap) ?? custom('ask Edmond about his daughter', startQuest));
        case PC_STAGE.STARTED:
            return inEast(area, sourceDwellberries(snap) ?? custom('give Alrena the dwellberries', giveDwellberries));
        case PC_STAGE.GASMASK:
            return inEast(area, custom('ask Edmond about the way into West Ardougne', askAboutDigging));
        case PC_STAGE.MUD_START:
            return waterLeg(snap, area);
        // Why: the rope is only needed below, but it is bought up here, or the bot climbs back out of the sewer for it.
        case PC_STAGE.MUD_SOFT:
            return area === 'east' ? (sourceSpade(snap) ?? sourceRope(snap) ?? TO_SEWER) : TO_SEWER;
        case PC_STAGE.TUNNEL: {
            const rope = sourceRope(snap);
            return rope
                ? inEast(area, rope)
                : inSewer(snap, area, custom('tie the rope to the sewer grill', tieRope));
        }
        case PC_STAGE.ROPE_TIED:
            return inSewer(snap, area, custom('pull the grill off with Edmond', pullTheGrill));
        case PC_STAGE.PIPE_OPEN: {
            const picture = sourcePicture(snap);
            return picture
                ? inEast(area, picture)
                : inWest(snap, area, custom("show Jethick Elena's picture", showPicture));
        }
        case PC_STAGE.SHOWN_PICTURE: {
            const book = reclaim(snap, PC_ITEM.TURNIP_BOOK);
            return book
                ? inEast(area, book)
                : inWest(snap, area, custom('get into the Rehnison house and ask about Elena', enterRehnisons));
        }
        case PC_STAGE.RETURNED_BOOK:
            return inWest(snap, area, custom('ask the Rehnisons about Elena', askParents));
        case PC_STAGE.SPOKEN_PARENTS:
            return inWest(snap, area, custom('ask Milli what she saw', askMilli));
        case PC_STAGE.SPOKEN_MILLI:
            return inWest(snap, area, custom('ask the mourner about the plague house', askAboutClearance));
        case PC_STAGE.NEED_CLEARANCE:
        case PC_STAGE.SPOKEN_CLERK:
            return inWest(snap, area, custom('get an audience with Bravek', getAudience));
        case PC_STAGE.SPOKEN_BRAVEK:
            return cureLeg(snap, area) ?? inWest(snap, area, custom('give Bravek the hangover cure', giveHangoverCure));
        case PC_STAGE.CURED_BRAVEK: {
            const warrant = reclaim(snap, PC_ITEM.WARRANT);
            if (warrant) {
                return inEast(area, warrant);
            }
            return held(snap, PC_ITEM.WARRANT) > 0
                ? inWest(snap, area, custom('free Elena from the plague house', rescueElena))
                : inWest(snap, area, custom('ask Bravek for another warrant', giveHangoverCure));
        }
        case PC_STAGE.FREED_ELENA:
            return inEast(area, custom('tell Edmond his daughter is safe', thankEdmond));
        default:
            return { kind: 'wait', reason: `Plague City stage ${stage} is not implemented` };
    }
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    const area = plagueArea(snap.tile);
    if (area === 'unknown') {
        return { kind: 'wait', reason: 'player location unavailable' };
    }
    if (snap.journal === 'complete' || (snap.stage ?? -1) >= PC_STAGE.COMPLETE) {
        if (area !== 'east') {
            return TO_EAST;
        }
        return held(snap, PC_ITEM.ARDOUGNE_SCROLL) > 0
            ? custom('read the Ardougne teleport scroll', readScroll)
            : { kind: 'done' };
    }
    if (snap.stage === undefined) {
        return { kind: 'wait', reason: 'Plague City journal stage unavailable' };
    }
    return tidy(snap, area) ?? stageStep(snap, area, snap.stage);
}

async function exitPlagueCity(log: (m: string) => void): Promise<boolean> {
    if (!(await goEast(log))) {
        return false;
    }
    return readScroll(log);
}

export const plaguecity: QuestModule = {
    record: QUESTS.find(record => record.id === 'elena')!,
    bank: PC_TILE.BANK,
    ownsInventory: true,
    readProgress: readPlagueProgress,
    exit: exitPlagueCity,
    decide
};
