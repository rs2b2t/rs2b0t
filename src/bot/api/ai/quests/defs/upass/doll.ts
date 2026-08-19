import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { Equipment } from '../../../../equipment/Equipment.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { Reachability } from '../../../../../event/webwalk/geometry/Reachability.js';
import type { Npc } from '../../../../model/Npc.js';
import Tile from '../../../../../geometry/Tile.js';
import { driveUntil, heldId, settleScene } from '../../exec/prompts.js';
import type { QuestSnapshot } from '../../engine/types.js';
import { UP_AMULETS, UP_ITEM, UP_LOC, UP_NPC, UP_TILE, countHeld, insideIbanTemple, type UpassItem } from './areas.js';
import { locById, walkTo } from './bridge.js';

/** Rub an element into the doll. */
async function rubIntoDoll(element: UpassItem, log: (m: string) => void): Promise<boolean> {
    const held = Inventory.items().find(item => item.id === element.id);
    const doll = Inventory.items().find(item => item.id === UP_ITEM.DOLL.id);
    if (!held || !doll) {
        log(`missing ${held ? 'the doll' : element.name} to complete the doll`);
        return false;
    }
    if (!(await held.useOn(doll))) {
        return false;
    }
    return driveUntil(() => heldId(element.id) === 0, [], log, 20_000);
}

export const rubAshes = (log: (m: string) => void): Promise<boolean> => rubIntoDoll(UP_ITEM.ASHES, log);
export const rubShadow = (log: (m: string) => void): Promise<boolean> => rubIntoDoll(UP_ITEM.SHADOW, log);
export const rubDove = (log: (m: string) => void): Promise<boolean> => rubIntoDoll(UP_ITEM.DOVE, log);

/** Bucket under the dwarves' brew barrel. */
export async function fillBrew(log: (m: string) => void): Promise<boolean> {
    if (heldId(UP_ITEM.DWARF_BREW.id) > 0) {
        return true;
    }
    if (!(await walkTo(UP_TILE.BREW_BARREL, 3, log))) {
        return false;
    }
    await settleScene();
    const barrel = locById(UP_LOC.BREW_BARREL, null, 8);
    const bucket = Inventory.items().find(item => item.id === UP_ITEM.BUCKET.id);
    if (!barrel || !bucket) {
        log(`missing ${barrel ? 'an empty bucket' : 'the brew barrel'}`);
        return false;
    }
    if (!(await bucket.useOn(barrel))) {
        return false;
    }
    return driveUntil(() => heldId(UP_ITEM.DWARF_BREW.id) > 0, [], log, 12_000);
}

// Why: the tomb only takes the brew once the doll is in hand, and only burns after it is soaked —
// so the pour and the light are two separate uses of the same loc, in that order.

/** Pour the brew over Iban's tomb, then light it, and take the ashes. */
export async function burnTomb(log: (m: string) => void): Promise<boolean> {
    if (heldId(UP_ITEM.ASHES.id) > 0) {
        return true;
    }
    if (!(await walkTo(UP_TILE.IBAN_TOMB, 3, log))) {
        return false;
    }
    await settleScene();
    if (heldId(UP_ITEM.DWARF_BREW.id) > 0) {
        const tomb = locById(UP_LOC.IBAN_TOMB_L, null, 8) ?? locById(UP_LOC.IBAN_TOMB_R, null, 8);
        const brew = Inventory.items().find(item => item.id === UP_ITEM.DWARF_BREW.id);
        if (!tomb || !brew) {
            log('no tomb to pour the brew over');
            return false;
        }
        if (!(await brew.useOn(tomb))) {
            return false;
        }
        if (!(await driveUntil(() => heldId(UP_ITEM.DWARF_BREW.id) === 0, [], log, 15_000))) {
            log('the tomb would not take the brew');
            return false;
        }
    }
    const tomb = locById(UP_LOC.IBAN_TOMB_L, null, 8) ?? locById(UP_LOC.IBAN_TOMB_R, null, 8);
    const tinderbox = Inventory.items().find(item => item.id === UP_ITEM.TINDERBOX.id);
    if (!tomb || !tinderbox) {
        log(`missing ${tomb ? 'a tinderbox' : 'the tomb'} to burn the corpse`);
        return false;
    }
    if (!(await tinderbox.useOn(tomb))) {
        return false;
    }
    return driveUntil(() => heldId(UP_ITEM.ASHES.id) > 0, [], log, 20_000);
}

