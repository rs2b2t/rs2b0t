import { Execution } from '../../../../execution/Execution.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { QUESTS } from '../../data/quests.js';
import { hasFlag, type QuestModule, type QuestSnapshot, type QuestStep } from '../../engine/types.js';
import { talkThrough } from '../../exec/primitives.js';
import { GUNNJORN, HD_ID, HD_ITEM, HD_STAGE, HD_TILE, LARRISSA } from './areas.js';
import { ensureBarcrawl } from '../../barcrawl/RunBarcrawl.js';
import { barcrawlFunds } from './barcrawl.js';
import { exitAfterQuest, inCavern, openWallAndDescend } from './dungeon.js';
import { fightJunior, fightMother } from './fight.js';
import { HD_FLAG, readHorrorProgress } from './journal.js';
import {
    climbToLight, descendToBasement, enterLighthouse, inBasement, inQuestLighthouse, repairBridge, repairLight
} from './lighthouse.js';
import {
    bankedId, dungeonKit, foodWant, hammer, heldId, HORROR_TOOLS, kit, NAILS_NEEDED, nails, PLANKS_NEEDED,
    planks, runeKit, sealedArea, warnHorrorReadiness
} from './supplies.js';

const custom = (name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep =>
    ({ kind: 'custom', name, run });

// Why: Gunnjorn stands inside the Barbarian Outpost agility course, behind the outpost gate and then the obstacle pipe.
// Why: the ten-bar barcrawl is therefore a hard prerequisite, as the gate's guard intercepts anyone who has not finished it.

/** Fetch Larrissa's spare key from her cousin Gunnjorn. */
async function fetchKey(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(HD_ID.KEY) > 0) {
        return true;
    }
    if (!(await ensureBarcrawl(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(HD_TILE.GUNNJORN, { radius: 4, attempts: 4, timeoutMs: 300_000, log }))) {
        log('could not get through the outpost to Gunnjorn');
        return false;
    }
    await Execution.delayTicks(2);
    if (!(await talkThrough(GUNNJORN.npc, GUNNJORN.prefer, log))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.countById(HD_ID.KEY) > 0, 8000);
}

// Why: this runs after the nails, as `smithNails` banks everything outside its KEEP list to make room for four iron and eight coal.
// Why: runes are not on that list, so a rune bought before the nails leg is deposited and re-withdrawn forever.

/** Runes, when hops are on and the pack is short. */
function teleportRunes(snap: QuestSnapshot): QuestStep | null {
    return Traversal.teleportsEnabled() ? runeKit(snap) : null;
}

// Why: every step banks before it shops, as the ordinary account already owns most of this — a hammer and eight steel nails are not exotic — and the detour collapses to nothing when they are in the bank.
// Why: hammer, nails and runes are three Varrock errands, and the planks are ground spawns at the Barbarian Outpost, which is the last stop before the lighthouse.

/** Everything the bridge repair consumes, in the order the map wants it. */
function bridgeKit(snap: QuestSnapshot): QuestStep | null {
    if (heldId(snap, HD_ID.HAMMER) === 0) {
        return hammer(snap);
    }
    // Nails strictly before planks: the smithing leg banks the pack to make
    // room for ore, and a plank banked mid-leg is a plank fetched twice.
    if (heldId(snap, HD_ID.NAILS) < NAILS_NEEDED) {
        return nails(snap);
    }
    const runes = teleportRunes(snap);
    if (runes) {
        return runes;
    }
    if (heldId(snap, HD_ID.PLANK) < PLANKS_NEEDED) {
        return planks(snap);
    }
    return null;
}

// Why: the lighthouse load is assembled here rather than at stage 2, so the causeway is crossed once instead of three times.

/** Everything Larrissa wants before she opens the lighthouse, plus the load inside it. */
function beforeTheDoor(snap: QuestSnapshot): QuestStep {
    if (!hasFlag(snap.progress, HD_FLAG.BRIDGE)) {
        return bridgeKit(snap) ?? custom('repair the bridge', repairBridge);
    }
    // Why: a resume that starts past the bridge never enters `bridgeKit`, and would otherwise walk the ten-bar tour — the one leg hops pay for — with an empty pouch.
    const runes = teleportRunes(snap);
    if (runes) {
        return runes;
    }
    if (heldId(snap, HD_ID.KEY) === 0) {
        // Why: a banked card is the one state the guard cannot resolve — he answers "You need to take it with you", hands nothing over, and the tour reads as already finished when the gate is still shut.
        if (heldId(snap, HD_ID.BARCRAWL_CARD) === 0 && bankedId(snap, HD_ID.BARCRAWL_CARD) > 0) {
            return {
                kind: 'withdraw',
                items: [{ name: HD_ITEM.BARCRAWL_CARD, qty: 1, id: HD_ID.BARCRAWL_CARD }]
            };
        }
        return barcrawlFunds(snap) ?? custom("the barcrawl and Larrissa's key", fetchKey);
    }
    const short = dungeonKit(snap, true);
    if (short) {
        return short;
    }
    return { kind: 'talk', stop: LARRISSA };
}

// Why: the lighthouse, the basement and the cavern are three sealed pockets linked only by scripted teleports, and the nearest bank is the far side of the causeway.
// Why: every branch therefore starts by working out which pocket the character is in, as a death drops it back on the mainland mid-stage.

/** Route a branch by which sealed pocket the character is in. */
function inside(snap: QuestSnapshot, needLight: boolean, atDepth: () => QuestStep): QuestStep {
    if (!sealedArea(snap.tile)) {
        const short = dungeonKit(snap, needLight);
        if (short) {
            return short;
        }
        return custom('enter the lighthouse', enterLighthouse);
    }
    return atDepth();
}

function repairTheLight(snap: QuestSnapshot): QuestStep {
    const flags = snap.progress?.flags ?? new Set<string>();
    return inside(snap, true, () => custom('repair the lighthouse light', async log => {
        if (!(await climbToLight(log))) {
            return false;
        }
        return repairLight(flags, log);
    }));
}

/** Down the ladder, through the strange wall, and on to the juniors. */
function reachTheCavern(snap: QuestSnapshot, atCavern: QuestStep): QuestStep {
    return inside(snap, false, () => {
        if (inCavern(snap.tile ?? null)) {
            return atCavern;
        }
        if (inBasement(snap.tile ?? null)) {
            return custom('open the strange wall', openWallAndDescend);
        }
        if (inQuestLighthouse(snap.tile ?? null) || (snap.tile?.level ?? 0) > 0) {
            return custom('descend to the basement', descendToBasement);
        }
        return custom('enter the lighthouse', enterLighthouse);
    });
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
    // Why: coin and food upkeep never runs inside a pocket a bank trip cannot start from — preparation stops at the door, or a mid-fight top-up walks the character back out of the cavern.
    if (!sealedArea(snap.tile)) {
        const float = kit(snap, foodWant(snap, stage));
        if (float) {
            return float;
        }
    }
    switch (stage) {
        case HD_STAGE.NOT_STARTED:
            // Why: the bridge kit comes before the first word with Larrissa, as starting the quest first costs a crossing of the map for nothing.
            // Why: she is at the lighthouse in the far north-west, the hammer, nails and runes all come from Varrock, and the planks from the outpost on the way back — so a bot that talks first walks Rellekka → lighthouse → Varrock → outpost → lighthouse instead of Varrock → outpost → lighthouse.
            // Why: nothing here is quest-gated — the ore, the anvil, the shop and the plank spawns are all open before the journal has a single line in it.
            // Why: for an account that already owns the nails this branch is free, as every step of `bridgeKit` reads the bank first, so the common case is one walk to the lighthouse and straight into the bridge.
            return bridgeKit(snap) ?? { kind: 'talk', stop: LARRISSA };
        case HD_STAGE.STARTED:
            return beforeTheDoor(snap);
        case HD_STAGE.ENTERED_LIGHTHOUSE:
        case HD_STAGE.FIXING_LIGHTHOUSE:
            return repairTheLight(snap);
        case HD_STAGE.REPAIRED_LIGHTHOUSE:
            return reachTheCavern(snap, custom('kill the dagannoth junior', fightJunior));
        case HD_STAGE.DEFEATED_DAGJR:
            return reachTheCavern(snap, custom('kill the Dagannoth mother', fightMother));
        default:
            return { kind: 'done' };
    }
}

export const horror: QuestModule = {
    record: QUESTS.find(r => r.id === 'horror')!,
    // Four kingdoms and a ten-bar barcrawl: pinning one booth would cost a
    // kingdom-crossing on every leg that touches it.
    bank: 'nearest',
    tools: [...HORROR_TOOLS],
    ownsInventory: true,
    // Literals, not QuestFood.name: this object is built at import, when the
    // setting still holds its default. The host merges the configured food in.
    sustain: { foods: ['Shark', 'Swordfish', 'Lobster', 'Tuna'], eatBelowHp: 0.6 },
    warnReadiness: warnHorrorReadiness,
    readProgress: readHorrorProgress,
    exit: exitAfterQuest,
    decide
};
