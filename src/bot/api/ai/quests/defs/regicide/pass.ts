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

// Why: Permanent `%ibanmulti` bits retain the quest gates, leaving only physical crossings for the pocket mover.
// Why: the way out at the far end is Iban's temple door: `open_iban_door` grows a branch at `%regicide_quest >= ^regicide_spoken_lathas` that teleports you `loc + (-129, +64)`, into the Well of Voyage room.

// Why: Door angle controls the tunnel landing; the z=9611 pair reaches the first cavern and the z=9665 pair reaches the loose railings.
// Why: The first-cavern shelf has no named pocket, so cross its door directly instead of calling `travelTo`.
const UNICORN_TUNNEL_STAND = new Tile(2376, 9610, 0);
const UNICORN_TUNNEL_DOORS: readonly Tile[] = [new Tile(2375, 9611, 0), new Tile(2376, 9611, 0)];

// Why: The shelf and orb corridor have overlapping bounds but no connected tiles, so classify the shelf first and use the remaining bands for the corridor.
export function onShelf(tile: { x: number; z: number } | null): boolean {
    return tile !== null && (tile.x <= 2379 || tile.z >= 9699);
}

// Why: The chasm splits disconnected tile sets only within z=9710..9726; an x-only test misclassifies the grid approach.
const BRIDGE_EAST_Z = 9710;
const BRIDGE_EAST_X = 2446;

export function eastOfChasm(tile: { x: number; z: number } | null): boolean {
    return tile !== null && tile.z >= BRIDGE_EAST_Z && tile.x >= BRIDGE_EAST_X;
}

function heldId(id: number): number {
    return Inventory.items().filter(item => item.id === id).length;
}

// Why: Reuse the explicit railing chain; targeting the mud loc has no pocket and sends the free search back north.

/**
 * Shoot down and cross the chasm bridge.
 * Why: Its state is temporary and the west-bank lever only crosses east, so every westbound trip needs a new fire arrow.
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
    // Why: the well blasts you back out with damage unless all 4 orb bits are set, so the drop into the second cavern is the only signal the descent happened.
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
        // Why: the well sits in a sealed room whose door the pack blocks and the temple-door hop lands you on its threshold, so a walk that finds no route means the door is still shut.
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
 * Why: by the door's own tile: 4 of these doors stand in the cavern and only the pair at z 9611 lands on the shelf, the others send the leg back to the loose railings it came from.
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
 * Why: every leg is keyed on where you already are, because the pass teleports on failure (a pitfall, the well, Iban's door) and a remembered step would resume in the wrong pocket after any of them.
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
        // Why: the first cavern is 3 places at once and only `pastGridTile` tells them apart: the shelf runs x 2431-2464 and the corridor 2380-2466, so an x test reads the shelf as the corridor and sends the leg at temple doors it has no route to.
        case 'area1':
            if (eastOfChasm(here)) {
                return crossBridge(log);
            }
            if (!pastGridTile(here)) {
                return crossGrid(log);
            }
            return onShelf(here) ? enterMainCavern(log) : climbWell(log);
        case 'area2':
            // Why: the paladins' shelf is entered by one loc. Its rim carries 3 ops: the temple doors out, the blood well, and `upass_unicorn_door`, which `p_telejump`s to (2371,9666) from its south face. So the shelf is behind the second cavern, and a leg walked at `PALADINS` asks for a tile in another pocket, where the sweep picks a slave-cage door and "the cage slams shut behind you" leaves it in an 8-tile cell.
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

// Why: the palisade is one seam of the graph the forest is routed by, so `travelTirannwn` walks the crossings out to it, takes the gate, and degrades to a plain resilient walk on the Ardougne side. Walking straight at the gate reports "unreachable" from any pocket in the forest.

/** Out of Tirannwn through the Arandar palisade, free northbound at any stage. */
export function leaveTirannwn(dest: Tile, stage: number, log: (m: string) => void): Promise<boolean> {
    return travelTirannwn(dest, 3, stage, log);
}
