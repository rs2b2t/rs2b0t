import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { Equipment } from '../../../../equipment/Equipment.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { Skills } from '../../../../skills/Skills.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { Reachability } from '../../../../../event/webwalk/geometry/Reachability.js';
import type { Npc } from '../../../../model/Npc.js';
import Tile from '../../../../../geometry/Tile.js';
import { driveUntil, heldId, settleScene } from '../../exec/prompts.js';
import type { QuestSnapshot } from '../../engine/types.js';
import { UP_AMULETS, UP_ITEM, UP_LOC, UP_NPC, UP_TILE, countHeld, insideIbanTemple, type UpassItem } from './areas.js';
import { locById, walkTo } from './bridge.js';
import { dropJunk } from './junk.js';
import { BOW_IDS, FOOD_RETREAT } from './supplies.js';

let restocks = 0;
/** Meals fetched from Kamen this run, for the log. The budget is the purse, which the bank refills after every death. */
export const restocksUsed = (): number => restocks;
export const noteRestock = (): void => { restocks += 1; };

const FOOD_WORDS = ['lobster', 'meat pie', 'meat pizza', 'bread', 'stew'];
/** `giantspider_attack` from seq.pack; blessed spiders and Kalrag share it, and it marks the add that just hit us even when its facing has not caught up. */
const SPIDER_ATTACK_ANIM = 143;
/** North of Kalrag's cave, far enough for the spiders to drop aggro but a short walk back. */
const KALRAG_ESCAPE = new Tile(2340, 9840, 0);
/** Total edible items in the pack right now. */
export function foodHeldNow(): number {
    return Inventory.items().reduce((sum, item) =>
        sum + (item.name !== null && FOOD_WORDS.includes(item.name.toLowerCase()) ? item.count : 0), 0);
}

/** Run out of melee so a losing fight resets instead of standing there until the last lobster is gone. */
async function breakOff(near: Tile, log: (m: string) => void, fleeTo?: Tile): Promise<void> {
    if (fleeTo) {
        log(`backing off to (${fleeTo.x},${fleeTo.z})`);
        await walkTo(fleeTo, 3, log);
        return;
    }
    const at = Game.tile();
    if (!at) {
        return;
    }
    const dx = Math.sign(at.x - near.x) || 1;
    const dz = Math.sign(at.z - near.z);
    const away = new Tile(at.x + dx * 12, at.z + dz * 12, at.level);
    log(`backing off toward (${away.x},${away.z})`);
    await walkTo(away, 3, log);
}

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

// Why: the tomb only takes the brew with the doll in hand and only burns once soaked, so the pour and the light are 2 uses of the same loc, in that order.

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

