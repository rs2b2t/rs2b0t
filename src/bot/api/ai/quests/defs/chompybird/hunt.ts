import { Equipment } from '../../../../equipment/Equipment.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { settleScene } from '../../exec/prompts.js';
import {
    ANY_BELLOWS,
    BELLOWS_IDS,
    CB_ID,
    CB_LOC,
    CB_LOC_ID,
    CB_NAME,
    CB_NPC,
    CB_TILE,
    inBaitZone
} from './areas.js';
import { walkTo } from './arrows.js';
import { clearBox } from './dialogue.js';

const held = (id: number): number => Inventory.countById(id);
const heldBellows = (): number | null => ANY_BELLOWS.find(id => held(id) > 0) ?? null;
const heldFilledBellows = (): number | null => BELLOWS_IDS.find(id => held(id) > 0) ?? null;

/** Rantz misses every shot he takes, and the miss is what moves the quest on. */
const RANTZ_MISSED = /rantz keeps missing|de'ese arrows are rubbish/i;

// Why: the chest hands out one pair per account and refuses in a chat line while a pair sits in the bank, so the refusal is what sends the quest to a booth rather than a speculative bank trip first.

/** Set once the chest has said the account already owns a pair. */
export const ChestState = { refused: false };

const CHEST_EMPTY = /find nothing in the ogre chest/i;

// Why: the chest's `Unlock` is a strength roll that drains a level when it fails, so one attempt is not evidence the rock is immovable.

/** Lift the rock and search the ogre chest for the bellows. */
export async function openChest(log: (m: string) => void): Promise<boolean> {
    if (heldBellows() !== null) {
        return true;
    }
    if (!(await walkTo(CB_TILE.CHEST, 3, log))) {
        return false;
    }
    const mark = GameMessages.mark();
    for (let attempt = 0; attempt < 6 && heldBellows() === null; attempt++) {
        await settleScene();
        await clearBox();
        if (GameMessages.sawSince(mark, CHEST_EMPTY)) {
            ChestState.refused = true;
            log('the chest is empty — the account already owns a pair of bellows');
            return false;
        }
        const open = Locs.query().where(l => l.id === CB_LOC_ID.CHEST_OPEN).within(8).nearest();
        if (open) {
            if (!(await open.interact('Search'))) {
                return false;
            }
            await Execution.delayUntil(
                () => heldBellows() !== null || GameMessages.sawSince(mark, CHEST_EMPTY),
                8000
            );
            continue;
        }
        const locked = Locs.query().where(l => l.id === CB_LOC_ID.CHEST).within(8).nearest();
        if (!locked) {
            log(`no ogre chest at (${CB_TILE.CHEST.x},${CB_TILE.CHEST.z})`);
            return false;
        }
        if (!(await locked.interact('Unlock'))) {
            return false;
        }
        await Execution.delayUntil(
            () => Locs.query().where(l => l.id === CB_LOC_ID.CHEST_OPEN).within(8).exists(),
            8000
        );
    }
    await clearBox();
    if (heldBellows() === null) {
        log('the ogre chest gave up no bellows — the account may already own a pair');
        return false;
    }
    return true;
}

// Why: the pool is a block of unwalkable floor, and `nearest()` picks a bubble in the middle of it that no tile is cardinally adjacent to — the op is then sent, accepted, and never lands.

/** Suck a full charge of swamp gas into the bellows. */
async function fillBellows(log: (m: string) => void): Promise<boolean> {
    if (held(CB_ID.BELLOWS3) > 0) {
        return true;
    }
    const id = heldBellows();
    if (id === null) {
        log('no ogre bellows to fill');
        return false;
    }
    if (!(await walkTo(CB_TILE.SWAMP, 2, log))) {
        return false;
    }
    await settleScene();
    const bubbles = Locs.query()
        .name(CB_LOC.BUBBLES)
        .where(l => l.tile().distanceTo(CB_TILE.BUBBLE) <= 1)
        .within(6)
        .nearest();
    const bellows = Inventory.items().find(i => i.id === id);
    if (!bubbles || !bellows) {
        log(`no usable Swamp bubbles beside (${CB_TILE.SWAMP.x},${CB_TILE.SWAMP.z})`);
        return false;
    }
    if (!(await bellows.useOn(bubbles))) {
        return false;
    }
    return Execution.delayUntil(() => held(CB_ID.BELLOWS3) > 0, 10_000);
}

