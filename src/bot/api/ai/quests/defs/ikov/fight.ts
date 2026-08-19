// docs/QUESTS.md
import { actions } from '../../../../../adapter/ClientAdapter.js';
import { DirectNavigator } from '../../../../../event/webwalk/DirectNavigator.js';
import { Equipment } from '../../../../equipment/Equipment.js';
import { EventSignal } from '../../../../execution/EventSignal.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Npcs, type Npc } from '../../../../npcs/Npcs.js';
import { Skills } from '../../../../skills/Skills.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { IKOV_FOODS, IKOV_LOC, IKOV_NAME, IKOV_NPC, IKOV_TILE, LAVA_BRIDGE_ZONE } from './areas.js';
import { escapePocket, pullTrapLever, wearFearPendant } from './dungeon.js';

/** Ticks the Fire Warrior is given before the leg hands the tick back to the engine. */
const WARRIOR_GUARD = 900;
/** The bow's second combat-tab style. */
const RAPID_MODE = 1;
/** Ticks with no target and no shot taken before the summon counts as failed. */
const NEVER_APPEARED = 30;
const LUCIEN_GUARD = 400;
const EAT_AT_MISSING = 18;
const ARROW_RADIUS = 12;
const WALK_MS = 300_000;
/** Ticks between progress lines while a fight is running. */
const REPORT_TICKS = 40;

function hungry(): boolean {
    const max = Skills.level('hitpoints');
    return max > 0 && Skills.effective('hitpoints') <= max - EAT_AT_MISSING;
}

// Why: `Sustain.run()` returns nothing whether it ate or found an empty pack, so a fight loop that yields to it on hunger alone spins out its guard doing nothing once the food is gone — which is how the first end-to-end run stood in front of the Fire Warrior for three minutes at 30 hitpoints.
function canEat(): boolean {
    return IKOV_FOODS.some(food => Inventory.contains(food));
}

/** Every ice-arrow stack size renders under one display name, so the pack is counted by name. */
function iceArrowsHeld(): number {
    return Inventory.count(IKOV_NAME.ICE_ARROWS) + (Equipment.contains(IKOV_NAME.ICE_ARROWS) ? wornArrows() : 0);
}

/** The quiver alone, which is all a bow can shoot however full the pack is. */
function wornArrows(): number {
    return Equipment.items()
        .filter(i => (i.name ?? '').toLowerCase() === IKOV_NAME.ICE_ARROWS.toLowerCase())
        .reduce((sum, i) => sum + i.count, 0);
}

// Why: a sweep drops the recovered arrows into the pack, and one stack size is one obj id — so nocking is a separate act from holding them, and the count that decides whether a shot can go out is the quiver's.
// Why: `iceArrowsHeld` adds the two together, which is the right question for "is the leg finished" and the wrong one for "can a shot go out" — reading it here left a pack full of swept arrows looking like a loaded bow.

/** What a fight should do next, given what is nocked and what is packed. */
export type ArrowAction = 'shoot' | 'nock' | 'sweep' | 'spent';

/** Decide between shooting, nocking, sweeping and giving up. Pure, so the empty-quiver case is testable. */
export function arrowAction(quiver: number, pack: number, sweepable: boolean): ArrowAction {
    if (quiver > 0) {
        return 'shoot';
    }
    if (pack > 0) {
        return 'nock';
    }
    return sweepable ? 'sweep' : 'spent';
}

/** Move a pack stack into the quiver; true once there is something nocked to shoot. */
async function nockArrows(): Promise<boolean> {
    if (wornArrows() > 0) {
        return true;
    }
    if (Inventory.count(IKOV_NAME.ICE_ARROWS) === 0) {
        return false;
    }
    return Equipment.equip(IKOV_NAME.ICE_ARROWS);
}