// Why: an NPC that dies leaves the scene, so "the target is gone" is the only completion signal that does
// not depend on a drop landing or on a journal line the engine has not re-read yet.
async function killNpc(npcId: number, near: Tile, name: string, log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(near, 5, log))) {
        return false;
    }
    await settleScene();
    const find = (): Npc | null => Npcs.query().where(npc => npc.id === npcId).within(20).nearest();
    const target = find();
    if (!target) {
        log(`no ${name} near (${near.x},${near.z}) — already dead this spawn`);
        return true;
    }
    if (!(await target.interact('Attack'))) {
        log(`could not attack ${name}`);
        return false;
    }
    if (!(await driveUntil(() => find() === null, [], log, 180_000))) {
        return false;
    }
    // Why: these all wander, so one absent poll is "walked out of the query", not "dead" — and a false kill
    // sends the leg on to look for a drop that was never made. It has to still be gone a moment later.
    await Execution.delayTicks(3);
    if (find() !== null) {
        log(`${name} only wandered out of range`);
        return false;
    }
    return true;
}

/** Kalrag's fluids smear onto the doll on her death, so the doll has to be in the pack. */
export async function killKalrag(log: (m: string) => void): Promise<boolean> {
    if (heldId(UP_ITEM.DOLL.id) === 0) {
        log('no doll of Iban in the pack — killing Kalrag now would waste the blood');
        return false;
    }
    return killNpc(UP_NPC.KALRAG, UP_TILE.KALRAG, 'Kalrag', log);
}

const DEMONS: readonly { npc: number; amulet: UpassItem; tile: Tile; name: string }[] = [
    { npc: UP_NPC.DOOMION, amulet: UP_ITEM.AMULET_DOOMION, tile: UP_TILE.DOOMION, name: 'Doomion' },
    { npc: UP_NPC.HOLTHION, amulet: UP_ITEM.AMULET_HOLTHION, tile: UP_TILE.HOLTHION, name: 'Holthion' },
    { npc: UP_NPC.OTHAINIAN, amulet: UP_ITEM.AMULET_OTHAINIAN, tile: UP_TILE.OTHAINIAN, name: 'Othainian' }
];

export function amuletsHeld(snap: QuestSnapshot): number {
    return countHeld(snap, UP_AMULETS);
}

/** Kill whichever demon still owes an amulet, then take it off the floor. */
export async function killDemon(log: (m: string) => void): Promise<boolean> {
    const owed = DEMONS.find(d => heldId(d.amulet.id) === 0);
    if (!owed) {
        return true;
    }
    if (!(await killNpc(owed.npc, owed.tile, owed.name, log))) {
        return false;
    }
    const drop = GroundItems.query().where(item => item.id === owed.amulet.id).within(10).nearest();
    if (!drop) {
        log(`${owed.name} died but left no amulet in reach`);
        return false;
    }
    if (!(await drop.interact('Take'))) {
        return false;
    }
    return driveUntil(() => heldId(owed.amulet.id) > 0, [], log, 10_000);
}

/** The three amulets unseal the chest that holds Iban's shadow. */
export async function openSealedChest(log: (m: string) => void): Promise<boolean> {
    if (heldId(UP_ITEM.SHADOW.id) > 0) {
        return true;
    }
    if (!(await walkTo(UP_TILE.SEALED_CHEST, 3, log))) {
        return false;
    }
    await settleScene();
    const chest = locById(UP_LOC.SEALED_CHEST, null, 8);
    const op = chest?.actions()[0];
    if (!chest || !op || !(await chest.interact(op))) {
        log('no sealed chest on the demons platform');
        return false;
    }
    return driveUntil(() => heldId(UP_ITEM.SHADOW.id) > 0, [], log, 20_000);
}

// Why: the cage is an `aploc`, and its script force-walks and then returns in silence if the character is further than two tiles from the loc's own coordinate. A radius of three satisfies the walk and fails the script, so the approach is tight and the failure says what the game said.

