import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import type { Loc } from '../../../../model/Loc.js';
import { Traversal } from '../../../../walking/Traversal.js';
import Tile from '../../../../../geometry/Tile.js';
import { driveUntil, settleScene } from '../../exec/prompts.js';
import { UP_ITEM, UP_LOC, UP_TILE, pastGridTile, upassArea } from '../upass/areas.js';
import { enterMainCavern } from '../upass/area2.js';
import {
    armFireArrow,
    crossToWest,
    enterCave,
    getDampCloth,
    makeFireArrow,
    shootGuiderope
} from '../upass/bridge.js';
import { crossGrid } from '../upass/grid.js';
import { OUT_OF_CAGES, outstandingCrossing, takeNextCrossing } from '../upass/railings.js';
import { travelTo } from '../upass/pass.js';
import { RG_LOC, RG_TILE, regicideArea } from './areas.js';
import { climbOutOfPit, travelTirannwn } from './pockets.js';

// Why: this leg is the Underground Pass walked a second time, with the quest already finished. Both of its hard gates are `%ibanmulti` bits that stay set — `cave_well` wants the four orb bits and `bloodwell_upass` the three badges and the horn — so what is left is the physical crossings, which is what upass's own pocket-crossing mover was built for. Nothing here re-solves the quest; it re-walks it.
// Why: and the way out at the far end is Iban's own temple door. `open_iban_door` grows a branch at `%regicide_quest >= ^regicide_spoken_lathas` that teleports the player `loc + (-129, +64)` — the Well of Voyage room — instead of into the temple.

// Why: the way up out of the second cavern is the unicorn tunnel, not the cage. `upass_area_2_3_entrance` picks its landing by the door's own angle: the pair at z 9611 is angle 3 and `p_telejump`s to (2371,9666) in the first cavern, while the pair at z 9665 is angle 1 and goes the other way to the loose railings. Aiming at the cage instead arrives and then has nothing to do — `travelTo` reports "leg to (2375,9604) from (2375,9604)" and the step succeeds without moving until the watchdog parks it.
// Why: and asking `travelTo` for a tile on the shelf does not work either, because `upass/route.ts` names neither pocket — `areaAt` answers null across the first cavern, so `crossOnce` returns "nowhere" and the free search walks the ledge column instead. The door is taken by hand, by its own tile.
const UNICORN_TUNNEL_STAND = new Tile(2376, 9610, 0);
const UNICORN_TUNNEL_DOORS: readonly Tile[] = [new Tile(2375, 9611, 0), new Tile(2376, 9611, 0)];

// Why: the shelf and the orb corridor are disjoint pockets whose bounding boxes overlap — flooding the pack from the blood well gives 825 tiles over x 2369-2428, z 9666-9726, and from the well 613 over x 2380-2464, z 9664-9698, sharing not one tile. So no single coordinate test covers the overlap, but the two bands the corridor cannot reach do cover every tile this leg stands on: the tunnel lands at (2371,9666), west of the corridor's own west edge.
export function onShelf(tile: { x: number; z: number } | null): boolean {
    return tile !== null && (tile.x <= 2379 || tile.z >= 9699);
}

// Why: the chasm splits area1 in two and nothing walks across it. Flooding the collision pack from the cave landing and from the bridge's west foot gives two tile sets that do not share a single tile, and this is the line between them: the east side is z 9710-9726 and never reaches west of x 2446, the west side never reaches east of x 2442 in that band. A bare x test would read the grid approach (2479,9679) as east.
const BRIDGE_EAST_Z = 9710;
const BRIDGE_EAST_X = 2446;

export function eastOfChasm(tile: { x: number; z: number } | null): boolean {
    return tile !== null && tile.z >= BRIDGE_EAST_Z && tile.x >= BRIDGE_EAST_X;
}

function heldId(id: number): number {
    return Inventory.items().filter(item => item.id === id).length;
}

// Why: the cage, the dig and the ledge come from `upass/railings.ts` rather than being walked at. `cave_well` drops this leg in the same corridor Underground Pass itself starts from, and that run already carries each crossing's stand, its loc's OWN tile and its landing. Aiming a mover at `UP_TILE.MUD_DIG` instead asked it to route to (2393,9650), which carries the loc — live it names no pocket, `crossOnce` answers "nowhere", and the free search walked the leg back up through both thieving railings for twenty-four hops while still pointed at the dig.

