import { EventSignal } from '../../../../execution/EventSignal.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Npcs, type Npc } from '../../../../npcs/Npcs.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { combineById, talkUntil } from '../../exec/legs.js';
import { crossTeleportDoor } from '../../exec/prompts.js';
import { fight } from '../trollstronghold/combat.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import {
    GERRANT, HERO_ID, HERO_LOC, HERO_NAMED, HERO_NPC, HERO_SHOP, HERO_TILE, VELRAK,
    inDeepDungeon, inVelrakCell
} from './areas.js';
import { anywhere, bankedId, foodName, heldFood, heldId, liveItem } from './state.js';

const BAIT_TARGET = 60;
/** Chaos druids are level 13, but twenty-five of them add up with no food in the pack. */
const DRUID_FOOD = 8;
const DRUID_MS = 600_000;
const FISH_MS = 300_000;
const RANGE_MS = 30_000;
const JAILER_TICKS = 300;

function withdraw(name: string, qty: number, id: number): QuestStep {
    return { kind: 'withdraw', items: [{ name, qty, id }] };
}

/** Every unidentified herb is called Herb, so the pack is read by id and the Identify is clicked on it. */
export async function identifyHarralander(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(HERO_ID.HARRALANDER) > 0) {
        return true;
    }
    const herb = liveItem(HERO_ID.UNID_HARRALANDER);
    if (!herb) {
        log('no unidentified harralander in the pack');
        return false;
    }
    if (!(await herb.interact('Identify'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.countById(HERO_ID.HARRALANDER) > 0, 6_000);
}

function druid(): Npc | null {
    return Npcs.query().where(n => n.id === HERO_NPC.CHAOS_DRUID).nearest();
}

// Why: nothing sells harralander and it has no ground spawn, so the only source is the chaos druid herb
// table — 46 in 128 for a herb, and 14 in 128 of that table for this one.

/** Kill chaos druids in the Taverley dungeon until one drops an unidentified harralander. */
export async function farmHarralander(log: (m: string) => void): Promise<boolean> {
    const done = (): boolean => Inventory.countById(HERO_ID.UNID_HARRALANDER) > 0
        || Inventory.countById(HERO_ID.HARRALANDER) > 0;
    if (done()) {
        return true;
    }
    if (!(await Traversal.walkResilient(HERO_TILE.CHAOS_DRUIDS, { radius: 4, attempts: 3, timeoutMs: 300_000, log }))) {
        return false;
    }
    const deadline = performance.now() + DRUID_MS;
    let kills = 0;
    let attacking = -1;
    while (performance.now() < deadline && !done()) {
        if (EventSignal.pending()) {
            log('herb farm: yielding to a random event');
            return false;
        }
        // Why: the herb is the work — every other drop is left where it falls.
        const herb = GroundItems.query().where(g => g.id === HERO_ID.UNID_HARRALANDER).within(8).nearest();
        if (herb) {
            if (await herb.interact('Take')) {
                await Execution.delayUntil(done, 6_000);
            }
            continue;
        }
        await Sustain.run();
        const target = druid();
        if (!target) {
            await Execution.delayTicks(2);
            continue;
        }
        if (target.index === attacking && Game.inCombat()) {
            await Execution.delayTicks(1);
            continue;
        }
        if (await target.interact('Attack')) {
            attacking = target.index;
            kills++;
        }
        await Execution.delayTicks(1);
    }
    if (!done()) {
        log(`no harralander after ${Math.round(DRUID_MS / 60_000)} minutes of chaos druids (${kills} engagements)`);
        return false;
    }
    log(`harralander dropped after ${kills} chaos druid engagements`);
    return true;
}

// Why: `jail_doors.rs2` answers Open with "This <name> is locked" outside and opens only for an oplocu
// with the right key — jail key for Velrak's cell, dusty key for the deep dungeon, neither consumed.

/** Kill the Jailer and take the jail key he drops. */
export async function killJailer(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(HERO_ID.JAIL_KEY) > 0) {
        return true;
    }
    if (!(await Traversal.walkResilient(HERO_TILE.JAILER, { radius: 3, attempts: 3, timeoutMs: 300_000, log }))) {
        return false;
    }
    const key = (): { interact(op: string): boolean | Promise<boolean> } | null =>
        GroundItems.query().where(g => g.id === HERO_ID.JAIL_KEY).within(10).nearest();
    const jailer = (): Npc | null => Npcs.query().where(n => n.id === HERO_NPC.JAILER).nearest();
    if (!(await fight({
        what: 'Jailer',
        target: jailer,
        won: () => key() !== null,
        protect: 'melee',
        guard: JAILER_TICKS
    }, log))) {
        return false;
    }
    // Why: the jail key lasts 100 ticks on the floor where every other drop lasts 200.
    const drop = key();
    if (!drop || !(await drop.interact('Take'))) {
        log('the Jailer is down but the jail key is not on the floor');
        return false;
    }
    return Execution.delayUntil(() => Inventory.countById(HERO_ID.JAIL_KEY) > 0, 8_000);
}

