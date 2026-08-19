import { EventSignal } from '../../../../execution/EventSignal.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Npcs, type Npc } from '../../../../npcs/Npcs.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { talkAndClose, talkUntil } from '../../exec/legs.js';
import { enterHideout, talkInHideout } from '../shieldofarrav/hideout.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import {
    ALFONSE,
    CHARLIE,
    HERO_ID,
    HERO_NAMED,
    HERO_NPC,
    HERO_SHOP,
    HERO_TILE,
    STRAVEN_ARMBAND,
    STRAVEN_TASK,
    inSideRoom
} from './areas.js';
import { crossSideDoorIn, enterKitchen, pushPanel, returnToStreet } from './doors.js';
import { HERO_STAGE } from './journal.js';
import { kitOwned, kitStep, type Purchasable } from './shops.js';
import { heldId } from './state.js';

// Why: the side room is sealed from the mansion by a `snipable_wall`, which carries blockrange=no —
// Grip is shootable through it and unreachable by every other means, so this branch needs a bow.
const SNIPE_KIT: readonly Purchasable[] = [
    { id: HERO_ID.OAK_LONGBOW, name: HERO_NAMED.OAK_LONGBOW, qty: 1, sources: [{ ...HERO_SHOP.LOWE, gp: 1_000 }] },
    { id: HERO_ID.STEEL_ARROW, name: HERO_NAMED.STEEL_ARROW, qty: 150, sources: [{ ...HERO_SHOP.LOWE, gp: 15_000 }] }
];

const SNIPE_MS = 180_000;
/** An oak longbow reaches nine tiles; Grip is lured to three, which leaves the row clear. */
const SNIPE_RANGE = 9;
const GROUND_RANGE = 12;

/** The bow and the arrows, in whatever state they are in: bought, withdrawn, then worn. */
export function snipeKitStep(snap: QuestSnapshot): QuestStep | null {
    return kitStep(snap, SNIPE_KIT);
}

export function snipeKitOwned(snap: QuestSnapshot): boolean {
    return kitOwned(snap, SNIPE_KIT);
}

export function talkToStraven(log: (m: string) => void): Promise<boolean> {
    return talkInHideout(STRAVEN_TASK, STRAVEN_TASK.prefer, log);
}

export function talkToAlfonse(log: (m: string) => void): Promise<boolean> {
    return talkAndClose(ALFONSE, ALFONSE.prefer, log);
}

/** Charlie is behind the kitchen door, which only opens once Alfonse has heard the password. */
export async function talkToCharlie(log: (m: string) => void): Promise<boolean> {
    // Why: the kitchen is a sealed pocket in the baked graph, so walking at Charlie from the restaurant
    // reads `unreachable` — the door is the module's to cross, not the navigator's.
    if (!(await enterKitchen(log))) {
        return false;
    }
    return talkAndClose(CHARLIE, CHARLIE.prefer, log);
}

function grip(): Npc | null {
    return Npcs.query().where(n => n.id === HERO_NPC.GRIP).nearest();
}

function keyringOnFloor(): boolean {
    return GroundItems.query().where(g => g.id === HERO_ID.GRIP_KEYS).within(GROUND_RANGE).nearest() !== null;
}

// Why: Grip's spawn is six tiles from the slit, in bow range and behind three walls, so the server
// drops every attack there — the slit's own row is the only line, and the cabinet walks him onto it.
function gripOnTheRow(): Npc | null {
    const target = grip();
    const here = Game.tile();
    const tile = target?.tile();
    if (!target || !tile || !here || tile.level !== here.level) {
        return null;
    }
    if (tile.z !== HERO_TILE.ARROW_SLIT.z || here.z !== HERO_TILE.ARROW_SLIT.z) {
        return null;
    }
    return Math.abs(tile.x - here.x) <= SNIPE_RANGE ? target : null;
}

