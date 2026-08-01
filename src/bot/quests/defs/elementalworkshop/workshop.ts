import { actions, reader } from '../../../adapter/ClientAdapter.js';
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import Tile from '../../../api/Tile.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { GroundItems } from '../../../api/queries/GroundItems.js';
import { Locs, type Loc } from '../../../api/queries/Locs.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { Traversal } from '../../../api/Traversal.js';
import { heldId, settleScene, useOnLoc } from '../../exec/prompts.js';
import {
    BELLOWS_STAND,
    BOOKCASE,
    CRATE_HUB,
    EW_ITEM,
    FURNACE_STAND,
    ROCK_STAND,
    SMITHY,
    STAIRS_TOP,
    TROUGH_STAND,
    WATER_STAND,
    WORKBENCH_STAND,
    WORKSHOP_ARRIVAL,
    ewArea
} from './areas.js';
import { COAL_NEED } from './supplies.js';

const EARTH_ELEMENTAL = 'Earth elemental';
const BOOK_MODAL_MS = 8_000;

function dist2(a: { x: number; z: number }, b: { x: number; z: number }): number {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return dx * dx + dz * dz;
}

async function walkNear(tile: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && tile.distanceTo(here) <= radius) {
        return true;
    }
    return Traversal.walkResilient(tile, { radius, attempts: 4, timeoutMs: 180_000, log });
}

async function closeBookModal(): Promise<void> {
    // Reading the battered book opens a book interface (main modal), not a chat box.
    const deadline = performance.now() + BOOK_MODAL_MS;
    while (performance.now() < deadline) {
        if (reader.modals().main === -1) {
            return;
        }
        actions.closeModal();
        await Execution.delayTicks(1);
    }
}

export async function searchBookcase(log: (m: string) => void): Promise<boolean> {
    if (heldId(EW_ITEM.BATTERED_BOOK.id) > 0) {
        return true;
    }
    if (!(await walkNear(BOOKCASE, 2, log))) {
        return false;
    }
    await settleScene();
    const bookcase = Locs.query().name('Bookcase').action('Search').within(6).nearest();
    if (!bookcase) {
        log('no Bookcase to Search near Seers house');
        return false;
    }
    if (!(await bookcase.interact('Search'))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(EW_ITEM.BATTERED_BOOK.id) > 0, 8_000);
}

export async function readBatteredBook(log: (m: string) => void): Promise<boolean> {
    const book = Inventory.items().find(i => i.id === EW_ITEM.BATTERED_BOOK.id);
    if (!book) {
        log('no Battered book to Read');
        return false;
    }
    log('reading the Battered book to start the quest');
    if (!(await book.interact('Read'))) {
        return false;
    }
    await Execution.delayTicks(2);
    await closeBookModal();
    return true;
}

export async function slashBookForKey(log: (m: string) => void): Promise<boolean> {
    if (heldId(EW_ITEM.BATTERED_KEY.id) > 0) {
        return true;
    }
    const book = Inventory.items().find(i => i.id === EW_ITEM.BATTERED_BOOK.id);
    const knife = Inventory.items().find(i => i.id === EW_ITEM.KNIFE.id)
        ?? Inventory.items().find(i => i.name?.toLowerCase().includes('sword') || i.name?.toLowerCase().includes('scimitar') || i.name?.toLowerCase() === 'knife');
    if (!book || !knife) {
        log('need the Battered book and a Knife (or slash weapon) to cut the spine');
        return false;
    }
    log('cutting the spine of the Battered book for the key');
    const before = heldId(EW_ITEM.BATTERED_KEY.id);
    if (!(await knife.useOn(book))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(EW_ITEM.BATTERED_KEY.id) > before, 8_000);
}