// Why: a dead NPC leaves the scene, so "the target is gone" is the one completion signal that doesn't depend on a drop or a stale journal line.
async function killNpc(npcId: number, near: Tile, name: string, log: (m: string) => void, canFetchFood = false, fleeTo?: Tile): Promise<boolean> {
    if (!(await walkTo(near, 2, log))) {
        return false;
    }
    await settleScene();
    const find = (): Npc | null => Npcs.query().where(npc => npc.id === npcId).within(20).nearest();
    const target = find();
    if (!target) {
        log(`no ${name} near (${near.x},${near.z}) — already dead this spawn`);
        return true;
    }
    const deadline = performance.now() + 180_000;
    const began = performance.now();
    let focusIndex = -1;
    let focusName = name;
    let focusHealth = 0;
    let lastOffense = began;
    let lastAttacked = -1;
    let refused = 0;
    let dealt = false;
    let stalls = 0;
    let dead = false;
    while (performance.now() < deadline) {
        // Why: a quest step owns the tick, so the module's sustain never runs between hits unless this loop spends a tick on it; Kalrag killed a 1-Prayer account that way.
        await Sustain.run();
        if (Inventory.free() < 2) {
            await dropJunk(log);
        }
        const live = find();
        if (!live || (live.health === 0 && live.snap.totalHealth > 0)) {
            dead = true;
            break;
        }
        // Why: the kill is checked first; aborting on food while the target is already dead is how an amulet was left on the floor. Only a living target sends the fight back to Kamen.
        if (canFetchFood && foodHeldNow() <= FOOD_RETREAT) {
            log(`down to ${foodHeldNow()} food — breaking off to restock`);
            await breakOff(near, log, fleeTo);
            return false;
        }
        const now = performance.now();
        // Why: the server refuses an Attack on the main target while a different single-way NPC hit us in the last 8 ticks ("I'm already under attack"), so a blessed spider on our back has to die first. The one mid-attack is the safest pick: facing can lag a tick, and with several spiders on us the nearest one may not be the aggressor.
        const nearby = Npcs.query()
            .where(npc => npc.index !== live.index && npc.health > 0)
            .within(8)
            .results();
        // Why: the player can only swing at one NPC, so two or more melee spiders is a damage race a 1-Prayer account loses. Once the bar is down to 60%, run clear instead of trading; Kalrag's hunt range can follow, the spiders' usually cannot.
        const onUs = nearby.filter(npc => npc.targetsMe() || npc.snap.anim === SPIDER_ATTACK_ANIM);
        if (onUs.length >= 2 && fleeTo && Skills.effective('hitpoints') < Skills.level('hitpoints') * 0.6) {
            log(`${onUs.length} spiders on us — running clear`);
            await breakOff(live.tile(), log, fleeTo);
            await Execution.delayTicks(10);
            lastOffense = performance.now();
            lastAttacked = -1;
            dealt = false;
            continue;
        }
        const blocker = nearby.find(npc => npc.snap.anim === SPIDER_ATTACK_ANIM)
            ?? nearby.find(npc => npc.targetsMe())
            ?? null;
        const anchor = live.tile();
        const focus = blocker ?? live;
        if (focus.index !== focusIndex) {
            focusIndex = focus.index;
            focusName = focus.name ?? name;
            focusHealth = focus.health;
            lastOffense = now;
            dealt = false;
        }
        // Why: the add is melee and walks to us, so chasing one more than 4 tiles from Kalrag only drags the fight out of her room; kill it where it stands and keep Kalrag in reach the rest of the time.
        const focusTile = focus.tile();
        const nearAnchor = Math.max(Math.abs(focusTile.x - anchor.x), Math.abs(focusTile.z - anchor.z)) <= 4;
        const beforeWalk = Game.tile();
        const far = beforeWalk !== null && Math.max(Math.abs(focusTile.x - beforeWalk.x), Math.abs(focusTile.z - beforeWalk.z)) > 2;
        if (far && (focus.index === live.index || nearAnchor)) {
            // Why: Kalrag and the demons are 3x3, so radius 2 from the centre tile is one tile from the body. Radius 1 sits inside the footprint and the walker retries forever without ever attacking.
            if (!(await walkTo(focusTile, 2, log))) {
                log(`${focusName} out of reach at (${focusTile.x},${focusTile.z})`);
                return false;
            }
        }
        if (focus.health < focusHealth) {
            lastOffense = now;
            dealt = true;
            stalls = 0;
        }
        focusHealth = focus.health;
        // Why: only one NPC can be attacked, and the server drops a click sent while another NPC landed the last hit. Re-send the Attack every 2.5s until damage shows, rather than trusting a click the server may have refused.
        const at = Game.tile();
        const inReach = at !== null && Math.max(Math.abs(focusTile.x - at.x), Math.abs(focusTile.z - at.z)) <= 2;
        if ((inReach || focus.index === live.index) && (focusIndex !== lastAttacked || now - lastOffense >= 2_500)) {
            if (await focus.interact('Attack')) {
                lastAttacked = focusIndex;
                refused = 0;
            } else if (refused++ === 0) {
                log(`${focusName} refused an Attack click — waiting out the combat block`);
            }
        }
        const patience = dealt ? 12_000 : 20_000;
        if (now - lastOffense >= patience) {
            stalls++;
            log(`no damage on ${focusName} for ${patience / 1000}s at ${Skills.effective('hitpoints')}/${Skills.level('hitpoints')} hp`);
            // Why: the combat block rotates with whoever hit last, so a stall is often the wrong target; try the other NPC before giving up the room.
            if (stalls >= 3) {
                await breakOff(anchor, log, fleeTo);
                return false;
            }
            focusIndex = -1;
            lastAttacked = -1;
            dealt = false;
            lastOffense = now;
            continue;
        }
        await Execution.delayTicks(1);
    }
    if (!dead) {
        log(`${name} outlasted the fight at ${Skills.effective('hitpoints')}/${Skills.level('hitpoints')} hp`);
        return false;
    }
    // Why: these all wander, so one absent poll can be "walked out of the query", and a false kill sends the leg looking for a drop that was never made. It has to still be gone a moment later.
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
    return killNpc(UP_NPC.KALRAG, UP_TILE.KALRAG, 'Kalrag', log, true, KALRAG_ESCAPE);
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
    const killed = await killNpc(owed.npc, owed.tile, owed.name, log, true);
    // Why: the killing tick can end the loop on a food break-off; if the demon is gone the fight was won, so the drop still has to be collected before any restock trip.
    const gone = Npcs.query().where(npc => npc.id === owed.npc).within(20).nearest() === null;
    if (!killed && !gone) {
        return false;
    }
    // Why: the amulet is added by the death script a tick after the hp bar empties, so a single query after the fight loses it to the lootdrop timer.
    const findDrop = () => GroundItems.query().where(item => item.id === owed.amulet.id).within(20).nearest();
    if (!(await driveUntil(() => findDrop() !== null, [], log, 8_000))) {
        // Why: a collapsed bridge can finish the kill out of the loaded scene; returning to the demon's stand is what brings the drop back into query range.
        await walkTo(owed.tile, 3, log);
        if (!(await driveUntil(() => findDrop() !== null, [], log, 8_000))) {
            log(`${owed.name} died but left no amulet in reach`);
            return false;
        }
    }
    const drop = findDrop();
    if (!drop || !(await walkTo(drop.tile(), 1, log)) || !(await drop.interact('Take'))) {
        return false;
    }
    return driveUntil(() => heldId(owed.amulet.id) > 0, [], log, 10_000);
}

