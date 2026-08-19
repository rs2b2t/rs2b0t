import { EventSignal } from '../../../../execution/EventSignal.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems, type GroundItem } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { openContainer, talkAndClose, talkUntil } from '../../exec/legs.js';
import { driveChoice, promptLoc } from '../../exec/prompts.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import {
    GRIP,
    HERO_ID,
    HERO_LOC,
    HERO_NAMED,
    HERO_NPC,
    HERO_SAY,
    HERO_SHOP,
    HERO_TILE,
    KATRINE_ARMBAND,
    KATRINE_TASK,
    TROBERT,
    inMansion,
    inTreasureRoom
} from './areas.js';
import { crossTreasureDoorIn, crossTreasureDoorOut, enterBrimhavenHq, enterMansion, returnToStreet } from './doors.js';
import { HERO_STAGE } from './journal.js';
import { HeroHandoffState, shouldFetchKey } from './partner.js';
import { kitOwned, kitStep, type Purchasable } from './shops.js';
import { heldId } from './state.js';

// Why: Garv checks all three worn and refuses silently otherwise, and Louie leads because Valaine
// restocks every 20 000 ticks to his 1 200.

/** Hartigen's disguise. */
const DISGUISE: readonly Purchasable[] = [
    {
        id: HERO_ID.BLACK_PLATEBODY,
        name: HERO_NAMED.BLACK_PLATEBODY,
        qty: 1,
        sources: [{ ...HERO_SHOP.HORVIK, gp: 4_500 }]
    },
    {
        id: HERO_ID.BLACK_PLATELEGS,
        name: HERO_NAMED.BLACK_PLATELEGS,
        qty: 1,
        sources: [{ ...HERO_SHOP.LOUIE, gp: 3_000 }, { ...HERO_SHOP.VALAINE, gp: 30_000 }]
    },
    {
        id: HERO_ID.BLACK_FULL_HELM,
        name: HERO_NAMED.BLACK_FULL_HELM,
        qty: 1,
        sources: [{ ...HERO_SHOP.VALAINE, gp: 2_000 }]
    }
];

/** How long one pass keeps re-luring before the engine gets its turn back. */
const LURE_MS = 150_000;
/** How long a single lure holds Grip on the row before he walks home. */
const LURE_HOLD_MS = 12_000;
/** How long the cabinet takes to raise the guard's challenge. */
const DIALOG_MS = 6_000;
const GROUND_RANGE = 12;

/** The disguise, in whatever state it is in: bought, withdrawn, then worn. */
export function disguiseStep(snap: QuestSnapshot): QuestStep | null {
    return kitStep(snap, DISGUISE);
}

/** True once all three pieces are somewhere the bot can reach them. */
export function disguiseOwned(snap: QuestSnapshot): boolean {
    return kitOwned(snap, DISGUISE);
}

export async function talkToTrobert(log: (m: string) => void): Promise<boolean> {
    if (!(await enterBrimhavenHq(log))) {
        return false;
    }
    return talkUntil(TROBERT, TROBERT.prefer, () => Inventory.countById(HERO_ID.ID_PAPERS) > 0, log, 60_000);
}

// Why: the first talk takes the papers and only then opens the option tree, so one leg covers both
// the introduction and the key — and Grip re-issues the spare whenever `~obj_gettotal` reads zero.

/** Report for duty, then ask for a job, which is what hands over the spare key. */
export async function askGripForKey(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(HERO_ID.MISC_KEY) > 0) {
        return true;
    }
    if (!(await enterMansion(log))) {
        return false;
    }
    return talkUntil(GRIP, GRIP.prefer, () => Inventory.countById(HERO_ID.MISC_KEY) > 0, log, 90_000);
}

function keyringOnFloor(): GroundItem | null {
    return GroundItems.query().where(g => g.id === HERO_ID.GRIP_KEYS).within(GROUND_RANGE).nearest();
}

// Why: the rival's shot needs Grip on the arrow slit's own row and nothing else, so this is the same
// test the snipe uses — anywhere else on the way there is not a lure that helps.
function gripOnTheRow(): boolean {
    const grip = Npcs.query().where(n => n.id === HERO_NPC.GRIP).nearest();
    const tile = grip?.tile();
    return !!tile
        && tile.z === HERO_TILE.GRIP_LURE.z
        && Math.abs(tile.x - HERO_TILE.GRIP_LURE.x) <= 3;
}

