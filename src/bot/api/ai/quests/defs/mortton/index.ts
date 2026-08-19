import { QUESTS } from '../../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { flagValue } from '../../engine/types.js';
import { KIT_KEEP, kitWanted } from '../fightarena/index.js';
import { wearKit } from '../fightarena/legs.js';
import { SM_ID, SM_NPC, SM_STAGE, SM_TILE } from './areas.js';
import { readMorttonProgress, SM_FLAG } from './journal.js';
import { DOSES_PER_PYRE_LOG, lightPyre, layRemains, makePyreLogs, stackPyre } from './pyre.js';
import { huntShade, REMAINS_WANTED } from './shades.js';
import {
    ashesShort,
    fillVial,
    heldId,
    kit,
    logsShort,
    makeAshes,
    permSerumVialId,
    serumsShort,
    SM_TOOLS
} from './supplies.js';
import {
    altarLit,
    lightAltar,
    repairTemple,
    sanctifyOil,
    sanctifySerum,
    SANCTITY_TO_SANCTIFY_SERUM,
    templeRepaired,
    templeSanctity
} from './temple.js';
import {
    BUILD_SETS,
    buildersOrder,
    dropDown,
    dropJunk,
    generalOrder,
    handoverAndStock,
    identifyTarromin,
    JUNK_IDS,
    mixSerum,
    mixUnfinished,
    PASTE_PER_SET,
    RAZMIRE_START_SCRIPT,
    readDiary,
    searchTable,
    setsThatFit,
    shopAtRazmire,
    takeDiary,
    takeVial,
    ULSQUIRE_TEMPLE_SCRIPT,
    visit
} from './town.js';

/** Remains kept past Ulsquire's study: one for the pyre, one against a failed cremation. */
const SPARE_REMAINS = 2;