/** The Fire Warrior refuses anything but ranged, and only with ice arrows in the quiver. */
async function armForTheWarrior(log: (m: string) => void): Promise<boolean> {
    if (!Equipment.contains(IKOV_NAME.YEW_SHORTBOW) && !(await Equipment.equip(IKOV_NAME.YEW_SHORTBOW))) {
        log('ikov: no yew shortbow to wield');
        return false;
    }
    if (!(await nockArrows())) {
        log('ikov: no ice arrows to nock');
        return false;
    }
    // Why: the warrior refuses anything whose `%damagetype` is not ranged, and rapid is the fastest of the bow's three.
    Game.setCombatMode(RAPID_MODE);
    return true;
}

async function pickUpArrows(log: (m: string) => void): Promise<void> {
    for (let sweep = 0; sweep < 12; sweep++) {
        const drop = GroundItems.query()
            .where(g => (g.name ?? '').toLowerCase() === IKOV_NAME.ICE_ARROWS.toLowerCase())
            .action('Take')
            .within(ARROW_RADIUS)
            .nearest();
        if (!drop) {
            return;
        }
        const where = drop.tile();
        if (drop.distance() > 1) {
            await DirectNavigator.walkTo(where, 0, 6000);
        }
        const still = GroundItems.query()
            .where(g => (g.name ?? '').toLowerCase() === IKOV_NAME.ICE_ARROWS.toLowerCase())
            .action('Take')
            .within(ARROW_RADIUS)
            .nearest();
        if (!still || !(await still.interact('Take'))) {
            return;
        }
        await Execution.delayTicks(2);
    }
    log(`ikov: recovered arrows, ${iceArrowsHeld()} held`);
}

// Why: an empty bow answers every later Attack click with "There is no ammo left in your quiver", and the hobgoblin farm two legs on is what pays for it.
/** Take the bow off once the quiver behind it is empty. */
async function stowSpentBow(log: (m: string) => void): Promise<void> {
    if (!Equipment.contains(IKOV_NAME.YEW_SHORTBOW) || iceArrowsHeld() > 0) {
        return;
    }
    log('ikov: the quiver is spent — stowing the yew shortbow');
    await Equipment.unequip(IKOV_NAME.YEW_SHORTBOW);
}

function walkToFireDoor(log: (m: string) => void): Promise<boolean> {
    return Traversal.walkResilient(IKOV_TILE.FIRE_DOOR_SOUTH, {
        radius: 2,
        attempts: 3,
        timeoutMs: WALK_MS,
        avoidZones: [LAVA_BRIDGE_ZONE],
        log
    });
}

function warrior(): Npc | null {
    return Npcs.query().where(n => n.id === IKOV_NPC.FIRE_WARRIOR).action('Attack').within(15).nearest();
}

// Why: opening the door below the stage does not open it — it summons the warrior on the near side and blasts you back a tile.
async function summonWarrior(log: (m: string) => void): Promise<boolean> {
    if (warrior()) {
        return true;
    }
    const door = Locs.query().where(l => l.id === IKOV_LOC.FIREWARRIOR_DOOR).within(6).nearest();
    if (!door) {
        log('ikov: no fire warrior door in reach');
        return false;
    }
    log('ikov: opening the fire warrior door');
    if (!(await door.interact('Open'))) {
        log('ikov: the fire warrior door refused the click');
        return false;
    }
    const came = await Execution.delayUntil(() => warrior() !== null, 20_000);
    // Why: "no warrior" reads the same whether the cutscene never fired or the scene is being filtered, and the two have different fixes.
    log(came
        ? 'ikov: the Fire Warrior is up'
        : `ikov: no Fire Warrior after the door — scene holds ${tallyNearby()}`);
    return came;
}

function tallyNearby(): string {
    const names = Npcs.query().within(15).results().map(n => `${n.name ?? '?'}#${n.id}`);
    return names.length === 0 ? 'nothing' : [...new Set(names)].join(', ');
}

// Why: a chat modal with no continue button never drains, and a fight loop that keeps yielding to it spins out the guard in silence.