/** Search the soulless cages for Iban's dove; the gauntlets are what stop the bite. */
export async function searchCages(log: (m: string) => void): Promise<boolean> {
    if (heldId(UP_ITEM.DOVE.id) > 0) {
        return true;
    }
    if (!(await walkTo(UP_TILE.CAGE_DOVE, 1, log))) {
        return false;
    }
    await settleScene();
    const cage = locById(UP_LOC.CAGE_DOVE, null, 8);
    const op = cage?.actions()[0];
    if (!cage || !op) {
        const at = Game.tile();
        log(`no soulless cage holding the dove within eight of (${at?.x},${at?.z})`);
        return false;
    }
    const mark = GameMessages.mark();
    if (!(await cage.interact(op))) {
        log(`'${op}' would not send at the cage`);
        return false;
    }
    if (await driveUntil(() => heldId(UP_ITEM.DOVE.id) > 0, [], log, 20_000)) {
        return true;
    }
    const at = Game.tile();
    const said = GameMessages.since(mark).map(m => m.text).filter(t => !t.startsWith('get ')).slice(-3).join(' / ');
    log(`the cage gave no dove from (${at?.x},${at?.z}) — said: ${said || 'nothing'}`);
    return false;
}

// Why: the doors only open for a follower of Zamorak wearing the robes and nothing else — the script counts worn slots and wants two of them — so the armour comes off here and goes back on after the throw. The robes come off an Iban disciple: level thirteen, twenty hitpoints, and a dozen of them line the approach.

// Why: thirteen disciples line the approach and `nearest()` picked one through the temple wall — the attack sent, nothing happened, and the step sat out all three minutes of its wait in silence, twice. Proximity is not reach. Take them in order of distance but only where a cardinal neighbour can be stood on, give each one a short wait rather than one long one, and say what happened when none of them dies.

/** Kill a disciple for both halves of the robe of Zamorak. */
async function robeFromDisciple(log: (m: string) => void): Promise<boolean> {
    const dressed = (): boolean => heldId(UP_ITEM.ZAM_TOP.id) > 0 && heldId(UP_ITEM.ZAM_BOTTOM.id) > 0;
    if (dressed()) {
        return true;
    }
    if (!(await walkTo(UP_TILE.DISCIPLE, 6, log))) {
        return false;
    }
    await settleScene();
    const standable = (npc: Npc): boolean => {
        const t = npc.tile();
        return [[1, 0], [-1, 0], [0, 1], [0, -1]]
            .some(([dx, dz]) => Reachability.canReach(new Tile(t.x + dx!, t.z + dz!, t.level),
                { adjacentOk: true, maxSteps: 600 }));
    };
    const tried: string[] = [];
    for (let round = 0; round < 4 && !dressed(); round++) {
        const target = Npcs.query()
            .where(npc => npc.id === UP_NPC.DISCIPLE)
            .within(20)
            .results()
            .filter(standable)
            .sort((a, b) => a.distance() - b.distance())[0];
        if (!target) {
            const at = Game.tile();
            log(`no Iban disciple in reach of (${at?.x},${at?.z}) — tried ${tried.join(' ') || 'none'}`);
            return false;
        }
        const where = target.tile();
        const mark = GameMessages.mark();
        // Why: disciples wander, so "no disciple on that tile any more" is satisfied by one walking away and
        // reported four kills that never happened. The server index is the identity that dies.
        const slot = target.index;
        const gone = (): boolean => Npcs.query().where(npc => npc.index === slot).nearest() === null;
        if (await target.interact('Attack') && await driveUntil(gone, [], log, 45_000)) {
            for (const robe of [UP_ITEM.ZAM_TOP, UP_ITEM.ZAM_BOTTOM]) {
                const drop = GroundItems.query().where(item => item.id === robe.id).within(10).nearest();
                if (drop && await drop.interact('Take')) {
                    await driveUntil(() => heldId(robe.id) > 0, [], log, 10_000);
                }
            }
            tried.push(`(${where.x},${where.z})dead`);
            continue;
        }
        const said = GameMessages.since(mark).map(m => m.text).filter(t => !t.startsWith('get ')).slice(-1).join('');
        tried.push(`(${where.x},${where.z})${said || 'nothing'}`);
    }
    if (dressed()) {
        return true;
    }
    log(`no pair of robes off four disciples — ${tried.join(' | ')}`);
    return false;
}

// Why: everything the pass asked to be carried has been used by now — the rope, the spade, the bucket, the bow and its arrows, and the book that came out of Kardia's chest with the doll. The pack arrives at the temple with four or five slots and the strip needs six, so the spent kit goes on the floor to make room.
const SPENT: readonly UpassItem[] = [
    UP_ITEM.ROPE, UP_ITEM.SPADE, UP_ITEM.BUCKET, UP_ITEM.SHORTBOW, UP_ITEM.BRONZE_ARROW, UP_ITEM.HISTORY
];