/** Kitchen, secret panel, garden, yard, side door, arrow slit. */
export async function reachArrowSlit(log: (m: string) => void): Promise<boolean> {
    if (!inSideRoom(Game.tile())) {
        if (!(await pushPanel(log))) {
            return false;
        }
        if (!(await crossSideDoorIn(log))) {
            return false;
        }
    }
    return Traversal.walkResilient(HERO_TILE.ARROW_SLIT, { radius: 0, attempts: 3, timeoutMs: 30_000, log });
}

// Why: Grip only crosses onto the slit's row while the rival is opening his drinks cabinet, so this
// loop waits rather than walking — every route to him is a wall.

/** Shoot Grip through the arrow slit whenever the rival's lure puts him in range. */
export async function snipeGrip(log: (m: string) => void): Promise<boolean> {
    if (!(await reachArrowSlit(log))) {
        return false;
    }
    const deadline = performance.now() + SNIPE_MS;
    let attacking = -1;
    let swings = 0;
    let waited = false;
    while (performance.now() < deadline) {
        if (EventSignal.pending()) {
            log('snipe: yielding to a random event');
            return false;
        }
        // Why: the keyring is `obj_addall`ed on death, so it is the one thing this side of the wall
        // can see that proves the kill landed.
        if (keyringOnFloor()) {
            log(`Grip is down after ${swings} shots`);
            return true;
        }
        await Sustain.run();
        const target = gripOnTheRow();
        if (!target) {
            if (!waited) {
                log('waiting for the rival to walk Grip onto the arrow slit row');
                waited = true;
            }
            attacking = -1;
            await Execution.delayTicks(2);
            continue;
        }
        if (target.index === attacking && Game.inCombat()) {
            await Execution.delayTicks(1);
            continue;
        }
        if (await target.interact('Attack')) {
            if (swings === 0) {
                log('Grip is on the row — shooting through the arrow slit');
            }
            attacking = target.index;
            swings++;
        }
        await Execution.delayTicks(1);
    }
    log(`Grip outlived ${SNIPE_MS / 1000}s at the arrow slit (${swings} shots)`);
    return false;
}

/** Straven is underground in the Varrock hideout, so the cellar ladder comes before the conversation. */
export async function handInCandlestick(log: (m: string) => void): Promise<boolean> {
    if (!(await returnToStreet(log))) {
        return false;
    }
    if (!(await enterHideout(log))) {
        return false;
    }
    return talkUntil(STRAVEN_ARMBAND, STRAVEN_ARMBAND.prefer,
        () => Inventory.countById(HERO_ID.ARMBAND) > 0, log, 60_000);
}

/** The Phoenix half of the armband, from Straven's task to his reward. */
export function phoenixArmbandStep(snap: QuestSnapshot, stage: number): QuestStep | null {
    switch (stage) {
        case HERO_STAGE.STARTED:
            return { kind: 'custom', name: 'ask Straven about the master thief armband', run: talkToStraven };

        case HERO_STAGE.PHOENIX_SPOKEN: {
            // Why: the bow is bought in Varrock, where Straven already stands — buying it after the
            // crossing costs a return ferry and a walk across two kingdoms.
            const kit = snipeKitOwned(snap) ? null : snipeKitStep(snap);
            if (kit) {
                return kit;
            }
            return { kind: 'custom', name: 'give Alfonse the password', run: talkToAlfonse };
        }

        case HERO_STAGE.PHOENIX_ALFONSE:
            return { kind: 'custom', name: 'ask Charlie about the secret door', run: talkToCharlie };

        case HERO_STAGE.PHOENIX_CHARLIE: {
            const kit = snipeKitStep(snap);
            if (kit) {
                return kit;
            }
            return { kind: 'custom', name: 'shoot Grip through the arrow slit', run: snipeGrip };
        }

        case HERO_STAGE.PHOENIX_KILLED_GRIP:
            if (heldId(snap, HERO_ID.CANDLESTICK) === 0) {
                return { kind: 'wait', reason: 'waiting on the rival to hand over a candlestick' };
            }
            return { kind: 'custom', name: 'give Straven the candlestick', run: handInCandlestick };

        default:
            return null;
    }
}
