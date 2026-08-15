import type { WorldTile } from '../../../../../adapter/ClientAdapter.js';
import { QUESTS } from '../../data/quests.js';
import { flagValue, hasFlag, type QuestModule, type QuestSnapshot, type QuestStep } from '../../engine/types.js';
import { SV_ITEM, SV_TILE, shiloArea, type ShiloArea, type ShiloItem } from './areas.js';
import {
    buryZadimus,
    crossCaveIn,
    digMound,
    enterFissure,
    leaveAhZaRhoon,
    lightFissure,
    readScroll,
    ropeFissure,
    takeCrumpledScroll,
    takeTatteredScroll,
    takeZadimusCorpse
} from './ahzarhoon.js';
import {
    craftBoneBeads,
    craftBoneKey,
    craftDeadBeads,
    deliverCorpse,
    leaveBerviriusTomb,
    searchBerviriusDolmen
} from './cairn.js';
import { SV_STAGE, readShiloProgress } from './journal.js';
import {
    climbRashRocks,
    enterRashTomb,
    leaveRashTomb,
    leaveTombChamber,
    passGate,
    placeBone,
    searchCarvedDoors,
    unlockCarvedDoors,
    workTheDolmen
} from './rashtomb.js';
import { startQuest, takeWampumBelt } from './start.js';
import {
    KARAMJA_PURSE,
    QUEST_FOOD,
    banked,
    held,
    owned,
    sourceBones,
    sourceBronzeWire,
    sourceCoins,
    sourceFood,
    sourceLitCandle,
    sourceTools,
    withdrawFrom,
    worn
} from './supplies.js';

/** Three recesses in the tomb door, one bone each. */
const TOMB_BONES = 3;

/** Enough to survive a Nazastarool phase and the Undead Ones between them. */
const TOMB_FOOD = 8;

// Why: Jiminua bakes ten loaves at a time and the stock drains, so insisting on the full eight would send the bot back for the last two while the oven catches up.
// Why: below this the tomb is not worth entering.
const TOMB_FOOD_MIN = 4;

// Why: everything the quest needs is on the island except coins and bones, and there is no bank here until the quest itself opens Shilo's.
// Why: provisioning therefore only runs while still on the mainland.

/** True while on Karamja, generously bounded. */
function onKaramja(tile: WorldTile | null | undefined): boolean {
    if (!tile) {
        return false;
    }
    return tile.x >= 2735 && tile.x <= 3010 && tile.z >= 2870 && tile.z <= 3245;
}

