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

// Why: Gunnjorn is inside the Barbarian Outpost course behind the gate and the pipe, and the gate's guard intercepts anyone without the 10-bar barcrawl.

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

// Why: `smithNails` banks everything outside its KEEP list for 4 iron and 8 coal, and runes aren't on it, so this runs after the nails.

/** Runes, when hops are on and the pack is short. */
function teleportRunes(snap: QuestSnapshot): QuestStep | null {
    return Traversal.teleportsEnabled() ? runeKit(snap) : null;
}

// Why: every step banks before it shops since most accounts own a hammer and nails; hammer, nails and runes are Varrock errands and the planks are outpost spawns on the way to the lighthouse.

/** Everything the bridge repair consumes, in the order the map wants it. */
function bridgeKit(snap: QuestSnapshot): QuestStep | null {
    if (heldId(snap, HD_ID.HAMMER) === 0) {
        return hammer(snap);
    }
    // Nails before planks: the smithing leg banks the pack for ore, and a plank banked mid-leg is fetched twice.
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

// Why: assembling the lighthouse load here crosses the causeway once; at stage 2 it's 3 times.

/** Everything Larrissa wants before she opens the lighthouse, plus the load inside it. */
function beforeTheDoor(snap: QuestSnapshot): QuestStep {
    if (!hasFlag(snap.progress, HD_FLAG.BRIDGE)) {
        return bridgeKit(snap) ?? custom('repair the bridge', repairBridge);
    }
    // Why: a resume past the bridge never enters `bridgeKit` and would walk the 10-bar tour, the leg hops pay for, with an empty pouch.
    const runes = teleportRunes(snap);
    if (runes) {
        return runes;
    }
    if (heldId(snap, HD_ID.KEY) === 0) {
        // Why: The guard refuses a banked card, leaving the tour complete but the gate closed.
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

// Why: the lighthouse, basement and cavern are sealed pockets linked by scripted teleports, and a death drops you on the mainland mid-stage, so every branch starts by locating the pocket.

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
    // Why: upkeep never runs inside a sealed pocket, or a mid-fight top-up walks you back out of the cavern.
    if (!sealedArea(snap.tile)) {
        const float = kit(snap, foodWant(snap, stage));
        if (float) {
            return float;
        }
    }
    switch (stage) {
        case HD_STAGE.NOT_STARTED:
            // Why: the bridge kit comes before Larrissa since the kit is Varrock and the outpost, on the way to the lighthouse, and nothing in it is quest-gated.
            // Why: `bridgeKit` checks the bank first and skips sourcing nails already owned.
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
    pray: { protect: 'melee', potions: 2 },
    // 4 kingdoms and a 10-bar barcrawl: pinning one booth costs a kingdom-crossing per leg.
    bank: 'nearest',
    tools: [...HORROR_TOOLS],
    ownsInventory: true,
    // This object is built at import, before QuestFood.name is set; the host merges the configured food in.
    sustain: { foods: ['Shark', 'Swordfish', 'Lobster', 'Tuna'], eatBelowHp: 0.6 },
    warnReadiness: warnHorrorReadiness,
    readProgress: readHorrorProgress,
    exit: exitAfterQuest,
    decide
};
