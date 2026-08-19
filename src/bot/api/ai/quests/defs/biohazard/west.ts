import { EventSignal } from '../../../../execution/EventSignal.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Npcs, type Npc } from '../../../../npcs/Npcs.js';
import { Skills } from '../../../../skills/Skills.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { driveChoice, driveUntil, settleScene } from '../../exec/prompts.js';
import { BIO_ITEM, BIO_LOC, BIO_TILE, SICK_MOURNER_ID } from './areas.js';
import { heldId, wear } from './gear.js';
import { enterHq, locById, walkTo } from './travel.js';

// Why: the third answer is the only one that does not accuse the bot of being a fake doctor
// before the fight, and all three end in the same `~npc_retaliate(0)`.
const MOURNER_PREFER = ["There's nothing I can do, it's fatal."];

/** Ticks of fighting before the mourner counts as stuck. Level 13, 19 hitpoints. */
const FIGHT_GUARD = 300;
/** A lobster's worth of damage is enough to eat on. */
const EAT_AT_MISSING = 15;
// Why: the key arrives from `queue,defeat_biohazard_mourner`, run after the death animation and `npc_del`, so the corpse is gone for several ticks before the pack changes.
/** Ticks with nothing to hit before the kill counts as landed without a key. */
const MISSING_TO_WIN = 10;

export async function takeRottenApples(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(BIO_TILE.ROTTEN_APPLES, 1, log))) {
        return false;
    }
    await settleScene();
    const apples = GroundItems.query().where(item => item.id === BIO_ITEM.ROTTEN_APPLES.id).within(8).nearest();
    if (!apples) {
        log(`no Rotten apples at (${BIO_TILE.ROTTEN_APPLES.x},${BIO_TILE.ROTTEN_APPLES.z}) — waiting for the respawn`);
        await Execution.delayTicks(4);
        return false;
    }
    if (!(await apples.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(BIO_ITEM.ROTTEN_APPLES.id) > 0, 8000);
}

// Why: the cauldron sits in the headquarters yard, and the only way in that is not the
// gown-locked building is the Climb-over fence at 2541,3331 — a curated transport.
export async function poisonTheStew(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(BIO_TILE.CAULDRON, 1, log))) {
        return false;
    }
    await settleScene();
    const cauldron = locById(BIO_LOC.CAULDRON, null, 8);
    const apples = Inventory.items().find(item => item.id === BIO_ITEM.ROTTEN_APPLES.id);
    if (!cauldron || !apples) {
        log(`no ${cauldron ? 'Rotten apples' : 'Cauldron'} for the stew`);
        return false;
    }
    if (!(await apples.useOn(cauldron))) {
        return false;
    }
    if (!(await driveUntil(() => heldId(BIO_ITEM.ROTTEN_APPLES.id) === 0, [], log, 20_000))) {
        return false;
    }
    // Why: the apple dissolves three ticks before the stage moves, so returning on the empty slot
    // hands the next decide a journal that still says "fetch rotten apples".
    await Execution.delayTicks(5);
    return true;
}

/** The nurse's cupboard. It hands nothing over while a gown is already banked or worn. */
export async function takeDoctorGown(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(BIO_TILE.NURSE_CUPBOARD, 1, log))) {
        return false;
    }
    await settleScene();
    const open = locById(BIO_LOC.NURSE_CUPBOARD_OPEN, 'Search', 6);
    if (open) {
        if (!(await open.interact('Search'))) {
            return false;
        }
        return driveUntil(() => heldId(BIO_ITEM.DOCTOR_GOWN.id) > 0, [], log, 10_000);
    }
    const shut = locById(BIO_LOC.NURSE_CUPBOARD_SHUT, 'Open', 6);
    if (!shut || !(await shut.interact('Open'))) {
        log("no cupboard in the nurse's hut");
        return false;
    }
    return Execution.delayUntil(() => locById(BIO_LOC.NURSE_CUPBOARD_OPEN, 'Search', 6) !== null, 6000);
}

function sickMourner(): Npc | null {
    return Npcs.query()
        .where(npc => npc.id === SICK_MOURNER_ID)
        .where(npc => !npc.targetsAnotherPlayer())
        .within(12)
        .nearest();
}