/** Click through what the last op raised; close it outright if it will not drain. */
async function drainDialogue(log?: (m: string) => void): Promise<void> {
    for (let i = 0; i < 20; i++) {
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        if (!ChatDialog.isOpen()) {
            return;
        }
        await Execution.delayTicks(1);
    }
    if (ChatDialog.isOpen()) {
        log?.('ikov: a chat modal would not drain — closing it and fighting on');
        actions.closeModal();
        await Execution.delayTicks(2);
    }
}

/** Shoot the Fire Warrior down with ice arrows and sweep the spent ones up. */
export async function fightFireWarrior(log: (m: string) => void): Promise<boolean> {
    if (!(await escapePocket(log))) {
        return false;
    }
    if (!(await wearFearPendant(log))) {
        return false;
    }
    if (!(await armForTheWarrior(log))) {
        return false;
    }
    // Why: the journal renders stages 20 and 30 alike, so a run interrupted between the search and the pull reads as pulled and finds the door shut.
    if (!(await walkToFireDoor(log))) {
        log('ikov: the trap-lever door is shut — pulling the lever again');
        if (!(await pullTrapLever(log)) || !(await walkToFireDoor(log))) {
            return false;
        }
    }
    if (!(await summonWarrior(log))) {
        return false;
    }

    Game.setAutoRetaliate(true);
    let attacking = -1;
    let missing = 0;
    let swings = 0;
    let refused = 0;
    // Why: a sweep that recovers nothing must not be retried every tick, so the second empty quiver in a row is the end of the fight rather than another circuit of the floor.
    let swept = false;
    // Why: auto-retaliate fights the warrior whether or not our Attack clicks land, so "did a shot go out" is the wrong test for whether the fight happened.
    let engaged = false;
    let lastTick = -1;
    let reported = -1;
    for (let i = 0; i < WARRIOR_GUARD; i++) {
        if (EventSignal.pending()) {
            log('ikov: yielding the Fire Warrior to a random event');
            return false;
        }
        const now = Game.tick();
        if (now === lastTick) {
            await Execution.delayTicks(1);
            continue;
        }
        lastTick = now;
        engaged = engaged || Game.inCombat();
        // Why: every branch below can yield the tick, and a report that only prints on the shooting one leaves a stalled fight silent to the last tick of the guard.
        if (now - reported >= REPORT_TICKS) {
            reported = now;
            const target = warrior();
            log(`ikov: warrior fight hp=${Skills.effective('hitpoints')}/${Skills.level('hitpoints')}`
                + ` arrows=${iceArrowsHeld()} shots=${swings} refused=${refused} engaged=${engaged} food=${canEat()}`
                + ` target=${target ? `${target.tile().x},${target.tile().z}` : 'none'}`
                + ` chat=${ChatDialog.isOpen() ? 'open' : 'closed'}`);
        }
        if (ChatDialog.isOpen() || ChatDialog.canContinue()) {
            await drainDialogue(log);
            continue;
        }
        if (hungry() && canEat()) {
            await Sustain.run();
            continue;
        }
        const npc = warrior();
        if (!npc) {
            attacking = -1;
            missing++;
            if (engaged && missing >= 4) {
                log(`ikov: the Fire Warrior is down after ${swings} shots`);
                await drainDialogue();
                await pickUpArrows(log);
                // Why: the sweep leaves the recovered arrows in the pack, and the next leg reads the quiver — so what was picked up is nocked before the bow comes off.
                await nockArrows();
                await stowSpentBow(log);
                return true;
            }
            // Why: spinning out the full guard on an empty scene costs three minutes and says nothing; the tally names what is standing there.
            if (!engaged && missing >= NEVER_APPEARED) {
                log(`ikov: the Fire Warrior never joined the fight — scene holds ${tallyNearby()}`);
                return false;
            }
            await Execution.delayTicks(1);
            continue;
        }
        missing = 0;
        // Why: 80% of every shot lands on the floor, so an empty quiver mid-fight is a sweep rather than a loss.
        // Why: the quiver is the only count that matters here — `iceArrowsHeld` adds the pack, so a sweep that filled the pack read as armed and every Attack after it answered "There is no ammo left in your quiver" for the rest of the guard.
        const next = arrowAction(wornArrows(), Inventory.count(IKOV_NAME.ICE_ARROWS), !swept);
        if (next !== 'shoot') {
            if (next === 'spent') {
                log('ikov: nothing left to shoot the Fire Warrior with');
                return false;
            }
            if (next === 'sweep') {
                log('ikov: the quiver is empty — sweeping the spent arrows');
                swept = true;
                await pickUpArrows(log);
            }
            if (!(await nockArrows())) {
                log('ikov: nothing left to shoot the Fire Warrior with');
                return false;
            }
            log(`ikov: nocked ${wornArrows()} ice arrows`);
            swept = false;
            attacking = -1;
            continue;
        }
        if (npc.index === attacking && Game.inCombat()) {
            await Execution.delayTicks(1);
            continue;
        }
        if (await npc.interact('Attack')) {
            attacking = npc.index;
            swings++;
            engaged = true;
        } else if (refused++ === 0) {
            const at = npc.tile();
            log(`ikov: the Fire Warrior refused an Attack click at (${at.x},${at.z}), ${npc.distance()} away`);
        }
        await Execution.delayTicks(1);
    }
    log(`ikov: the Fire Warrior outlived ${WARRIOR_GUARD} ticks`);
    return false;
}