function crossJailDoor(entering: boolean, log: (m: string) => void): Promise<boolean> {
    return crossTeleportDoor({
        id: HERO_LOC.JAIL_DOOR,
        stand: entering ? HERO_TILE.JAIL_DOOR : HERO_TILE.JAIL_DOOR_INNER,
        isFar: () => entering === inVelrakCell(Game.tile()),
        useItem: entering ? HERO_ID.JAIL_KEY : undefined,
        standRadius: 0,
        log
    });
}

/** Unlock the cell, take Velrak's key, and come back out. */
export async function freeVelrak(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(HERO_ID.DUSTY_KEY) > 0) {
        return crossJailDoor(false, log);
    }
    if (!(await crossJailDoor(true, log))) {
        return false;
    }
    if (!(await talkUntil(VELRAK, VELRAK.prefer, () => Inventory.countById(HERO_ID.DUSTY_KEY) > 0, log, 60_000))) {
        return false;
    }
    return crossJailDoor(false, log);
}

function crossDeepGate(entering: boolean, log: (m: string) => void): Promise<boolean> {
    return crossTeleportDoor({
        id: HERO_LOC.DEEP_GATE,
        name: 'Gate',
        stand: entering ? HERO_TILE.DEEP_GATE : HERO_TILE.DEEP_GATE_INNER,
        isFar: () => entering === inDeepDungeon(Game.tile()),
        useItem: entering ? HERO_ID.DUSTY_KEY : undefined,
        standRadius: 0,
        log
    });
}

/** Leave the deep dungeon, which opens from the inside without the key. */
export function leaveDeepDungeon(log: (m: string) => void): Promise<boolean> {
    return crossDeepGate(false, log);
}

// Why: the deep dungeon is a sealed pocket the navigator has no edge into, so a leg that ends inside it
// strands every later bank, shop and range walk. This one enters, fishes and leaves in a single step.

/** The lava spots burn every other rod, net and harpoon, and refuse without bait. */
export async function fishLavaEel(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(HERO_ID.RAW_LAVA_EEL) > 0) {
        return leaveDeepDungeon(log);
    }
    if (!(await crossDeepGate(true, log))) {
        return false;
    }
    const caught = await fishInside(log);
    const left = await leaveDeepDungeon(log);
    return caught && left;
}

async function fishInside(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(HERO_TILE.LAVA_FISH, { radius: 2, attempts: 3, timeoutMs: 300_000, log }))) {
        return false;
    }
    const deadline = performance.now() + FISH_MS;
    while (performance.now() < deadline && Inventory.countById(HERO_ID.RAW_LAVA_EEL) === 0) {
        if (EventSignal.pending()) {
            log('lava eel: yielding to a random event');
            return false;
        }
        if (Inventory.countById(HERO_ID.FISHING_BAIT) === 0) {
            log('out of fishing bait at the lava spot');
            return false;
        }
        const spot = Npcs.query().where(n => n.id === HERO_NPC.LAVA_FISH).within(6).nearest();
        if (!spot) {
            log('no lava Fishing spot within six tiles');
            return false;
        }
        await spot.interact('Bait');
        await Execution.delayUntil(() => Inventory.countById(HERO_ID.RAW_LAVA_EEL) > 0, 20_000);
    }
    return Inventory.countById(HERO_ID.RAW_LAVA_EEL) > 0;
}