function hungry(): boolean {
    const max = Skills.level('hitpoints');
    return max > 0 && Skills.effective('hitpoints') <= max - EAT_AT_MISSING;
}

// Why: the key only drops for the player the mourner is aggressive toward, and `%npc_aggressive_player` is set by `~npc_retaliate` — which is what the doctor dialogue calls, so Attack alone is not guaranteed to claim him.
// Why: he respawns 140 ticks after dying, so the talk, the fight and the search are one step.
async function fightForKey(log: (m: string) => void): Promise<boolean> {
    let swings = 0;
    let attacking = -1;
    let missing = 0;
    let reported = -40;
    Game.setAutoRetaliate(true);
    for (let i = 0; i < FIGHT_GUARD; i++) {
        if (EventSignal.pending()) {
            log('mourner fight: yielding to a random event');
            return false;
        }
        if (heldId(BIO_ITEM.MOURNER_KEY.id) > 0) {
            log(`took the key off the mourner after ${swings} attacks`);
            return true;
        }
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        if (hungry()) {
            await Sustain.run();
            continue;
        }
        const npc = sickMourner();
        if (!npc) {
            missing++;
            attacking = -1;
            if (swings > 0 && missing >= MISSING_TO_WIN) {
                log('the sick mourner is down but dropped no key — talking to the next one');
                return false;
            }
            await Execution.delayTicks(1);
            continue;
        }
        missing = 0;
        if (i - reported >= 40) {
            reported = i;
            log(`mourner: hp=${Skills.effective('hitpoints')}/${Skills.level('hitpoints')} attacks=${swings}`
                + ` at (${npc.tile().x},${npc.tile().z})`);
        }
        if (npc.index === attacking && Game.inCombat()) {
            await Execution.delayTicks(1);
            continue;
        }
        if (await npc.interact('Attack')) {
            attacking = npc.index;
            swings++;
        }
        await Execution.delayTicks(1);
    }
    log(`mourner fight: gave up after ${FIGHT_GUARD} ticks (${swings} attacks)`);
    return false;
}

/** Get inside, provoke the sick mourner, and take his key. */
export async function takeMournerKey(log: (m: string) => void): Promise<boolean> {
    if (heldId(BIO_ITEM.MOURNER_KEY.id) > 0) {
        return true;
    }
    if (!(await wear(BIO_ITEM.DOCTOR_GOWN, log)) || !(await enterHq(log))) {
        return false;
    }
    if (!(await walkTo(BIO_TILE.HQ_UPSTAIRS, 2, log))) {
        return false;
    }
    await settleScene();
    const npc = sickMourner();
    if (!npc) {
        log('no sick Mourner on the headquarters first floor');
        return false;
    }
    if (!(await npc.interact('Talk-to'))) {
        return false;
    }
    // Why: `talkStrict` would re-find "Mourner" by display name and could open a different one;
    // the click is already sent, so this only drives the prompt it raised.
    if (await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 8000)) {
        await driveChoice(MOURNER_PREFER, log);
    }
    return fightForKey(log);
}

/** Through the locked gate and into the crate Elena's distillator is stored in. */
export async function searchTheCrate(log: (m: string) => void): Promise<boolean> {
    if (!(await wear(BIO_ITEM.DOCTOR_GOWN, log)) || !(await enterHq(log))) {
        return false;
    }
    if (heldId(BIO_ITEM.MOURNER_KEY.id) === 0) {
        log('no Key in the pack — the headquarters gate refuses an empty-handed Open');
        return false;
    }
    if (!(await walkTo(BIO_TILE.HQ_CRATE, 1, log))) {
        return false;
    }
    await settleScene();
    const crate = locById(BIO_LOC.HQ_CRATE, 'Search', 6);
    if (!crate) {
        log(`no Crate offering Search at (${BIO_TILE.HQ_CRATE.x},${BIO_TILE.HQ_CRATE.z},1)`);
        return false;
    }
    if (!(await crate.interact('Search'))) {
        return false;
    }
    return driveUntil(() => heldId(BIO_ITEM.DISTILLATOR.id) > 0, [], log, 15_000);
}