/**
 * The bridge over the chasm, shot down with a lit arrow.
 * Why: `upass_bridge` leaves no permanent state — the crossing is `loc_change(old_bridge_animated, 8)` and a `p_teleport`, both temporary, and the lever that lowers it again stands on the WEST bank and only sends the player east. So a finished Underground Pass buys nothing here: every westbound walk builds the fire arrow again. Koftik hands over a fresh damp cloth whenever the pack holds none, and the shot spends the arrow whether or not the ranged roll lands.
 */
async function crossBridge(log: (m: string) => void): Promise<boolean> {
    const staged = heldId(UP_ITEM.LIT_ARROW.id) + heldId(UP_ITEM.UNLIT_ARROW.id) + heldId(UP_ITEM.DAMP_CLOTH.id);
    if (staged === 0 && !(await getDampCloth(log))) {
        log('Koftik would not hand over a damp cloth at the bridge');
        return false;
    }
    if (!(await makeFireArrow(log)) || !(await armFireArrow(log))) {
        return false;
    }
    return shootGuiderope(log);
}

function locById(id: number, op: string | null, within = 12): Loc | null {
    const base = Locs.query().where(loc => loc.id === id);
    return (op === null ? base : base.action(op)).within(within).nearest();
}

async function climbWell(log: (m: string) => void): Promise<boolean> {
    if (!(await travelTo(UP_TILE.WELL, 3, log))) {
        return false;
    }
    await settleScene();
    const well = locById(UP_LOC.WELL, null, 10);
    const op = well?.actions()[0];
    if (!well || !op) {
        log('no well in the orb corridor');
        return false;
    }
    if (!(await well.interact(op))) {
        return false;
    }
    // Why: the well blasts the player back out with damage unless all four orb bits are set, so the drop into the second cavern is the only honest signal that the descent happened.
    return driveUntil(() => upassArea(Game.tile()) === 'area2', [], log, 20_000);
}

/** Iban's temple door, which at this quest stage opens onto the Well of Voyage instead. */
async function openVoyageDoor(log: (m: string) => void): Promise<boolean> {
    if (!(await travelTo(RG_TILE.IBAN_DOOR, 3, log))) {
        return false;
    }
    await settleScene();
    const door = locById(UP_LOC.IBAN_DOOR_L, null, 8) ?? locById(UP_LOC.IBAN_DOOR_R, null, 8);
    const op = door?.actions()[0];
    if (!door || !op || !(await door.interact(op))) {
        log("no doors on Iban's temple");
        return false;
    }
    return driveUntil(() => (Game.tile()?.x ?? 9999) < 2100, [], log, 15_000);
}

/** Down the Well of Voyage, which lands in the temple on the far side of the world. */
async function climbVoyageWell(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(RG_TILE.WELL_OF_VOYAGE, { radius: 2, attempts: 2, timeoutMs: 60_000, log }))) {
        // Why: the well sits in a sealed room whose own door the pack blocks — the temple-door hop lands the player on its threshold, so a walk that finds no route means the door is still shut.
        const inner = Locs.query().name('Door').action('Open').within(8).nearest();
        if (!inner || !(await inner.interact('Open'))) {
            log('no way into the Well of Voyage room');
            return false;
        }
        await settleScene();
        if (!(await Traversal.walkResilient(RG_TILE.WELL_OF_VOYAGE, { radius: 2, attempts: 2, timeoutMs: 60_000, log }))) {
            return false;
        }
    }
    await settleScene();
    const well = locById(RG_LOC.WELL_OF_VOYAGE, 'Climb-down', 10);
    if (!well || !(await well.interact('Climb-down'))) {
        log('no Well of Voyage to climb into');
        return false;
    }
    return driveUntil(() => regicideArea(Game.tile()) === 'voyage', [], log, 20_000);
}

/** Out of the voyage temple onto the Isafdar forest floor. */
async function leaveVoyageTemple(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(RG_TILE.VOYAGE_EXIT, { radius: 3, attempts: 3, timeoutMs: 90_000, log }))) {
        return false;
    }
    await settleScene();
    const exit = locById(RG_LOC.TEMPLE_EXIT, 'Exit', 12);
    if (!exit || !(await exit.interact('Exit'))) {
        log('no cave exit in the voyage temple');
        return false;
    }
    return driveUntil(() => regicideArea(Game.tile()) === 'tirannwn', [], log, 20_000);
}

/**
 * Up the unicorn tunnel from the second cavern onto the paladins' shelf.
 * Why: by the door's own tile rather than `nearest()`. Four of these doors stand in the cavern and only the pair at z 9611 lands on the shelf — the others send the leg back to the loose railings, which is the way it came.
 */