// Why: the Taverley range sits in a pocket the baked graph has no door into, so Catherby's is the
// nearest cooking surface the walker can reach from the dungeon ladder.

/** Cook the eel on the Catherby range — level 53, and it never burns. */
export async function cookLavaEel(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(HERO_ID.LAVA_EEL) > 0) {
        return true;
    }
    if (!(await Traversal.walkResilient(HERO_TILE.CATHERBY_RANGE, { radius: 1, attempts: 3, timeoutMs: 300_000, log }))) {
        return false;
    }
    const raw = liveItem(HERO_ID.RAW_LAVA_EEL);
    const range = Locs.query().name('Range').within(6).nearest();
    if (!raw || !range) {
        log('no raw lava eel in the pack, or no Range within six tiles of the Catherby stand');
        return false;
    }
    if (!(await raw.useOn(range))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.countById(HERO_ID.LAVA_EEL) > 0, RANGE_MS);
}

// Why: the slime lands between a `~mesbox` and a `~chatnpc`, and a chat-only driver stalls on that
// modal — the count in the pack is the only oracle that sees past it.

/** Gerrant hands the slime over once, and only while none of slime, oil or oiled rod exists anywhere. */
export function askGerrantForSlime(log: (m: string) => void): Promise<boolean> {
    return talkUntil(GERRANT, GERRANT.prefer, () => Inventory.countById(HERO_ID.SLIME) > 0, log, 60_000);
}

/** Jailer, jail key, Velrak, dusty key — null once the deep dungeon can be opened. */
function keyStep(snap: QuestSnapshot): QuestStep | null {
    if (heldId(snap, HERO_ID.DUSTY_KEY) > 0) {
        return null;
    }
    if (bankedId(snap, HERO_ID.DUSTY_KEY) > 0) {
        return withdraw(HERO_NAMED.DUSTY_KEY, 1, HERO_ID.DUSTY_KEY);
    }
    if (heldId(snap, HERO_ID.JAIL_KEY) === 0) {
        return bankedId(snap, HERO_ID.JAIL_KEY) > 0
            ? withdraw(HERO_NAMED.JAIL_KEY, 1, HERO_ID.JAIL_KEY)
            : { kind: 'custom', name: 'kill the Jailer for the jail key', run: killJailer };
    }
    return { kind: 'custom', name: "free Velrak for the deep dungeon's key", run: freeVelrak };
}

/**
 * Slime, rod, bait, vial, herb, oil, oiled rod, keys, eel, fire. Each branch is a function of what is
 * carried, so a restart anywhere in the chain picks it up where it stopped.
 */