export async function enterWorkshop(log: (m: string) => void): Promise<boolean> {
    if (ewArea(Game.tile()) === 'workshop') {
        return true;
    }
    // Stand outside the smithy — do not path onto the wall loc tile (unwalkable).
    if (!(await walkNear(SMITHY, 4, log))) {
        return false;
    }
    await settleScene();

    // The "Odd looking wall" is not a normal door: oplocu with the Battered key opens it.
    // Push only works after it is already unlocked for this player.
    const wall = Locs.query().name('Odd looking wall').within(10).nearest();
    if (!wall) {
        log('no Odd looking wall near the Seers smithy');
        return false;
    }
    if (heldId(EW_ITEM.BATTERED_KEY.id) > 0) {
        const key = Inventory.items().find(i => i.id === EW_ITEM.BATTERED_KEY.id);
        if (!key) {
            log('no Battered key to use on the Odd looking wall');
            return false;
        }
        log('using the Battered key on the Odd looking wall');
        if (!(await key.useOn(wall))) {
            return false;
        }
        await Execution.delayTicks(3);
    } else {
        const pushable = Locs.query().name('Odd looking wall').action('Push').within(10).nearest();
        if (pushable) {
            log('pushing the Odd looking wall');
            await pushable.interact('Push');
            await Execution.delayTicks(2);
        } else {
            log('need the Battered key for the Odd looking wall');
            return false;
        }
    }

    // Stairs are just inside; walk if needed, then Climb-down into the workshop pocket.
    if (!(await walkNear(STAIRS_TOP, 3, log))) {
        // Still try the climb from wherever we are if the stairs are visible.
        await settleScene();
    } else {
        await settleScene();
    }
    const stairs = Locs.query().name('Staircase').action('Climb-down').within(8).nearest();
    if (!stairs) {
        log('no Staircase to Climb-down in the Seers smithy');
        return false;
    }
    log('climbing down into the Elemental Workshop');
    if (!(await stairs.interact('Climb-down'))) {
        return false;
    }
    return Execution.delayUntil(() => ewArea(Game.tile()) === 'workshop', 12_000);
}

export async function leaveWorkshop(log: (m: string) => void): Promise<boolean> {
    if (ewArea(Game.tile()) !== 'workshop') {
        return true;
    }
    if (!(await walkNear(WORKSHOP_ARRIVAL, 3, log))) {
        return false;
    }
    await settleScene();
    const stairs = Locs.query().name('Staircase').action('Climb-up').within(8).nearest();
    if (!stairs) {
        log('no Staircase to Climb-up out of the workshop');
        return false;
    }
    if (!(await stairs.interact('Climb-up'))) {
        return false;
    }
    return Execution.delayUntil(() => ewArea(Game.tile()) !== 'workshop', 12_000);
}

function waterValves(): { east: Loc | null; west: Loc | null } {
    const valves = Locs.query().name('Water Valve').action('Turn').within(20).results();
    if (valves.length === 0) {
        return { east: null, west: null };
    }
    const sorted = [...valves].sort((a, b) => b.tile().x - a.tile().x);
    return { east: sorted[0] ?? null, west: sorted[sorted.length - 1] ?? null };
}

/** East valve then west valve, then the northern water lever — never re-pull once flowing. */
export async function startWaterWheel(log: (m: string) => void): Promise<boolean> {
    if (!(await walkNear(WATER_STAND, 3, log))) {
        return false;
    }
    await settleScene();
    const { east, west } = waterValves();
    if (!east || !west) {
        log('could not find both Water Valves in the northern chamber');
        return false;
    }
    log('turning the east Water Valve');
    if (!(await east.interact('Turn'))) {
        return false;
    }
    await Execution.delayTicks(2);
    log('turning the west Water Valve');
    if (!(await west.interact('Turn'))) {
        return false;
    }
    await Execution.delayTicks(2);

    const lever = Locs.query().name('Lever').action('Pull').within(12).results()
        .sort((a, b) => dist2(a.tile(), WATER_STAND) - dist2(b.tile(), WATER_STAND))[0];
    if (!lever) {
        log('no water-chamber Lever to Pull');
        return false;
    }
    log('pulling the water-chamber Lever');
    if (!(await lever.interact('Pull'))) {
        return false;
    }
    await Execution.delayTicks(3);
    return true;
}

