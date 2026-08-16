import { Game } from '../../../../game/Game.js';
import { Locs, type Loc } from '../../../../locs/Locs.js';
import { Reach } from '../../../../walking/Reach.js';
import { Traversal } from '../../../../walking/Traversal.js';
import type Tile from '../../../../../geometry/Tile.js';
import { talkStrict } from '../../exec/primitives.js';
import { driveUntil, promptLoc, settleScene } from '../../exec/prompts.js';
import { BIO_ITEM, BIO_LOC, BIO_NPC, BIO_TILE, bioArea, type BioArea } from './areas.js';
import { wear } from './gear.js';

const OMART_CROSS = ['Ok, lets do it.'];
const KILRON_CROSS = ['Yes I do.'];

export function area(): BioArea {
    return bioArea(Game.tile());
}

export function locById(ids: readonly number[] | number, op: string | null, within = 10): Loc | null {
    const wanted = new Set(typeof ids === 'number' ? [ids] : ids);
    const base = Locs.query().where(loc => wanted.has(loc.id));
    return (op === null ? base : base.action(op)).within(within).nearest();
}

export async function walkTo(to: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && here.level === to.level && to.distanceTo(here) <= radius) {
        return true;
    }
    return Traversal.walkResilient(to, { radius, attempts: 3, timeoutMs: 180_000, log });
}

// Why: both wall crossings hand the player an `if_close`/`mes`/`p_delay` chain and only then
// `p_teleport`, so polling the tile times out while the script waits on a click nobody made.
async function arrive(
    want: (a: BioArea) => boolean,
    prefer: string[],
    log: (m: string) => void,
    ms = 25_000
): Promise<boolean> {
    const landed = await driveUntil(() => want(area()), prefer, log, ms);
    if (landed) {
        await settleScene();
    }
    return landed;
}

export async function talkAt(
    npc: string,
    near: Tile,
    prefer: string[],
    log: (m: string) => void,
    radius = 2
): Promise<boolean> {
    if (!(await walkTo(near, radius, log))) {
        return false;
    }
    await settleScene();
    if ((await Reach.npcDialog({ name: npc, near, log })) !== 'done') {
        log(`no dialogue with ${npc} near (${near.x},${near.z})`);
        return false;
    }
    return talkStrict(npc, prefer, log);
}

// Why: Omart's answer is five `if_close`/`mes`/`p_delay` beats before the choice that crosses, and every one leaves the chat modal shut — which `talkStrict` reads as the end of the conversation and returns on, so the choice belongs to the arrival poll rather than to the talk.
/** Omart's rope ladder. Only offered between released_pigeons and found_distillator. */
async function climbWithOmart(log: (m: string) => void): Promise<boolean> {
    await talkAt(BIO_NPC.OMART, BIO_TILE.OMART, OMART_CROSS, log);
    return arrive(a => a === 'west' || a === 'hq', OMART_CROSS, log);
}

/** Kilron's end of the same ladder; he offers it from climbed_ladder onward, forever. */
async function climbWithKilron(log: (m: string) => void): Promise<boolean> {
    await talkAt(BIO_NPC.KILRON, BIO_TILE.KILRON, KILRON_CROSS, log);
    return arrive(a => a === 'mainland', KILRON_CROSS, log);
}

// Why: the headquarters door answers Open with "In you go doc." and only opens once that box is clicked through, which is the frame the walker's own door crossing gives up on — and both its faces stand in a corridor the mourners wander, where one on the stand tile makes the client's path search fail every click, so `Reach.locOp` owns the approach and operates the door from either side of its edge.
async function crossHqDoor(near: Tile, want: (a: BioArea) => boolean, log: (m: string) => void): Promise<boolean> {
    return promptLoc({
        name: 'Door',
        id: BIO_LOC.HQ_DOOR,
        op: 'Open',
        near,
        within: 8,
        expect: () => want(area()),
        expectMs: 25_000
    }, log);
}

export async function enterHq(log: (m: string) => void): Promise<boolean> {
    if (area() === 'hq' || area() === 'hqUpstairs') {
        return true;
    }
    if (!(await wear(BIO_ITEM.DOCTOR_GOWN, log))) {
        log("the Doctors' gown has to be worn before the mourners open their door");
        return false;
    }
    const landed = await crossHqDoor(BIO_TILE.HQ_DOOR, a => a === 'hq' || a === 'hqUpstairs', log);
    if (landed) {
        await settleScene();
    }
    return landed;
}

/** The same door from the inside, where the script opens it for anyone. */
async function leaveHq(log: (m: string) => void): Promise<boolean> {
    if (area() === 'hqUpstairs' && !(await walkTo(BIO_TILE.HQ_INSIDE, 4, log))) {
        return false;
    }
    if (area() !== 'hq') {
        return area() === 'west' || area() === 'mainland';
    }
    const out = await crossHqDoor(BIO_TILE.HQ_INSIDE, a => a === 'west' || a === 'mainland', log);
    if (out) {
        await settleScene();
    }
    return out;
}

/** West Ardougne, or the headquarters when that is where the caller was heading. */
export async function goWest(log: (m: string) => void): Promise<boolean> {
    switch (area()) {
        case 'west':
        case 'hq':
        case 'hqUpstairs':
            return true;
        case 'mainland':
            return climbWithOmart(log);
        case 'castleUpstairs':
            return (await walkTo(BIO_TILE.ELENA, 6, log)) && climbWithOmart(log);
        case 'sewer':
            return (await walkTo(BIO_TILE.ARDOUGNE_BANK, 4, log)) && climbWithOmart(log);
        default:
            return false;
    }
}

// Why: Kilron crosses from climbed_ladder onward and costs one dialogue, but the manhole and mud
// pile are baked edges with no requirement eastbound, so a refused Kilron is not a dead end.
export async function goMainland(log: (m: string) => void): Promise<boolean> {
    switch (area()) {
        case 'mainland':
            return true;
        case 'hq':
        case 'hqUpstairs':
            return (await leaveHq(log)) && goMainland(log);
        case 'west':
            if (await climbWithKilron(log)) {
                return true;
            }
            log('Kilron would not cross — walking out through the manhole instead');
            return walkTo(BIO_TILE.ARDOUGNE_BANK, 4, log);
        case 'sewer':
        case 'castleUpstairs':
            return walkTo(BIO_TILE.ARDOUGNE_BANK, 4, log);
        default:
            return false;
    }
}