export function eelStep(snap: QuestSnapshot): QuestStep | null {
    if (anywhere(snap, HERO_ID.LAVA_EEL) > 0) {
        return null;
    }
    if (heldId(snap, HERO_ID.RAW_LAVA_EEL) > 0) {
        return { kind: 'custom', name: 'cook the lava eel at Catherby', run: cookLavaEel };
    }
    if (bankedId(snap, HERO_ID.RAW_LAVA_EEL) > 0) {
        return withdraw(HERO_NAMED.RAW_LAVA_EEL, 1, HERO_ID.RAW_LAVA_EEL);
    }

    if (heldId(snap, HERO_ID.OILY_ROD) > 0) {
        if (heldId(snap, HERO_ID.FISHING_BAIT) === 0) {
            return bankedId(snap, HERO_ID.FISHING_BAIT) > 0
                ? withdraw(HERO_NAMED.FISHING_BAIT, BAIT_TARGET, HERO_ID.FISHING_BAIT)
                : { kind: 'buy', item: HERO_NAMED.FISHING_BAIT, qty: BAIT_TARGET, shop: HERO_SHOP.GERRANT, estGp: 2_000 };
        }
        return keyStep(snap) ?? { kind: 'custom', name: 'fish a lava eel in the Taverley dungeon', run: fishLavaEel };
    }
    if (bankedId(snap, HERO_ID.OILY_ROD) > 0) {
        return withdraw(HERO_NAMED.OILY_ROD, 1, HERO_ID.OILY_ROD);
    }

    if (heldId(snap, HERO_ID.BLAMISH_OIL) > 0) {
        if (heldId(snap, HERO_ID.FISHING_ROD) > 0) {
            return {
                kind: 'custom',
                name: 'rub the blamish oil into the fishing rod',
                run: log => combineById(HERO_ID.BLAMISH_OIL, HERO_ID.FISHING_ROD, HERO_ID.OILY_ROD, log)
            };
        }
        return bankedId(snap, HERO_ID.FISHING_ROD) > 0
            ? withdraw(HERO_NAMED.FISHING_ROD, 1, HERO_ID.FISHING_ROD)
            : { kind: 'buy', item: HERO_NAMED.FISHING_ROD, qty: 1, shop: HERO_SHOP.GERRANT, estGp: 200 };
    }
    if (bankedId(snap, HERO_ID.BLAMISH_OIL) > 0) {
        return withdraw(HERO_NAMED.BLAMISH_OIL, 1, HERO_ID.BLAMISH_OIL);
    }

    if (heldId(snap, HERO_ID.HARRALANDER_VIAL) > 0) {
        if (heldId(snap, HERO_ID.SLIME) > 0) {
            return {
                kind: 'custom',
                name: 'mix the slime into the harralander potion',
                run: log => combineById(HERO_ID.SLIME, HERO_ID.HARRALANDER_VIAL, HERO_ID.BLAMISH_OIL, log)
            };
        }
        return bankedId(snap, HERO_ID.SLIME) > 0
            ? withdraw(HERO_NAMED.SLIME, 1, HERO_ID.SLIME)
            : { kind: 'custom', name: 'ask Gerrant for a jar of blamish slime', run: askGerrantForSlime };
    }
    if (bankedId(snap, HERO_ID.HARRALANDER_VIAL) > 0) {
        return withdraw(HERO_NAMED.HARRALANDER_VIAL, 1, HERO_ID.HARRALANDER_VIAL);
    }

    if (heldId(snap, HERO_ID.HARRALANDER) > 0) {
        if (heldId(snap, HERO_ID.VIAL_WATER) > 0) {
            return {
                kind: 'custom',
                name: 'mix the harralander into the vial of water',
                run: log => combineById(HERO_ID.HARRALANDER, HERO_ID.VIAL_WATER, HERO_ID.HARRALANDER_VIAL, log)
            };
        }
        return bankedId(snap, HERO_ID.VIAL_WATER) > 0
            ? withdraw(HERO_NAMED.VIAL_WATER, 1, HERO_ID.VIAL_WATER)
            : { kind: 'buy', item: HERO_NAMED.VIAL_WATER, qty: 1, shop: HERO_SHOP.AEMAD, estGp: 200 };
    }
    if (bankedId(snap, HERO_ID.HARRALANDER) > 0) {
        return withdraw(HERO_NAMED.HARRALANDER, 1, HERO_ID.HARRALANDER);
    }

    if (heldId(snap, HERO_ID.UNID_HARRALANDER) > 0) {
        return { kind: 'custom', name: 'identify the harralander', run: identifyHarralander };
    }
    if (bankedId(snap, HERO_ID.UNID_HARRALANDER) > 0) {
        return withdraw(HERO_NAMED.UNID_HERB, 1, HERO_ID.UNID_HARRALANDER);
    }
    if (heldFood(snap) < DRUID_FOOD) {
        return { kind: 'withdraw', items: [{ name: foodName(), qty: DRUID_FOOD * 2 }] };
    }
    return { kind: 'custom', name: 'farm chaos druids for a harralander', run: farmHarralander };
}