const custom = (name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep =>
    ({ kind: 'custom', name, run });

const held = (snap: QuestSnapshot, id: number): number => heldId(snap, id);

const razmire = (script: readonly string[]): QuestStep =>
    custom('talk to Razmire', visit(SM_NPC.RAZMIRE, SM_NPC.RAZMIRE_AFFLICTED, SM_TILE.RAZMIRE, script));

const ulsquire = (script: readonly string[]): QuestStep =>
    custom('talk to Ulsquire', visit(SM_NPC.ULSQUIRE, SM_NPC.ULSQUIRE_AFFLICTED, SM_TILE.ULSQUIRE, script));

/** Doses of sacred oil in the pack; a pyre log wants two. */
function sacredDoses(snap: QuestSnapshot): number {
    return held(snap, SM_ID.SACRED_OIL4) * 4 + held(snap, SM_ID.SACRED_OIL3) * 3
        + held(snap, SM_ID.SACRED_OIL2) * 2 + held(snap, SM_ID.SACRED_OIL1);
}

/** Sacred oil, or the pyre logs it became, or the olive oil it comes from. */
function haveOil(snap: QuestSnapshot): boolean {
    return held(snap, SM_ID.PYRE_LOGS) > 0
        || sacredDoses(snap) >= DOSES_PER_PYRE_LOG
        || held(snap, SM_ID.OLIVE_OIL4) + held(snap, SM_ID.OLIVE_OIL3) + held(snap, SM_ID.OLIVE_OIL2) > 0;
}

// Why: sanctity is a player varp the altar demands and only this character's own building earns, so a rebuilt temple can still owe a load of material before the flame will answer.
// Why: the shell is world state the shades keep knocking down, so a flame leg can also arrive at a temple that has fallen back below 100%.

/** True while the flame legs still owe the temple building work. */
function needsTemple(snap: QuestSnapshot): boolean {
    return (flagValue(snap.progress, SM_FLAG.SANCTITY) ?? 0) < SANCTITY_TO_SANCTIFY_SERUM
        || (flagValue(snap.progress, SM_FLAG.REPAIRED) ?? 0) < 100;
}

/** Fresh material for the temple, whether already carried or still in the pool. */
function buildReady(snap: QuestSnapshot): boolean {
    const pool = flagValue(snap.progress, SM_FLAG.RESOURCES) ?? 0;
    const carried = Math.min(
        held(snap, SM_ID.PLANK),
        held(snap, SM_ID.LIMESTONE_BRICK),
        Math.floor(held(snap, SM_ID.SWAMP_PASTE) / 5)
    );
    return carried > 0 || pool > 5;
}

// Why: the shelf, the table and the two vial spawns all sit in Herbi Flax's house, and the herb table is a one-shot, so the serum chain runs to completion before anything else is attempted.

/** The next step toward the serums this quest still owes, or null when it owes none. */
function serumLeg(snap: QuestSnapshot, stage: number): QuestStep | null {
    if (stage < SM_STAGE.READ_DIARY || serumsShort(snap, stage) === 0) {
        return null;
    }
    if (held(snap, SM_ID.TARROMIN_UNF) > 0) {
        return held(snap, SM_ID.ASHES) > 0
            ? custom('mix serum 207', mixSerum)
            : { kind: 'wait', reason: 'no ashes for the serum' };
    }
    if (held(snap, SM_ID.TARROMIN) > 0) {
        if (held(snap, SM_ID.VIAL_WATER) > 0) {
            return custom('mix the unfinished potion', mixUnfinished);
        }
        return held(snap, SM_ID.VIAL_EMPTY) > 0
            ? custom('fill a vial at the sink', fillVial)
            : custom('take an empty vial', takeVial);
    }
    if (held(snap, SM_ID.UNID_TARROMIN) > 0) {
        return custom('identify the tarromin', identifyTarromin);
    }
    return custom('search the smashed table for herbs', searchTable);
}

// Why: five shades are killed a hundred and fifty tiles past the last bank, so the melee kit is drawn on the approach rather than at the fight.

/** Arm the account from the bank, or null once it is dressed. */
function gearLeg(snap: QuestSnapshot): QuestStep | null {
    const wanted = kitWanted(snap);
    if (wanted.length === 0) {
        return null;
    }
    const carried = wanted.filter(name => (snap.inv.get(name.toLowerCase()) ?? 0) > 0);
    if (carried.length > 0) {
        return custom(`wear ${carried.join(', ')}`, log => wearKit(carried, log));
    }
    if (!snap.bankKnown) {
        return { kind: 'scanBank' };
    }
    // Nothing in the bank to wear either: fists will have to do.
    const banked = wanted.filter(name => (snap.bank?.get(name.toLowerCase()) ?? 0) > 0);
    return banked.length > 0 ? { kind: 'withdraw', items: banked.map(name => ({ name, qty: 1 })) } : null;
}

// Why: both counters live behind Razmire's cured face, so anything missing is bought before the leg that needs it rather than found missing halfway through.
// Why: the olive oil waits until the rebuild has spent the eleven slots of plank, brick and paste — bought alongside them it has nowhere to land.

/** The next shopping trip at Razmire's counters, or null when the pack is stocked. */
function shopLeg(snap: QuestSnapshot, want: { building: boolean; oil: boolean }): QuestStep | null {
    const wantHammer = want.building && held(snap, SM_ID.HAMMER) === 0;
    const wantOil = want.oil && !haveOil(snap);
    if (wantHammer || wantOil) {
        return custom("buy from Razmire's general store", shopAtRazmire(generalOrder({ hammer: wantHammer, oil: wantOil })));
    }
    if (want.building && !buildReady(snap)) {
        const sets = setsThatFit(snap.freeSlots ?? 0);
        if (sets === 0) {
            return { kind: 'wait', reason: 'no pack room for building material' };
        }
        return custom('buy temple materials from Razmire', shopAtRazmire(buildersOrder(sets)));
    }
    return null;
}

// Why: the flame has to be alight before either use-on will answer, and sanctifying a vial of serum costs no dose while buying the endgame conversation a villager who never reverts.

// Why: the lit altar is `loc_change(templefire_altar, 99)` as well, so the oil — the use-on that moves the stage — goes in first and the optional serum takes what is left of the flame.

/** Light the altar, sanctify the oil, and bank a permanent serum against the last conversation. */
async function altarLeg(log: (m: string) => void): Promise<boolean> {
    // The shades knock the shell down behind the bot, and only a shell at 100% arms the altar.
    if (templeRepaired() < 100 && !(await repairTemple(log))) {
        return false;
    }
    if (!(await lightAltar(log))) {
        return false;
    }
    if (!(await sanctifyOil(log))) {
        return false;
    }
    if (permSerumVialId() === null && templeSanctity() >= SANCTITY_TO_SANCTIFY_SERUM) {
        if (altarLit() === null) {
            await lightAltar(log);
        }
        await sanctifySerum(log);
    }
    return true;
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
    if (stage >= SM_STAGE.COMPLETE) {
        return { kind: 'done' };
    }

    const supplies = kit(snap, stage);
    if (supplies) {
        return supplies;
    }
    const gear = gearLeg(snap);
    if (gear) {
        return gear;
    }
    // Why: the ashes and the pyre log both come from the Varrock spawns, so the burn happens once, before the swamp crossing.
    if (ashesShort(snap, stage) > 0 || logsShort(snap, stage) > 0) {
        return custom('burn logs for ashes', makeAshes({
            ashes: held(snap, SM_ID.ASHES) + ashesShort(snap, stage),
            logs: held(snap, SM_ID.PYRE_LOGS) > 0 ? 0 : 1
        }));
    }

    if (stage === SM_STAGE.NOT_STARTED) {
        return held(snap, SM_ID.DIARY) > 0
            ? custom("read Herbi Flax's diary", readDiary)
            : custom("take Herbi Flax's diary", takeDiary);
    }

    const serum = serumLeg(snap, stage);
    if (serum) {
        return serum;
    }
    // The diary has done its job, and a rotted lobster is a slot the temple load needs.
    if (stage >= SM_STAGE.MADE_SERUM && JUNK_IDS.some(id => held(snap, id) > 0)) {
        return custom('drop the diary and the rotten food', dropJunk);
    }
    // Past Ulsquire's study only the pyre wants remains, and a spare covers a failed cremation.
    if (stage >= SM_STAGE.SHADES_TO_ULSQUIRE && held(snap, SM_ID.REMAINS) > SPARE_REMAINS) {
        return custom('drop the spare remains', log => dropDown([{ id: SM_ID.REMAINS, keep: SPARE_REMAINS }], log));
    }

    switch (stage) {
        case SM_STAGE.READ_DIARY:
        case SM_STAGE.MADE_SERUM:
            return razmire(RAZMIRE_START_SCRIPT);
        case SM_STAGE.KILL_SHADES:
        case SM_STAGE.KILLED_1:
        case SM_STAGE.KILLED_2:
        case SM_STAGE.KILLED_3:
        case SM_STAGE.KILLED_4:
            return custom('hunt a Loar Shade', huntShade);
        case SM_STAGE.KILLED_5: {
            if (held(snap, SM_ID.REMAINS) < REMAINS_WANTED) {
                return custom('hunt a Loar Shade', huntShade);
            }
            const wantHammer = held(snap, SM_ID.HAMMER) === 0;
            // Why: the hammer is bought first — it is one slot, and buying it after eleven slots of material would not fit.
            const orders = [
                ...(wantHammer ? [generalOrder({ hammer: true, oil: false })] : []),
                buildersOrder(setsThatFit((snap.freeSlots ?? 0) - (wantHammer ? 1 : 0)))
            ];
            return custom('hand Razmire the remains and stock up', handoverAndStock(orders));
        }
        case SM_STAGE.SHADES_TO_RAZMIRE: {
            const shop = shopLeg(snap, { building: true, oil: false });
            return shop ?? ulsquire([]);
        }
        case SM_STAGE.SHADES_TO_ULSQUIRE:
            return ulsquire(ULSQUIRE_TEMPLE_SCRIPT);
        case SM_STAGE.ULSQUIRE_TEMPLE:
        case SM_STAGE.REBUILD_TEMPLE: {
            const shop = shopLeg(snap, { building: true, oil: false });
            return shop ?? custom('rebuild the Flamtaer temple', repairTemple);
        }
        case SM_STAGE.CAN_LIGHT_ALTAR: {
            const shop = shopLeg(snap, { building: needsTemple(snap), oil: true });
            return shop ?? custom('light the altar and sanctify the oil', altarLeg);
        }
        case SM_STAGE.CREATED_SACRED_OIL: {
            const shop = shopLeg(snap, { building: needsTemple(snap), oil: true });
            if (shop) {
                return shop;
            }
            // Why: the stage says oil was sanctified once, not that any is left — a lost vial goes back to the flame rather than parking on the log.
            if (held(snap, SM_ID.PYRE_LOGS) === 0 && sacredDoses(snap) < DOSES_PER_PYRE_LOG) {
                return custom('sanctify more oil in the flame', altarLeg);
            }
            return custom('soak the logs in sacred oil', makePyreLogs);
        }
        case SM_STAGE.CREATED_PYRE_LOGS:
            return custom('stack the pyre logs', stackPyre);
        case SM_STAGE.LOGS_ON_PYRE:
            return custom('cremate the shade', async log => (await layRemains(log)) && lightPyre(log));
        case SM_STAGE.LIT_PYRE:
            return ulsquire([]);
        default:
            return { kind: 'wait', reason: `unmapped stage ${stage}` };
    }
}

export const mortton: QuestModule = {
    record: QUESTS.find(r => r.id === 'mortton')!,
    // Varrock for the approach, Canifis for anything Morytania forces a restock of.
    bank: 'nearest',
    tools: [...SM_TOOLS, ...KIT_KEEP],
    ownsInventory: true,
    readProgress: readMorttonProgress,
    sustain: { foods: ['Lobster', 'Swordfish', 'Tuna'], eatBelowHp: 0.5 },
    warnReadiness: () =>
        `Mort'ton is proven at 70s: ${BUILD_SETS} sets of plank, brick and ${PASTE_PER_SET} paste rebuild`
        + ' the temple at Crafting 70, and lower Crafting spends more of the pool per wall.',
    decide
};