// Why: a toad standing in the pool cannot be reached at all, so a failed inflate tries the next one out rather than the same nearest one again.

async function inflateOne(pick: number, log: (m: string) => void): Promise<boolean> {
    if (heldFilledBellows() === null && !(await fillBellows(log))) {
        return false;
    }
    const id = heldFilledBellows();
    if (id === null) {
        log('the bellows took no swamp gas');
        return false;
    }
    if (!(await walkTo(CB_TILE.SWAMP, 2, log))) {
        return false;
    }
    await settleScene();
    const toads = Npcs.query().name(CB_NPC.TOAD).within(12).results();
    const toad = toads[pick % Math.max(1, toads.length)];
    const bellows = Inventory.items().find(i => i.id === id);
    if (!toad || !bellows) {
        log('no Swamp toad in reach of the pool');
        return false;
    }
    const before = held(CB_ID.TOAD);
    if (!(await bellows.useOn(toad))) {
        return false;
    }
    return Execution.delayUntil(() => held(CB_ID.TOAD) > before, 12_000);
}

// Why: a placed toad lasts about a hundred ticks and only one roll in six brings a chompy, so one toad per pool trip spends the run walking.
// Why: three is the ceiling — inflating a fourth lets one of the others hop away.

/** Fill the pack with bait, up to the three the quest lets you carry. */
export async function catchToad(log: (m: string) => void): Promise<boolean> {
    for (let attempt = 0; attempt < 5 && held(CB_ID.TOAD) < 3; attempt++) {
        await inflateOne(attempt, log);
    }
    return held(CB_ID.TOAD) > 0;
}

const baitPlaced = (): boolean => Npcs.query().name(CB_NAME.TOAD).within(16).exists();

/** Put a bloated toad down in the clearing Rantz pointed at. */
async function dropBait(log: (m: string) => void): Promise<boolean> {
    if (held(CB_ID.TOAD) === 0) {
        log('no Bloated toad to place');
        return false;
    }
    if (!inBaitZone(Game.tile()) && !(await walkTo(CB_TILE.BAIT, 1, log))) {
        return false;
    }
    await settleScene();
    if (!inBaitZone(Game.tile())) {
        log('not standing inside the bait clearing — the toad would be refused');
        return false;
    }
    const toad = Inventory.items().find(i => i.id === CB_ID.TOAD);
    if (!toad) {
        return false;
    }
    const before = held(CB_ID.TOAD);
    // Why: `iop1` on a bloated toad is the quest's placement, not the pack's ordinary drop.
    if (!(await toad.interact('Drop'))) {
        return false;
    }
    const placed = await Execution.delayUntil(() => held(CB_ID.TOAD) < before, 8000);
    await clearBox();
    return placed;
}

// Why: Rantz fires only while the player is inside twenty tiles of him, and the pool is thirty-five tiles the other way, so the bait check is made from the clearing rather than wherever the last step ended.

async function keepBaitDown(log: (m: string) => void): Promise<boolean> {
    if (!inBaitZone(Game.tile())) {
        if (held(CB_ID.TOAD) === 0 && !(await catchToad(log))) {
            return false;
        }
        if (!(await walkTo(CB_TILE.BAIT, 1, log))) {
            return false;
        }
        await settleScene();
    }
    if (baitPlaced()) {
        return true;
    }
    if (held(CB_ID.TOAD) === 0 && !(await catchToad(log))) {
        return false;
    }
    return dropBait(log);
}

const chompyAlive = (): boolean => Npcs.query().name(CB_NPC.CHOMPY).action('Attack').within(16).exists();
const chompyDead = (): boolean => Npcs.query().name(CB_NPC.CHOMPY).action('Pluck').within(16).exists();

// Why: Rantz only fires when the player is inside twenty tiles of him, so the wait happens beside the clearing rather than back at the pool.

/** Bait the clearing and stand by until Rantz has fired and missed. */
export async function watchRantzShoot(log: (m: string) => void): Promise<boolean> {
    const mark = GameMessages.mark();
    for (let round = 0; round < 4; round++) {
        if (!(await keepBaitDown(log))) {
            return false;
        }
        const fired = await Execution.delayUntil(
            () => GameMessages.sawSince(mark, RANTZ_MISSED) || !baitPlaced(),
            60_000
        );
        if (GameMessages.sawSince(mark, RANTZ_MISSED)) {
            log('Rantz shot at the chompy and missed');
            return true;
        }
        if (!fired) {
            log('nothing came to the bait in a minute — re-baiting');
        }
    }
    return GameMessages.sawSince(mark, RANTZ_MISSED);
}