async function shedSpentKit(need: number, log: (m: string) => void): Promise<void> {
    const dropped: string[] = [];
    for (const spent of SPENT) {
        if (Inventory.free() >= need) {
            break;
        }
        const item = Inventory.items().find(i => i.id === spent.id);
        const op = item?.actions().find(o => /drop/i.test(o));
        if (item && op && await item.interact(op)) {
            await Execution.delayTicks(1);
            dropped.push(spent.name);
        }
    }
    if (dropped.length > 0) {
        log(`dropped ${dropped.join(', ')} to make room for the robes`);
    }
}

/** Strip to the robes: the door counts worn slots, so everything else has to come off first. */
async function wearOnlyRobes(log: (m: string) => void): Promise<boolean> {
    await shedSpentKit(Equipment.items().length, log);
    for (const worn of Equipment.items()) {
        const name = worn.name;
        if (name !== null && !(await Equipment.unequip(name))) {
            log(`could not take off ${name}`);
            return false;
        }
    }
    for (const robe of [UP_ITEM.ZAM_TOP, UP_ITEM.ZAM_BOTTOM]) {
        const item = Inventory.items().find(i => i.id === robe.id);
        const op = item?.actions().find(o => /wear|wield|equip/i.test(o));
        if (!item || !op || !(await item.interact(op))) {
            log(`the ${robe.name} would not go on`);
            return false;
        }
        await Execution.delayTicks(2);
    }
    return Equipment.items().length === 2;
}

// Why: opening a door does not move anyone through it — the loc swaps to its open variant and the player
// stays put — so the walk inside is a second step, and standing on the temple floor is the only proof.

/** Iban's temple doors, and the walk through them. */
export async function openIbanDoor(log: (m: string) => void): Promise<boolean> {
    if (!insideIbanTemple(Game.tile())) {
        const robed = (): boolean => {
            const on = Equipment.items();
            return on.length === 2 && on.every(i => i.id === UP_ITEM.ZAM_TOP.id || i.id === UP_ITEM.ZAM_BOTTOM.id);
        };
        if (!robed() && !(await robeFromDisciple(log) && await wearOnlyRobes(log))) {
            return false;
        }
        if (!(await walkTo(UP_TILE.IBAN_DOOR, 3, log))) {
            return false;
        }
        await settleScene();
        const shut = locById(UP_LOC.IBAN_DOOR_L, null, 8) ?? locById(UP_LOC.IBAN_DOOR_R, null, 8);
        const op = shut?.actions()[0];
        if (shut && op) {
            if (!(await shut.interact(op))) {
                log("the doors on Iban's temple would not open");
                return false;
            }
            // Why: the script force-moves the player a tile west as it opens, so the door is the entry — there is no walk to make afterwards, and nothing to make it on. A flood of the pack over the temple finds no walkable floor at all, the altar and Iban's own tile included.
            await driveUntil(() => insideIbanTemple(Game.tile()), [], log, 12_000);
        }
    }
    if (insideIbanTemple(Game.tile())) {
        return true;
    }
    const at = Game.tile();
    log(`still outside the temple at (${at?.x},${at?.z})`);
    return false;
}

/** The doll into the pit of the damned. */
export async function throwDoll(log: (m: string) => void): Promise<boolean> {
    if (!insideIbanTemple(Game.tile())) {
        const at = Game.tile();
        log(`not in the temple to throw the doll — standing at (${at?.x},${at?.z})`);
        return false;
    }
    await settleScene();
    // Why: no walk first. The temple floor is not in the collision pack, so any radius-based approach reports unreachable from a tile the character is already standing on. A use-on-loc leaves the pathing to the server, which is the only thing here that can see the floor.
    const altar = locById(UP_LOC.IBAN_ALTAR, null, 16);
    const doll = Inventory.items().find(item => item.id === UP_ITEM.DOLL.id);
    if (!altar || !doll) {
        log(`missing ${altar ? 'the doll of Iban' : 'the well of the damned'}`);
        return false;
    }
    const mark = GameMessages.mark();
    if (!(await doll.useOn(altar))) {
        log('the doll would not go on the well');
        return false;
    }
    if (await driveUntil(() => heldId(UP_ITEM.DOLL.id) === 0, [], log, 30_000)) {
        return true;
    }
    const said = GameMessages.since(mark).map(m => m.text).filter(t => !t.startsWith('get ')).slice(-3).join(' / ');
    log(`the well kept the doll — said: ${said || 'nothing'}`);
    return false;
}