async function takeKeyring(log: (m: string) => void): Promise<boolean> {
    const drop = keyringOnFloor();
    if (!drop) {
        return false;
    }
    const before = Inventory.countById(HERO_ID.GRIP_KEYS);
    if (!(await drop.interact('Take'))) {
        return false;
    }
    const took = await Execution.delayUntil(() => Inventory.countById(HERO_ID.GRIP_KEYS) > before, 8_000);
    if (took) {
        log("took Grip's keyring off the floor");
    }
    return took;
}

// Why: `snipable_wall` (blockrange=no) seals the side room, so the rival shoots Grip through the arrow
// slit, and reaches him only while the drinks cabinet has walked him onto that row.

// Why: `summon_grip` walks him six tiles and `npc_setmode(null)` turns him round six ticks later, so
// the loop re-runs the cabinet's Search rather than luring once and waiting.

/** Walk Grip to the arrow slit over and over until the rival drops him, then take the keyring. */
export async function lureGripAndTakeKeyring(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(HERO_ID.GRIP_KEYS) > 0) {
        return true;
    }
    if (!(await enterMansion(log))) {
        return false;
    }
    if (await takeKeyring(log)) {
        return true;
    }
    if (!(await Traversal.walkResilient(HERO_TILE.CABINET_STAND, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const deadline = performance.now() + LURE_MS;
    let lures = 0;
    let reported = false;
    while (performance.now() < deadline && keyringOnFloor() === null) {
        if (EventSignal.pending()) {
            log('lure: yielding to a random event');
            return false;
        }
        // Why: a Grip already standing on the row needs no second summon, and re-clicking there spends
        // every tick on a dialogue rather than leaving the rival's shot the tick it needs.
        if (gripOnTheRow()) {
            await Execution.delayUntil(() => keyringOnFloor() !== null || !gripOnTheRow(), LURE_HOLD_MS);
            continue;
        }
        // Why: the cabinet is two locs — `gripcbshut` becomes `gripcbopen` for 500 ticks — and both run
        // `summon_grip`, one under Open and one under Search.
        const cupboard = Locs.query()
            .where(l => l.id === HERO_LOC.CABINET_OPEN || l.id === HERO_LOC.CABINET_SHUT)
            .within(8)
            .nearest();
        if (!cupboard) {
            log(`lure: no drinks cabinet within eight tiles of (${HERO_TILE.CABINET_STAND.x},${HERO_TILE.CABINET_STAND.z})`);
            return false;
        }
        const op = cupboard.id === HERO_LOC.CABINET_OPEN ? 'Search' : 'Open';
        const clicked = await cupboard.interact(op);
        // Why: `summon_grip` does nothing at all unless a pirate guard is within four tiles of the
        // player — no dialogue, no walk, no refusal — so the guard is worth naming when nothing happens.
        const guard = Npcs.query().where(n => n.id === HERO_NPC.PIRATE_GUARD).within(4).nearest();
        const asked = await Execution.delayUntil(
            () => ChatDialog.isOpen() || ChatDialog.canContinue() || gripOnTheRow(),
            DIALOG_MS
        );
        if (ChatDialog.isOpen() || ChatDialog.canContinue()) {
            await driveChoice([HERO_SAY.CABINET_PEEK], log);
        }
        const onRow = await Execution.delayUntil(() => gripOnTheRow() || keyringOnFloor() !== null, LURE_HOLD_MS);
        lures++;
        if (!reported || onRow) {
            const at = Npcs.query().where(n => n.id === HERO_NPC.GRIP).nearest()?.tile();
            log(`lure ${lures}: ${op}=${clicked} asked=${asked} onRow=${onRow}`
                + ` guard=${guard ? 'near' : 'MISSING'}`
                + ` grip=${at ? `${at.x},${at.z}` : 'not in scene'} (row z=${HERO_TILE.GRIP_LURE.z})`);
            reported = true;
        }
        await Modals.close();
    }
    if (await takeKeyring(log)) {
        log(`Grip dropped his keyring after ${lures} lures`);
        HeroHandoffState.lureFailures = 0;
        return true;
    }
    // Why: a rival that never turned up may have died holding the spare key, and Grip will only issue
    // another once this bot is empty-handed — so a run of fruitless lures re-opens the fetch.
    HeroHandoffState.lureFailures++;
    log(`no keyring after ${lures} lures — the rival may not be at the arrow slit yet`);
    return false;
}

/** Grip's keyring opens the treasure room, and the chest inside hands over two candlesticks. */
export async function lootCandlesticks(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(HERO_ID.CANDLESTICK) >= 2) {
        return crossTreasureDoorOut(log);
    }
    if (!inTreasureRoom(Game.tile())) {
        if (!(await enterMansion(log))) {
            return false;
        }
        if (!(await Traversal.walkResilient(HERO_TILE.TREASURE_DOOR, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
            return false;
        }
        if (!(await crossTreasureDoorIn(log))) {
            return false;
        }
    }
    if (!(await openContainer('Chest', HERO_LOC.CHEST_SHUT, HERO_LOC.CHEST_OPEN, HERO_TILE.CHEST_STAND, log))) {
        await crossTreasureDoorOut(log);
        return false;
    }
    await promptLoc({
        name: 'Chest',
        op: 'Search',
        near: HERO_TILE.CHEST_STAND,
        id: HERO_LOC.CHEST_OPEN,
        within: 6,
        expect: () => Inventory.countById(HERO_ID.CANDLESTICK) > 0
    }, log);
    await Modals.close();
    const took = Inventory.countById(HERO_ID.CANDLESTICK) > 0;
    if (!took) {
        log('the chest handed over nothing — a candlestick is already held or banked');
    }
    // Why: the take is the work; a failed exit is retried for free by the next pass's early branch.
    await crossTreasureDoorOut(log);
    return took;
}

/** Katrine stands above ground in Varrock, but the candlestick is looted inside a sealed pocket. */
export async function handInCandlestick(log: (m: string) => void): Promise<boolean> {
    if (!(await returnToStreet(log))) {
        return false;
    }
    return talkUntil(KATRINE_ARMBAND, KATRINE_ARMBAND.prefer,
        () => Inventory.countById(HERO_ID.ARMBAND) > 0, log, 60_000);
}

/** The Black Arm half of the armband, from Katrine's task to her reward. */
export function blackarmArmbandStep(snap: QuestSnapshot, stage: number): QuestStep | null {
    switch (stage) {
        case HERO_STAGE.STARTED:
            return {
                kind: 'custom',
                name: 'ask Katrine about the master thief rank',
                run: log => talkAndClose(KATRINE_TASK, KATRINE_TASK.prefer, log)
            };

        case HERO_STAGE.BLACKARM_SPOKEN: {
            // Why: the disguise is bought in Varrock, where Katrine already stands — buying it after
            // the crossing costs a return ferry and a walk across two kingdoms.
            const piece = disguiseOwned(snap) ? null : disguiseStep(snap);
            if (piece) {
                return piece;
            }
            return { kind: 'custom', name: 'say the password at the Brimhaven hideout', run: enterBrimhavenHq };
        }

        case HERO_STAGE.BLACKARM_HQ:
            return { kind: 'custom', name: 'take Hartigen’s papers from Trobert', run: talkToTrobert };

        case HERO_STAGE.BLACKARM_PAPERS: {
            if (heldId(snap, HERO_ID.ID_PAPERS) === 0) {
                return { kind: 'custom', name: 'ask Trobert for a spare set of papers', run: talkToTrobert };
            }
            const dressed = disguiseStep(snap);
            if (dressed) {
                return dressed;
            }
            return { kind: 'custom', name: 'pass Garv as Hartigen the Black Knight', run: enterMansion };
        }

        case HERO_STAGE.BLACKARM_MANSION:
            return { kind: 'custom', name: 'report to Grip as his new deputy', run: askGripForKey };

        case HERO_STAGE.BLACKARM_PAPERS_GIVEN:
            if (heldId(snap, HERO_ID.GRIP_KEYS) > 0) {
                return { kind: 'custom', name: 'open the treasure room and the chest', run: lootCandlesticks };
            }
            // Why: Grip re-issues the spare whenever the bot holds none, so a bot that fetches after
            // every trade swaps keys with its rival forever instead of luring him onto the slit.
            if (heldId(snap, HERO_ID.MISC_KEY) === 0 && shouldFetchKey()) {
                return { kind: 'custom', name: 'ask Grip for a job, which hands over his spare key', run: askGripForKey };
            }
            return { kind: 'custom', name: 'lure Grip to the arrow slit for the rival', run: lureGripAndTakeKeyring };

        case HERO_STAGE.BLACKARM_LOOTED:
            if (heldId(snap, HERO_ID.CANDLESTICK) === 0) {
                return { kind: 'wait', reason: 'the chest is looted but no candlestick is carried' };
            }
            return { kind: 'custom', name: 'give Katrine the candlestick', run: handInCandlestick };

        default:
            return null;
    }
}

/** Where the Black Arm bot must stand before anything but the armband can run. */
export function blackarmSealed(snap: QuestSnapshot): boolean {
    return inMansion(snap.tile) || inTreasureRoom(snap.tile);
}