async function climbUnicornTunnel(log: (m: string) => void): Promise<boolean> {
    if (!(await travelTo(UNICORN_TUNNEL_STAND, 1, log))) {
        log(`could not stand at (${UNICORN_TUNNEL_STAND.x},${UNICORN_TUNNEL_STAND.z}) for the unicorn tunnel`);
        return false;
    }
    await settleScene();
    const door = Locs.query()
        .where(loc => (loc.id === UP_LOC.UNICORN_DOOR_L || loc.id === UP_LOC.UNICORN_DOOR_R)
            && UNICORN_TUNNEL_DOORS.some(at => at.x === loc.tile().x && at.z === loc.tile().z))
        .nearest();
    const op = door?.actions()[0];
    if (!door || !op) {
        log(`no unicorn tunnel door at z 9611 from (${Game.tile()?.x},${Game.tile()?.z})`);
        return false;
    }
    if (!(await door.interact(op))) {
        return false;
    }
    const climbed = await driveUntil(() => onShelf(Game.tile()) && upassArea(Game.tile()) === 'area1', [], log, 15_000);
    log(climbed
        ? `unicorn tunnel → the shelf at (${Game.tile()?.x},${Game.tile()?.z})`
        : `the unicorn tunnel left us at (${Game.tile()?.x},${Game.tile()?.z}), not on the shelf`);
    return climbed;
}

/**
 * One leg of the walk from the mainland to Isafdar. Called until `regicideArea` reads `tirannwn`.
 * Why: every leg is keyed on where the player already is rather than on a remembered step, because the pass teleports on failure — a pitfall, the well, Iban's door — and a remembered step would resume in the wrong pocket after any of them.
 */
export async function enterTirannwn(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    const area = regicideArea(here);
    if (area === 'tirannwn') {
        return true;
    }
    if (area === 'pit') {
        return climbOutOfPit(log);
    }
    if (area === 'voyage') {
        return leaveVoyageTemple(log);
    }
    switch (upassArea(here)) {
        case 'mainland':
            return crossToWest(log);
        case 'westardougne':
            return enterCave(log);
        // Why: the first cavern is three places at once and only `pastGridTile` tells them apart. The bridge shelf and the orb corridor overlap on x — the shelf runs 2431-2464 and the corridor 2380-2466 — so an x test reads the shelf as the corridor, sends the leg at the temple doors on the paladins' shelf, and the walk to them has no route: forty minutes standing at (2464,9726).
        case 'area1':
            if (eastOfChasm(here)) {
                return crossBridge(log);
            }
            if (!pastGridTile(here)) {
                return crossGrid(log);
            }
            return onShelf(here) ? enterMainCavern(log) : climbWell(log);
        case 'area2':
            // Why: the paladins' shelf is entered by one loc and one only. Flooding it lists three ops on its rim — the temple doors out, the blood well, and `upass_unicorn_door`, which `p_telejump`s to (2371,9666) from its south face. So the shelf is behind the second cavern, and a leg that walked at `PALADINS` instead asked for a tile in another pocket: the mover swept for anything that gained ground, picked a slave-cage door, and "the cage slams shut behind you" left the run in an eight-tile cell with no edge out.
            return outstandingCrossing(OUT_OF_CAGES) === null
                ? climbUnicornTunnel(log)
                : takeNextCrossing(log, OUT_OF_CAGES);
        case 'gridpit':
            return travelTo(UP_TILE.GRID_APPROACH, 3, log);
        case 'voyage':
            return climbVoyageWell(log);
        case 'main':
        case 'witch':
        case 'temple':
        case 'dwarves':
        case 'kalrag':
            return openVoyageDoor(log);
        default:
            log(`lost on the way to Isafdar at (${here?.x},${here?.z},${here?.level})`);
            return false;
    }
}

// Why: the palisade is one seam of the same graph the forest is routed by — `travelTirannwn` walks the crossings out to it and takes the gate itself, and degrades to a plain resilient walk once the player is on the Ardougne side of it. Walking straight at the gate instead reports "unreachable", because from any pocket in the forest that is what it is.

/** Out of Tirannwn through the Arandar palisade — free northbound at any stage. */
export function leaveTirannwn(dest: Tile, stage: number, log: (m: string) => void): Promise<boolean> {
    return travelTirannwn(dest, 3, stage, log);
}