function lucien(): Npc | null {
    return Npcs.query().where(n => n.id === IKOV_NPC.LUCIEN_HOSTILE).action('Attack').nearest();
}

/**
 * Kill Lucien for the Armadyl ending. He is level 14 and the pendant is what makes him attackable.
 * @see docs/decisions/quest-pitfalls-26.md
 */
export async function killLucien(log: (m: string) => void): Promise<boolean> {
    if (!Equipment.contains(IKOV_NAME.PENDANT_ARMADYL)) {
        if (!(await Equipment.equip(IKOV_NAME.PENDANT_ARMADYL))) {
            log('ikov: no Armadyl pendant to wear — Lucien cannot be attacked without it');
            return false;
        }
    }
    await stowSpentBow(log);
    if (!(await Traversal.walkResilient(IKOV_TILE.LUCIEN_HUT, { radius: 4, attempts: 3, timeoutMs: 600_000, log }))) {
        return false;
    }
    Game.setAutoRetaliate(true);
    let attacking = -1;
    let missing = 0;
    let swings = 0;
    let engaged = false;
    let lastTick = -1;
    for (let i = 0; i < LUCIEN_GUARD; i++) {
        if (EventSignal.pending()) {
            return false;
        }
        const now = Game.tick();
        if (now === lastTick) {
            await Execution.delayTicks(1);
            continue;
        }
        lastTick = now;
        engaged = engaged || Game.inCombat();
        if (ChatDialog.isOpen() || ChatDialog.canContinue()) {
            await drainDialogue(log);
            continue;
        }
        if (hungry() && canEat()) {
            await Sustain.run();
            continue;
        }
        const npc = lucien();
        if (!npc) {
            attacking = -1;
            missing++;
            if (engaged && missing >= 5) {
                log(`ikov: Lucien is banished after ${swings} attacks`);
                await drainDialogue();
                // Why: the completion scroll is a main modal, and one left up stops the retreat to a bank dead.
                await Modals.closeIfOpen();
                return true;
            }
            await Execution.delayTicks(1);
            continue;
        }
        missing = 0;
        if (npc.index === attacking && Game.inCombat()) {
            await Execution.delayTicks(1);
            continue;
        }
        if (await npc.interact('Attack')) {
            attacking = npc.index;
            swings++;
            engaged = true;
        }
        await Execution.delayTicks(1);
    }
    log(`ikov: Lucien outlived ${LUCIEN_GUARD} ticks`);
    return false;
}