/** The 3 amulets unseal the chest that holds Iban's shadow. */
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

// Why: the cage is an `aploc` whose script force-walks and returns in silence if you're more than 2 tiles from the loc's coordinate, so a radius of 3 satisfies the walk and fails the script. The approach is tight and the failure quotes the chat.

/** Search the soulless cages for Iban's dove; the gauntlets stop the bite. */
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

// Why: the doors only open for the robes of Zamorak and nothing else on. The script counts worn slots and wants 2, so the armour comes off here and goes back on after the throw. The robes drop from Iban disciples: level 13, 20 hitpoints, a dozen on the approach.

// Why: 13 disciples line the approach and `nearest()` can pick one through the temple wall, where the attack sends and nothing happens. Take them by distance but only where a cardinal neighbour is standable, give each a short wait, and say what happened when none dies.

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
        // Why: disciples wander, so "no disciple on that tile" is satisfied by one walking away. The server index is the identity that dies.
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

// Why: the rope, spade, bucket, bow, arrows and the book from Kardia's chest are all used up by now. The pack reaches the temple with 4 or 5 free slots and the strip needs 6, so the spent kit goes on the floor; the cooked food is dropped next when the pack is still too full for the robe pieces.
const SPENT: readonly UpassItem[] = [
    UP_ITEM.ROPE, UP_ITEM.SPADE, UP_ITEM.BUCKET, UP_ITEM.SHORTBOW, UP_ITEM.BRONZE_ARROW, UP_ITEM.HISTORY
];

/** The meals, worst first; lobsters are kept for their healing. */
const SHED_FOOD = ['bread', 'stew', 'meat pie', 'meat pizza'];

async function dropOne(matcher: (id: number, name: string | null) => boolean, dropped: string[]): Promise<boolean> {
    const item = Inventory.items().find(i => matcher(i.id, i.name));
    const op = item?.actions().find(o => /drop/i.test(o));
    if (!item || !op || !(await item.interact(op))) {
        return false;
    }
    await Execution.delayTicks(1);
    dropped.push(item.name ?? String(item.id));
    return true;
}

async function shedSpentKit(need: number, log: (m: string) => void): Promise<void> {
    const dropped: string[] = [];
    for (const spent of SPENT) {
        if (Inventory.free() >= need) {
            break;
        }
        await dropOne((id) => id === spent.id || (spent.id === UP_ITEM.SHORTBOW.id && BOW_IDS.has(id)), dropped);
    }
    for (const name of SHED_FOOD) {
        while (Inventory.free() < need && await dropOne((_id, itemName) => itemName !== null && itemName.toLowerCase() === name, dropped)) {
            // keep dropping this kind until the slots are there
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

// Why: opening a door swaps the loc to its open variant and you stay put, so the walk inside is a second step and standing on the temple floor is the only proof.

/** Iban's temple doors, and the walk through them. */
export async function openIbanDoor(log: (m: string) => void): Promise<boolean> {
    if (!insideIbanTemple(Game.tile())) {
        const robed = (): boolean => {
            const on = Equipment.items();
            return on.length === 2 && on.every(i => i.id === UP_ITEM.ZAM_TOP.id || i.id === UP_ITEM.ZAM_BOTTOM.id);
        };
        if (!robed()) {
            // Why: the robe pieces are ground items and need two free slots before the kill, not after; a pack full of meals otherwise spins at "no pair of robes".
            await shedSpentKit(2, log);
            if (!(await robeFromDisciple(log) && await wearOnlyRobes(log))) {
                return false;
            }
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
            // Why: the script force-moves you a tile west as it opens, so the door is the entry. There's no walk after: the pack has no walkable floor in the temple at all, altar and Iban's tile included.
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
    // Why: no walk first. The temple floor isn't in the collision pack, so any radius approach reports unreachable from where you stand; a use-on-loc leaves the pathing to the server, which can see the floor.
    const altar = locById(UP_LOC.IBAN_ALTAR, null, 16);
    const doll = Inventory.items().find(item => item.id === UP_ITEM.DOLL.id);
    if (!altar || !doll) {
        log(`missing ${altar ? 'the doll of Iban' : 'the well of the damned'}`);
        return false;
    }
    const mark = GameMessages.mark();
    await Sustain.run();
    if (!(await doll.useOn(altar))) {
        log('the doll would not go on the well');
        return false;
    }
    // Why: Iban keeps attacking through the throw, and at 1 Prayer the 30-second driveUntil would stand there and die with a full pack; eat while polling.
    const deadline = performance.now() + 30_000;
    while (performance.now() < deadline) {
        await Sustain.run();
        if (heldId(UP_ITEM.DOLL.id) === 0) {
            return true;
        }
        await Execution.delayTicks(2);
    }
    const said = GameMessages.since(mark).map(m => m.text).filter(t => !t.startsWith('get ')).slice(-3).join(' / ');
    log(`the well kept the doll — said: ${said || 'nothing'}`);
    return false;
}