// Why: every shot drops its arrow at the bird's feet, so the six the quest is left with are re-usable and a quiver that runs dry is a walk rather than a wall.

/** Pick the spent arrows up off the floor. */
async function recoverArrows(): Promise<boolean> {
    let taken = false;
    for (let stack = 0; stack < 4; stack++) {
        const spent = GroundItems.query().name(CB_NAME.ARROW).within(16).nearest();
        if (!spent) {
            break;
        }
        const before = held(CB_ID.ARROW);
        if (!(await spent.interact('Take'))) {
            break;
        }
        if (!(await Execution.delayUntil(() => held(CB_ID.ARROW) > before, 8000))) {
            break;
        }
        taken = true;
    }
    return taken;
}

/** Bow in hand and ogre arrows in the quiver. */
async function armForChompy(log: (m: string) => void): Promise<boolean> {
    if (!Equipment.contains(CB_NAME.BOW)) {
        if (held(CB_ID.BOW) === 0) {
            log('no Ogre bow to wield');
            return false;
        }
        if (!(await Equipment.equip(CB_NAME.BOW))) {
            return false;
        }
    }
    if (!Equipment.contains(CB_NAME.ARROW)) {
        if (held(CB_ID.ARROW) === 0) {
            log('no Ogre arrow to quiver');
            return false;
        }
        if (!(await Equipment.equip(CB_NAME.ARROW))) {
            return false;
        }
    }
    return true;
}

async function pluckChompy(log: (m: string) => void): Promise<boolean> {
    const dead = Npcs.query().name(CB_NPC.CHOMPY).action('Pluck').within(16).nearest();
    if (!dead) {
        return false;
    }
    if (!(await dead.interact('Pluck'))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => GroundItems.query().name(CB_NAME.RAW_CHOMPY).within(12).exists(), 12_000))) {
        log('the pluck left no raw chompy on the floor');
        return false;
    }
    const carcass = GroundItems.query().name(CB_NAME.RAW_CHOMPY).within(12).nearest();
    if (!carcass || !(await carcass.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => held(CB_ID.RAW_CHOMPY) > 0, 8000);
}

// Why: the chompy flees anything that stands within two tiles of it, and its own spawn only lasts a hundred ticks, so the shot is taken from range as soon as one lands.

/** Bait, shoot and pluck one chompy bird. */
export async function huntChompy(log: (m: string) => void): Promise<boolean> {
    if (held(CB_ID.RAW_CHOMPY) > 0) {
        return true;
    }
    for (let round = 0; round < 4; round++) {
        if (chompyDead()) {
            return pluckChompy(log);
        }
        if (!Equipment.contains(CB_NAME.ARROW) && held(CB_ID.ARROW) === 0) {
            await recoverArrows();
        }
        if (!(await armForChompy(log))) {
            return false;
        }
        if (!chompyAlive()) {
            if (!(await keepBaitDown(log))) {
                return false;
            }
            if (!(await Execution.delayUntil(() => chompyAlive() || chompyDead() || !baitPlaced(), 60_000))) {
                log('nothing came to the bait in a minute — re-baiting');
                continue;
            }
            if (!chompyAlive() && !chompyDead()) {
                continue;
            }
        }
        const bird = Npcs.query().name(CB_NPC.CHOMPY).action('Attack').within(16).nearest();
        if (bird && !(await bird.interact('Attack'))) {
            return false;
        }
        // Why: every shot spends an arrow and the quiver holds what the fletching leg could make, so a dry
        // quiver mid-fight is answered by picking the spent arrows back up rather than waiting out the window.
        const deadline = performance.now() + 60_000;
        while (performance.now() < deadline && !chompyDead()) {
            if (!Equipment.contains(CB_NAME.ARROW)) {
                await recoverArrows();
                if (!(await armForChompy(log))) {
                    break;
                }
                const again = Npcs.query().name(CB_NPC.CHOMPY).action('Attack').within(16).nearest();
                if (again) {
                    await again.interact('Attack');
                }
            }
            await Execution.delayTicks(2);
        }
        if (chompyDead()) {
            return pluckChompy(log);
        }
        log('the chompy outlasted its shot window');
    }
    return held(CB_ID.RAW_CHOMPY) > 0;
}