export async function searchCratesFor(
    want: { bowl: boolean; leather: boolean; needle: boolean },
    log: (m: string) => void
): Promise<boolean> {
    if (!(await walkNear(CRATE_HUB, 4, log))) {
        return false;
    }
    await settleScene();

    const needBowl = () => want.bowl && heldId(EW_ITEM.STONE_BOWL.id) === 0 && heldId(EW_ITEM.STONE_BOWL_FULL.id) === 0;
    const needLeather = () => want.leather && heldId(EW_ITEM.LEATHER.id) === 0;
    const needNeedle = () => want.needle && heldId(EW_ITEM.NEEDLE.id) === 0;

    if (!needBowl() && !needLeather() && !needNeedle()) {
        return true;
    }

    const crates = [
        ...Locs.query().name('Crate').action('Search').within(18).results(),
        ...Locs.query().name('Boxes').action('Search').within(18).results()
    ];
    if (crates.length === 0) {
        log('no Crates/Boxes to Search in the workshop');
        return false;
    }

    for (const crate of crates) {
        if (!needBowl() && !needLeather() && !needNeedle()) {
            return true;
        }
        const beforeBowl = heldId(EW_ITEM.STONE_BOWL.id);
        const beforeLeather = heldId(EW_ITEM.LEATHER.id);
        const beforeNeedle = heldId(EW_ITEM.NEEDLE.id);
        log(`searching ${crate.name ?? 'crate'} for workshop supplies`);
        if (!(await crate.interact('Search'))) {
            continue;
        }
        await Execution.delayUntil(
            () => heldId(EW_ITEM.STONE_BOWL.id) > beforeBowl
                || heldId(EW_ITEM.LEATHER.id) > beforeLeather
                || heldId(EW_ITEM.NEEDLE.id) > beforeNeedle,
            3_000
        );
    }

    if (needBowl() || needLeather() || needNeedle()) {
        log(`crate search incomplete (bowl=${needBowl()} leather=${needLeather()} needle=${needNeedle()})`);
        return false;
    }
    return true;
}

export async function fixBellows(log: (m: string) => void): Promise<boolean> {
    if (heldId(EW_ITEM.LEATHER.id) === 0 || heldId(EW_ITEM.NEEDLE.id) === 0 || heldId(EW_ITEM.THREAD.id) === 0) {
        log('need Leather, Needle, and Thread to Fix the Bellows');
        return false;
    }
    if (!(await walkNear(BELLOWS_STAND, 3, log))) {
        return false;
    }
    await settleScene();
    const bellows = Locs.query().name('Bellows').action('Fix').within(10).nearest();
    if (!bellows) {
        log('no Bellows to Fix');
        return false;
    }
    log('stitching leather over the hole in the Bellows');
    if (!(await bellows.interact('Fix'))) {
        return false;
    }
    await Execution.delayTicks(3);
    return heldId(EW_ITEM.LEATHER.id) === 0 || heldId(EW_ITEM.THREAD.id) === 0;
}

export async function lightFurnace(log: (m: string) => void): Promise<boolean> {
    if (heldId(EW_ITEM.STONE_BOWL_FULL.id) === 0) {
        if (heldId(EW_ITEM.STONE_BOWL.id) === 0) {
            log('need a stone bowl to scoop lava');
            return false;
        }
        if (!(await walkNear(TROUGH_STAND, 3, log))) {
            return false;
        }
        log('filling the stone bowl from the Lava trough');
        if (!(await useOnLoc(
            EW_ITEM.STONE_BOWL.id,
            { name: 'Lava trough', near: TROUGH_STAND, within: 10 },
            [],
            () => heldId(EW_ITEM.STONE_BOWL_FULL.id) > 0,
            log
        ))) {
            return false;
        }
    }

    if (!(await walkNear(FURNACE_STAND, 3, log))) {
        return false;
    }
    log('emptying lava into the Furnace');
    return useOnLoc(
        EW_ITEM.STONE_BOWL_FULL.id,
        { name: 'Furnace', near: FURNACE_STAND, within: 10 },
        [],
        () => heldId(EW_ITEM.STONE_BOWL_FULL.id) === 0,
        log
    );
}

export async function pullAirLever(log: (m: string) => void): Promise<boolean> {
    if (!(await walkNear(BELLOWS_STAND, 3, log))) {
        return false;
    }
    await settleScene();
    const lever = Locs.query().name('Lever').action('Pull').within(12).results()
        .sort((a, b) => dist2(a.tile(), BELLOWS_STAND) - dist2(b.tile(), BELLOWS_STAND))[0];
    if (!lever) {
        log('no air-chamber Lever to Pull');
        return false;
    }
    log('pulling the air-chamber Lever to pump the bellows');
    if (!(await lever.interact('Pull'))) {
        return false;
    }
    await Execution.delayTicks(3);
    return true;
}

async function waitOutCombat(ms: number): Promise<void> {
    await Execution.delayUntil(() => !Game.inCombat(), ms);
}

