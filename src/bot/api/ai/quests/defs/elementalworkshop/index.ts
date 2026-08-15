import { QUESTS } from '../../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { hasFlag } from '../../engine/types.js';
import {
    EW_ITEM,
    KNIFE_SPAWN,
    SEERS_BANK,
    ewArea
} from './areas.js';
import { EW_FLAG, EW_STAGE, readElementalWorkshopProgress } from './journal.js';
import {
    COAL_NEED,
    bestBankWeapon,
    bestHeldPickaxe,
    fromBank,
    hasHeldSlashTool,
    hasPickaxe,
    held,
    surfaceLoadout,
    warnElementalWorkshopReadiness
} from './supplies.js';
import {
    enterWorkshop,
    fixBellows,
    leaveWorkshop,
    lightFurnace,
    mineElementalOre,
    readBatteredBook,
    searchBookcase,
    searchCratesFor,
    slashBookForKey,
    smeltElementalBar,
    smithElementalShield,
    startWaterWheel
} from './workshop.js';

function custom(name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep {
    return { kind: 'custom', name, run };
}

function needSmeltMaterials(snap: QuestSnapshot): boolean {
    return held(snap, EW_ITEM.ELEMENTAL_METAL.id) === 0
        && held(snap, EW_ITEM.ELEMENTAL_SHIELD.id) === 0;
}

function needBellowsWork(snap: QuestSnapshot): boolean {
    return !hasFlag(snap.progress, EW_FLAG.BELLOWS);
}

function needWaterWork(snap: QuestSnapshot): boolean {
    return !hasFlag(snap.progress, EW_FLAG.WATER);
}

function needFurnaceWork(snap: QuestSnapshot): boolean {
    return !hasFlag(snap.progress, EW_FLAG.FURNACE);
}

function sourceKnife(snap: QuestSnapshot): QuestStep | null {
    // useOn needs a pack item — worn-only does not count (slashBookForKey unequips if needed).
    if (held(snap, EW_ITEM.BATTERED_KEY.id) > 0 || hasHeldSlashTool(snap)) {
        return null;
    }
    // Bank first (knife or any slash weapon from e.g. bank_f2p / realistic seed), then ground.
    const bankWeapon = bestBankWeapon(snap);
    return fromBank(snap, EW_ITEM.KNIFE, 1)
        ?? (bankWeapon ? fromBank(snap, bankWeapon, 1) : null)
        ?? { kind: 'grabGround', item: EW_ITEM.KNIFE.name, anchor: KNIFE_SPAWN, waitIfMissing: true };
}

// Why: the flow runs not started → bookcase → read book → knife → slash for key → surface loadout → enter workshop → water valves and lever → crate supplies → fix bellows → light furnace → mine ore → smelt (air lever and furnace) → smith shield.

/** Pure decide over journal stage, flags and held items; never reads varps. */
export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') {
        return { kind: 'done' };
    }
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }

    const stage = snap.progress?.stage ?? snap.stage;
    if (stage === undefined) {
        return { kind: 'wait', reason: 'Elemental Workshop stage unavailable' };
    }
    if (stage === EW_STAGE.COMPLETE) {
        return { kind: 'done' };
    }

    const area = ewArea(snap.tile);

    // --- Start: book ---
    if (stage === EW_STAGE.NOT_STARTED) {
        if (held(snap, EW_ITEM.BATTERED_BOOK.id) === 0) {
            if (area === 'workshop') {
                return custom('leave workshop for the bookcase', leaveWorkshop);
            }
            return fromBank(snap, EW_ITEM.BATTERED_BOOK, 1)
                ?? custom('search Seers bookcase for the Battered book', searchBookcase);
        }
        return custom('read the Battered book', readBatteredBook);
    }

    // --- Key from book spine ---
    if (held(snap, EW_ITEM.BATTERED_KEY.id) === 0 && stage < EW_STAGE.ENTERED) {
        if (held(snap, EW_ITEM.BATTERED_BOOK.id) === 0) {
            return fromBank(snap, EW_ITEM.BATTERED_BOOK, 1)
                ?? custom('search Seers bookcase for the Battered book', searchBookcase);
        }
        const knife = sourceKnife(snap);
        if (knife) {
            return knife;
        }
        return custom('slash the Battered book for the key', slashBookForKey);
    }

    // Once we have the bar or shield, finish at the workbench (or leave if missing tools).
    if (held(snap, EW_ITEM.ELEMENTAL_SHIELD.id) > 0) {
        // Making the shield completes the quest server-side; wait for journal.
        return { kind: 'wait', reason: 'waiting for Elemental Workshop quest complete' };
    }

    if (held(snap, EW_ITEM.ELEMENTAL_METAL.id) > 0) {
        if (area !== 'workshop') {
            if (held(snap, EW_ITEM.BATTERED_BOOK.id) === 0 || held(snap, EW_ITEM.HAMMER.id) === 0) {
                const load = surfaceLoadout(snap, false, false);
                if (load) {
                    return load;
                }
            }
            return custom('re-enter the workshop to smith the shield', enterWorkshop);
        }
        if (held(snap, EW_ITEM.BATTERED_BOOK.id) === 0) {
            return custom('leave workshop for the Battered book', leaveWorkshop);
        }
        if (held(snap, EW_ITEM.HAMMER.id) === 0) {
            return custom('leave workshop for a Hammer', leaveWorkshop);
        }
        return custom('smith the Elemental shield', smithElementalShield);
    }

    // Surface provisioning before first entry (and when forced out for missing tools / death).
    if (area !== 'workshop') {
        // First open needs the Battered key. After ENTERED, Push works without it
        // (death piles often leave the key in Lumbridge — re-bank/withdraw if held).
        if (held(snap, EW_ITEM.BATTERED_KEY.id) === 0) {
            const bankKey = fromBank(snap, EW_ITEM.BATTERED_KEY, 1);
            if (bankKey) {
                return bankKey;
            }
            if (stage < EW_STAGE.ENTERED) {
                return { kind: 'wait', reason: 'need the Battered key to open the smithy wall' };
            }
            // Stage already entered: enterWorkshop will Push the odd wall.
        }
        // Before entered, journal has no machinery flags — assume all workshop work remains.
        const bellows = stage < EW_STAGE.ENTERED || needBellowsWork(snap);
        const smelt = stage < EW_STAGE.ENTERED || needSmeltMaterials(snap);
        const load = surfaceLoadout(snap, bellows, smelt);
        if (load) {
            return load;
        }
        if (!hasPickaxe(snap) && needSmeltMaterials(snap)) {
            return { kind: 'wait', reason: 'need a pickaxe before entering the Elemental Workshop' };
        }
        return custom('enter the Elemental Workshop', enterWorkshop);
    }

    // --- Inside workshop ---

    if (needWaterWork(snap)) {
        return custom('start the water wheel', startWaterWheel);
    }

    if (needBellowsWork(snap)) {
        const needLeather = held(snap, EW_ITEM.LEATHER.id) === 0;
        const needNeedle = held(snap, EW_ITEM.NEEDLE.id) === 0;
        if (needLeather || needNeedle) {
            return custom('search crates for leather/needle', log =>
                searchCratesFor({ bowl: false, leather: needLeather, needle: needNeedle }, log));
        }
        if (held(snap, EW_ITEM.THREAD.id) === 0) {
            return custom('leave workshop for Thread', leaveWorkshop);
        }
        return custom('fix the bellows', fixBellows);
    }

    if (needFurnaceWork(snap)) {
        if (held(snap, EW_ITEM.STONE_BOWL.id) === 0 && held(snap, EW_ITEM.STONE_BOWL_FULL.id) === 0) {
            return custom('search crates for a stone bowl', log =>
                searchCratesFor({ bowl: true, leather: false, needle: false }, log));
        }
        return custom('light the furnace with lava', lightFurnace);
    }

    // Mine / smelt
    if (held(snap, EW_ITEM.ELEMENTAL_ORE.id) === 0) {
        if (!hasPickaxe(snap) && !bestHeldPickaxe(snap)) {
            return custom('leave workshop for a pickaxe', leaveWorkshop);
        }
        return custom('mine Elemental ore from the Earth elemental', mineElementalOre);
    }

    if (held(snap, EW_ITEM.COAL.id) < COAL_NEED) {
        return custom('leave workshop for Coal', leaveWorkshop);
    }

    return custom('smelt Elemental metal at the furnace', smeltElementalBar);
}