function step(name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep {
    return { kind: 'custom', name, run };
}

// Why: every sealed pocket is left the way it was entered before any step that assumes open ground.
// Why: a branch that skips this sends the walker at a tile on the wrong side of a one-way crossing and spends three passes proving it unreachable.

/** A step out of the current sealed pocket, or null when on open ground. */
function escapePocket(area: ShiloArea): QuestStep | null {
    switch (area) {
        case 'ahZaRhoonNorth':
        case 'ahZaRhoonSouth':
            return step('climb out of Ah Za Rhoon', leaveAhZaRhoon);
        case 'berviriusTomb':
            return step("climb out of Bervirius' tomb", leaveBerviriusTomb);
        case 'rashInner':
            return step('leave the tomb chamber', leaveTombChamber);
        case 'rashLedge':
            return step('open the ancient gate back out', log => passGate('out', log));
        case 'rashEntry':
            return step("unlock Rashiliyia's tomb exit", leaveRashTomb);
        default:
            return null;
    }
}

/** Take `stepIfOpen` only once we are somewhere it can start from. */
function inTheOpen(area: ShiloArea, stepIfOpen: QuestStep): QuestStep {
    return escapePocket(area) ?? stepIfOpen;
}

/**
 * For steps that enter their own pocket. Escaping unconditionally would climb
 * straight back out of the tomb the step walked into, forever.
 */
function inTheOpenOrIn(area: ShiloArea, ownPocket: ShiloArea, stepIfOk: QuestStep): QuestStep {
    return area === ownPocket ? stepIfOk : inTheOpen(area, stepIfOk);
}

// Why: coins and bones are the only things this quest cannot buy on Karamja, and the nearest bank is an ocean away.
// Why: both are therefore settled before the crossing and never mid-quest, unless something is lost.

/** Provision coins and bones before the crossing, or null. */
function provision(snap: QuestSnapshot, area: ShiloArea): QuestStep | null {
    if (area !== 'karamja' || onKaramja(snap.tile)) {
        return null;
    }
    return sourceCoins(snap, KARAMJA_PURSE) ?? sourceBones(snap, TOMB_BONES);
}

/** Bank-first for anything the quest may have left behind on a previous run. */
function recoverFromBank(snap: QuestSnapshot, item: { id: number; name: string }): QuestStep | null {
    if (held(snap, item.id) > 0 || banked(snap, item.id) === 0) {
        return null;
    }
    return withdrawFrom([{ name: item.name, id: item.id, qty: 1 }]);
}

function stageStart(snap: QuestSnapshot, area: ShiloArea): QuestStep {
    if (held(snap, SV_ITEM.WAMPUM_BELT.id) > 0) {
        return inTheOpen(area, step('show the Wampum belt to Trufitus', startQuest));
    }
    return recoverFromBank(snap, SV_ITEM.WAMPUM_BELT)
        ?? inTheOpen(area, step('ask Mosol Rei for the Wampum belt', takeWampumBelt));
}

/**
 * Everything Jiminua stocks that the rest of the quest still wants, so one shop trip
 * covers the fissure sequence and both crafts instead of six island crossings.
 */
function toolsFrom(stage: number): ShiloItem[] {
    const need: ShiloItem[] = [];
    if (stage <= SV_STAGE.SEARCHED_MOUND) need.push(SV_ITEM.SPADE);
    if (stage <= SV_STAGE.DUG_MOUND) need.push(SV_ITEM.CANDLE, SV_ITEM.TINDERBOX);
    if (stage <= SV_STAGE.LIT_MOUND) need.push(SV_ITEM.ROPE);
    need.push(SV_ITEM.CHISEL, SV_ITEM.BRONZE_BAR, SV_ITEM.HAMMER);
    return need;
}

function stageMound(snap: QuestSnapshot, area: ShiloArea): QuestStep {
    const kit = sourceTools(snap, toolsFrom(SV_STAGE.STARTED));
    return kit ? inTheOpen(area, kit) : inTheOpen(area, step('dig the mound of earth open', digMound));
}

function stageLight(snap: QuestSnapshot, area: ShiloArea): QuestStep {
    const candle = sourceLitCandle(snap, toolsFrom(SV_STAGE.DUG_MOUND));
    return candle
        ? inTheOpen(area, candle)
        : inTheOpen(area, step('drop a lit candle into the fissure', lightFissure));
}

function stageRope(snap: QuestSnapshot, area: ShiloArea): QuestStep {
    const kit = sourceTools(snap, toolsFrom(SV_STAGE.LIT_MOUND));
    return kit ? inTheOpen(area, kit) : inTheOpen(area, step('tie the rope to the fissure', ropeFissure));
}

// Why: engine stages 7 to 9 all render the same journal block until the Bervirius dolmen is searched.
// Why: this branch is therefore driven by flags and by what is carried rather than by the stage number.

/** The next step for the stage 7-9 block. */
function stageMiddle(snap: QuestSnapshot, area: ShiloArea): QuestStep {
    const inCaves = area === 'ahZaRhoonNorth' || area === 'ahZaRhoonSouth';

    if (!hasFlag(snap.progress, 'pommel-taken')) {
        // Why: both scroll bits are read off the journal only while this block renders, and after the dolmen they vanish while the necklace craft still needs one of them.
        // Why: reading is idempotent, so it happens the moment a scroll is held.
        if (!hasFlag(snap.progress, 'read-tattered')) {
            if (held(snap, SV_ITEM.TATTERED_SCROLL.id) > 0) {
                return step('read the tattered scroll', readScroll(SV_ITEM.TATTERED_SCROLL.id));
            }
            return step('find the tattered scroll behind the loose rocks', takeTatteredScroll);
        }
        if (!hasFlag(snap.progress, 'read-crumpled')) {
            if (held(snap, SV_ITEM.CRUMPLED_SCROLL.id) > 0) {
                return step('read the crumpled scroll', readScroll(SV_ITEM.CRUMPLED_SCROLL.id));
            }
            return step('search the old sacks for the crumpled scroll', takeCrumpledScroll);
        }
        if (held(snap, SV_ITEM.BONE_SHARD.id) === 0 && held(snap, SV_ITEM.BONE_KEY.id) === 0) {
            if (held(snap, SV_ITEM.ZADIMUS_CORPSE.id) > 0) {
                return inTheOpen(area, step("bury Zadimus on Tai Bwo Wannai's sacred ground", buryZadimus));
            }
            return step('take the corpse from the ancient gallows', takeZadimusCorpse);
        }
        return inTheOpenOrIn(area, 'berviriusTomb', step("search the dolmen in Bervirius' tomb", searchBerviriusDolmen));
    }

    if (inCaves) {
        return step('climb out of Ah Za Rhoon', leaveAhZaRhoon);
    }

    if (!hasFlag(snap.progress, 'found-door')) {
        return inTheOpen(area, step('search the carved doors for their lock', searchCarvedDoors));
    }

    const craft = craftChain(snap, area, true);
    if (craft) {
        return craft;
    }
    return inTheOpen(area, step('unlock the carved doors with the bone key', unlockCarvedDoors));
}

/**
 * The necklace and the key share a chisel and both are refused until their own bit
 * is set — the crumpled scroll for the beads, the searched door for the key.
 */
function craftChain(snap: QuestSnapshot, area: ShiloArea, wantKey: boolean): QuestStep | null {
    // Why: past the carved doors the key is optional, as they stay unlocked and the tomb exit refuses to open for anyone still carrying it.
    // Why: demanding a replacement there would send the bot back to the gallows for nothing.
    const needKey = wantKey && held(snap, SV_ITEM.BONE_KEY.id) === 0;
    const needBeads = owned(snap, SV_ITEM.DEAD_BEADS.id) === 0 && !worn(snap, SV_ITEM.DEAD_BEADS.id);
    if (!needKey && !needBeads) {
        return null;
    }
    // One trip: the chisel cuts both the key and the beads, and the bar and hammer
    // are the necklace's wire.
    const need: ShiloItem[] = [SV_ITEM.CHISEL];
    if (needBeads && held(snap, SV_ITEM.BRONZE_WIRE.id) === 0) {
        need.push(SV_ITEM.BRONZE_BAR, SV_ITEM.HAMMER);
    }
    const kit = sourceTools(snap, need);
    if (kit) {
        return inTheOpen(area, kit);
    }
    if (needKey) {
        if (held(snap, SV_ITEM.BONE_SHARD.id) === 0) {
            return recoverFromBank(snap, SV_ITEM.BONE_SHARD)
                ?? step('take the corpse from the ancient gallows', takeZadimusCorpse);
        }
        return step('cut the bone shard into a key', craftBoneKey);
    }
    if (held(snap, SV_ITEM.BONE_BEADS.id) === 0) {
        if (held(snap, SV_ITEM.SWORD_POMMEL.id) === 0) {
            return recoverFromBank(snap, SV_ITEM.SWORD_POMMEL)
                ?? inTheOpenOrIn(area, 'berviriusTomb', step("search the dolmen in Bervirius' tomb", searchBerviriusDolmen));
        }
        return step('carve the ivory pommel into beads', craftBoneBeads);
    }
    const wire = sourceBronzeWire(snap);
    return wire ? inTheOpen(area, wire) : step('thread the beads into the Beads of the Dead', craftDeadBeads);
}

/** How many recesses are still empty, per the journal. */
function bonesWanted(snap: QuestSnapshot): number {
    return Math.max(0, TOMB_BONES - (flagValue(snap.progress, 'bones-placed') ?? 0));
}

/** Nothing can be fetched from inside, so the bones and the food go in with us. */
function tombSupplies(snap: QuestSnapshot, bones: number): QuestStep | null {
    const carried = snap.inv.get(QUEST_FOOD.toLowerCase()) ?? 0;
    const food = carried < TOMB_FOOD_MIN ? sourceFood(snap, TOMB_FOOD) : null;
    return (bones > 0 ? sourceBones(snap, bones) : null) ?? food;
}

/**
 * Beads on before anything else: the gate summons Rashiliyia rather than opening
 * for anyone without them, and she does not stop at the gate.
 */
function needBeads(snap: QuestSnapshot, area: ShiloArea): QuestStep | null {
    if (worn(snap, SV_ITEM.DEAD_BEADS.id)) {
        return null;
    }
    if (held(snap, SV_ITEM.DEAD_BEADS.id) > 0) {
        return { kind: 'equip', item: SV_ITEM.DEAD_BEADS.name };
    }
    return recoverFromBank(snap, SV_ITEM.DEAD_BEADS)
        ?? craftChain(snap, area, false)
        ?? { kind: 'wait', reason: 'no Beads of the Dead to wear' };
}

/** Engine stages 10 and 11: through the hillside doors, past the gate, down the rocks. */
function stageTomb(snap: QuestSnapshot, area: ShiloArea): QuestStep {
    const craft = craftChain(snap, area, false);
    if (craft) {
        return craft;
    }
    const beads = needBeads(snap, area);
    if (beads) {
        return beads;
    }
    const wanted = bonesWanted(snap);
    // Bones come from Ardougne, so being short inside the tomb means walking all
    // the way back out rather than looping at a door that will not open.
    if (held(snap, SV_ITEM.BONES.id) < wanted && area !== 'karamja') {
        return escapePocket(area) ?? { kind: 'wait', reason: 'short of bones and nowhere to go' };
    }
    if (area === 'rashInner') {
        // The third bone opens the doors and pushes us through by itself, so there
        // is nothing left to do here once the journal has caught up.
        return wanted > 0
            ? step('place a bone in the tomb door', placeBone)
            : { kind: 'wait', reason: 'all three bones are placed — waiting for the journal' };
    }
    if (area === 'rashLedge') {
        return step('climb down to the tomb chamber', log => climbRashRocks('down', log));
    }
    if (area === 'rashEntry') {
        return step('open the ancient gate', log => passGate('in', log));
    }
    const supplies = tombSupplies(snap, wanted);
    if (supplies) {
        return inTheOpen(area, supplies);
    }
    return inTheOpen(area, step("enter Rashiliyia's tomb", enterRashTomb));
}

/** Engine stages 12 and 14: the three Nazastarool forms, then the remains. */
function stageBoss(snap: QuestSnapshot, area: ShiloArea): QuestStep {
    if (owned(snap, SV_ITEM.RASH_CORPSE.id) > 0) {
        if (held(snap, SV_ITEM.RASH_CORPSE.id) === 0) {
            return recoverFromBank(snap, SV_ITEM.RASH_CORPSE) ?? { kind: 'wait', reason: 'the remains are unreachable' };
        }
        return inTheOpenOrIn(area, 'berviriusTomb', step("lay the remains on Bervirius' dolmen", deliverCorpse));
    }
    if (area === 'rashInner') {
        return step('search the tomb dolmen', workTheDolmen);
    }
    if (area === 'rashLedge') {
        return step('climb down to the tomb chamber', log => climbRashRocks('down', log));
    }
    if (area === 'rashEntry') {
        return step('open the ancient gate', log => passGate('in', log));
    }
    const beads = needBeads(snap, area);
    if (beads) {
        return beads;
    }
    const supplies = tombSupplies(snap, 0);
    if (supplies) {
        return inTheOpen(area, supplies);
    }
    return inTheOpen(area, step("enter Rashiliyia's tomb", enterRashTomb));
}

export function decide(snap: QuestSnapshot): QuestStep {
    const area = shiloArea(snap.tile);

    if (snap.journal === 'complete' || (snap.stage ?? -1) >= SV_STAGE.COMPLETE) {
        return escapePocket(area) ?? { kind: 'done' };
    }
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    if (snap.stage === undefined) {
        return { kind: 'wait', reason: 'Shilo Village journal stage unavailable' };
    }
    if (area === 'unknown') {
        return { kind: 'wait', reason: 'player location unavailable' };
    }

    const supplies = provision(snap, area);
    if (supplies) {
        return supplies;
    }

    switch (snap.stage) {
        case SV_STAGE.NOT_STARTED:
            return stageStart(snap, area);

        case SV_STAGE.STARTED:
        case SV_STAGE.SEARCHED_MOUND:
            return stageMound(snap, area);

        case SV_STAGE.DUG_MOUND:
            return stageLight(snap, area);

        case SV_STAGE.LIT_MOUND:
            return stageRope(snap, area);

        case SV_STAGE.ROPED_MOUND:
            return inTheOpen(area, step('climb down the fissure into Ah Za Rhoon', enterFissure));

        case SV_STAGE.ENTERED_AH_ZA_RHOON:
            return stageMiddle(snap, area);

        case SV_STAGE.UNLOCKED_RASH_TOMB:
            return stageTomb(snap, area);

        case SV_STAGE.UNLOCKED_TOMBDOOR:
            return stageBoss(snap, area);

        default:
            return { kind: 'wait', reason: `Shilo Village stage ${snap.stage} is not implemented` };
    }
}

export const shilo: QuestModule = {
    record: QUESTS.find(record => record.id === 'zombiequeen')!,
    bank: SV_TILE.ARDOUGNE_BANK,
    ownsInventory: true,
    readProgress: readShiloProgress,
    sustain: { foods: [QUEST_FOOD, 'Lobster', 'Swordfish', 'Tuna'], eatBelowHp: 0.6 },
    decide
};

export { crossCaveIn, onKaramja };