export async function mineElementalOre(log: (m: string) => void): Promise<boolean> {
    if (heldId(EW_ITEM.ELEMENTAL_ORE.id) > 0) {
        return true;
    }
    if (!(await walkNear(ROCK_STAND, 3, log))) {
        return false;
    }
    await settleScene();

    let elemental = Npcs.query().name(EARTH_ELEMENTAL).within(12).nearest();
    if (!elemental) {
        const rock = Locs.query().name('Pile of Rock').action('Mine').within(10).nearest();
        if (!rock) {
            log('no Pile of Rock to Mine');
            return false;
        }
        log('mining the elemental rock (Earth elemental will spawn)');
        if (!(await rock.interact('Mine'))) {
            return false;
        }
        await Execution.delayUntil(
            () => Npcs.query().name(EARTH_ELEMENTAL).within(12).nearest() !== null || heldId(EW_ITEM.ELEMENTAL_ORE.id) > 0,
            10_000
        );
        elemental = Npcs.query().name(EARTH_ELEMENTAL).within(12).nearest();
    }

    if (heldId(EW_ITEM.ELEMENTAL_ORE.id) > 0) {
        return true;
    }
    if (!elemental) {
        log('Earth elemental did not appear');
        return false;
    }

    log('killing the Earth elemental for Elemental ore');
    if (!Game.inCombat() && !(await elemental.interact('Attack'))) {
        return false;
    }
    await Execution.delayUntil(() => Game.inCombat() || !elemental!.valid(), 5_000);
    await waitOutCombat(120_000);

    const oreOnGround = async (): Promise<boolean> => {
        const ground = GroundItems.query().name(EW_ITEM.ELEMENTAL_ORE.name).within(10).nearest();
        if (!ground) {
            return heldId(EW_ITEM.ELEMENTAL_ORE.id) > 0;
        }
        if (!(await ground.interact('Take'))) {
            return false;
        }
        return Execution.delayUntil(() => heldId(EW_ITEM.ELEMENTAL_ORE.id) > 0, 8_000);
    };

    if (await Execution.delayUntil(() => GroundItems.query().name(EW_ITEM.ELEMENTAL_ORE.name).within(10).nearest() !== null, 8_000)) {
        return oreOnGround();
    }
    return heldId(EW_ITEM.ELEMENTAL_ORE.id) > 0;
}

/**
 * Air blowing is not journal-visible and the air lever toggles. Pull once, then
 * immediately smelt so a later decide pass cannot turn the bellows off.
 */
export async function smeltElementalBar(log: (m: string) => void): Promise<boolean> {
    if (heldId(EW_ITEM.ELEMENTAL_METAL.id) > 0) {
        return true;
    }
    if (heldId(EW_ITEM.ELEMENTAL_ORE.id) === 0) {
        log('no Elemental ore to smelt');
        return false;
    }
    if (Inventory.countById(EW_ITEM.COAL.id) < COAL_NEED && Inventory.count(EW_ITEM.COAL.name) < COAL_NEED) {
        log(`need ${COAL_NEED} Coal to smelt Elemental ore`);
        return false;
    }

    if (!(await pullAirLever(log))) {
        return false;
    }

    if (!(await walkNear(FURNACE_STAND, 3, log))) {
        return false;
    }
    await settleScene();
    const before = heldId(EW_ITEM.ELEMENTAL_METAL.id);
    log('placing Elemental ore and Coal into the Furnace');
    if (!(await useOnLoc(
        EW_ITEM.ELEMENTAL_ORE.id,
        { name: 'Furnace', near: FURNACE_STAND, within: 10 },
        [],
        () => heldId(EW_ITEM.ELEMENTAL_METAL.id) > before,
        log
    ))) {
        // Heat may still be off if water/bellows were not ready — caller re-decides.
        return heldId(EW_ITEM.ELEMENTAL_METAL.id) > before;
    }
    return true;
}

export async function smithElementalShield(log: (m: string) => void): Promise<boolean> {
    if (heldId(EW_ITEM.ELEMENTAL_SHIELD.id) > 0) {
        return true;
    }
    if (heldId(EW_ITEM.ELEMENTAL_METAL.id) === 0) {
        log('no Elemental metal to smith');
        return false;
    }
    if (heldId(EW_ITEM.BATTERED_BOOK.id) === 0) {
        log('need the Battered book as instructions on the workbench');
        return false;
    }
    if (heldId(EW_ITEM.HAMMER.id) === 0) {
        log('need a Hammer to work the metal');
        return false;
    }

    if (!(await walkNear(WORKBENCH_STAND, 3, log))) {
        return false;
    }
    await settleScene();
    const before = heldId(EW_ITEM.ELEMENTAL_SHIELD.id);
    log('smithing an Elemental shield on the Workbench');
    return useOnLoc(
        EW_ITEM.ELEMENTAL_METAL.id,
        { name: 'Workbench', near: WORKBENCH_STAND, within: 10 },
        [],
        () => heldId(EW_ITEM.ELEMENTAL_SHIELD.id) > before,
        log
    );
}