export const elementalworkshop: QuestModule = {
    record: QUESTS.find(r => r.id === 'elemental_workshop')!,
    bank: SEERS_BANK,
    ownsInventory: true,
    tools: ['knife', 'hammer', 'needle', 'thread', 'leather', 'coal', 'battered book', 'battered key'],
    readProgress: readElementalWorkshopProgress,
    sustain: { foods: ['Swordfish', 'Lobster', 'Salmon', 'Trout'], eatBelowHp: 0.45 },
    warnReadiness: warnElementalWorkshopReadiness,
    decide
};

// Re-export test seams.
export { parseElementalWorkshopJournal, EW_STAGE, EW_FLAG, ELEMENTAL_WORKSHOP_QUEST } from './journal.js';
export { ewArea, EW_ITEM, SEERS_BANK } from './areas.js';
export {
    held,
    hasPickaxe,
    hasHeldSlashTool,
    hasSlashTool,
    hasWeapon,
    COAL_NEED,
    FOOD_WITHDRAW,
    EW_OFFICIAL_SKILLS,
    EW_PROVEN_COMBAT_FLOOR,
    EW_FAILED_COMBAT,
    EW_PROBE_COMBAT,
    EW_TESTED_COMBAT,
    EW_RECOMMENDED_COMBAT,
    warnElementalWorkshopReadiness,
    surfaceLoadout
} from './supplies.js';
