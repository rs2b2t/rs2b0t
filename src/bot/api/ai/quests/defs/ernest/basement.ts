import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Reach } from '../../../../walking/Reach.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import Tile from '../../../../../geometry/Tile.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Locs } from '../../../../locs/Locs.js';
import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { settleScene } from '../../exec/prompts.js';
import { EC_ID, EC_NAME, EC_TILE } from './areas.js';

type BasementRegion = 'entry' | 'r1r4' | 'r2' | 'r5' | 'r3' | 'r6' | 'r9' | 'outside';

// Why: these are the seven components the nine puzzle doors cut the basement into, from a flood over the baked collision pack with the doors closed.
// Why: the boxes are pairwise disjoint, so a tile alone names a room.
export const REGION_BOX = {
    entry: { minX: 3100, maxX: 3118, minZ: 9745, maxZ: 9757 },
    r1r4: { minX: 3105, maxX: 3112, minZ: 9758, maxZ: 9767 },
    r2: { minX: 3100, maxX: 3104, minZ: 9763, maxZ: 9767 },
    r5: { minX: 3100, maxX: 3104, minZ: 9758, maxZ: 9762 },
    r3: { minX: 3096, maxX: 3099, minZ: 9763, maxZ: 9767 },
    r6: { minX: 3096, maxX: 3099, minZ: 9758, maxZ: 9762 },
    r9: { minX: 3090, maxX: 3099, minZ: 9753, maxZ: 9757 }
} as const;

/**
 * The 36-tile pocket the bookcase teleports into, holding the puzzle ladder.
 * Its only exit is the lever, which teleports back through the same wall.
 */
const ALCOVE_BOX = { minX: 3091, maxX: 3096, minZ: 3354, maxZ: 3363 };

/** Pure, so `decide()` can branch on the snapshot tile without a client. */
export function inAlcove(tile: { x: number; z: number; level: number } | null | undefined): boolean {
    return Boolean(tile) && tile!.level === 0
        && tile!.x >= ALCOVE_BOX.minX && tile!.x <= ALCOVE_BOX.maxX
        && tile!.z >= ALCOVE_BOX.minZ && tile!.z <= ALCOVE_BOX.maxZ;
}

export function basementRegion(tile: { x: number; z: number; level: number } | null | undefined): BasementRegion {
    if (!tile || tile.level !== 0) {
        return 'outside';
    }
    for (const [name, box] of Object.entries(REGION_BOX)) {
        if (tile.x >= box.minX && tile.x <= box.maxX && tile.z >= box.minZ && tile.z <= box.maxZ) {
            return name as BasementRegion;
        }
    }
    return 'outside';
}

const A = 1 << 0, B = 1 << 1, C = 1 << 2, D = 1 << 3, E = 1 << 4, F = 1 << 5;

/** A set bit means the lever is DOWN. Transcribed from [oploc1,_haunted_door]. */
export const DOOR_OPEN: Record<string, (bits: number) => boolean> = {
    '1to2': b => !(b & A) && !(b & B) && !!(b & D) && !!(b & E) && !!(b & F),
    '2to3': b => !(b & B) && !!(b & D) && !!(b & F),
    '4to5': b => !!(b & A) && !!(b & B) && !!(b & D),
    '5to6': b => !!(b & D),
    '8to9': b => !(b & E) && !!(b & F),
    '2to5': b => !(b & A) && !(b & B) && !!(b & C) && !!(b & D) && !(b & E) && !!(b & F),
    '3to6': b => !(b & B) && !!(b & D) && !(b & F),
    '4to7': b => !!(b & A) && !!(b & B) && !(b & C) && !(b & D) && !(b & E) && !(b & F),
    '5to8': b => (!(b & C) && !!(b & D)) || (!(b & A) && !(b & B) && !!(b & C) && !!(b & D) && !(b & E) && !!(b & F))
};

type LeverName = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

/** Wall decorations; the player operates them from their own tile. */
const LEVER_TILE: Record<LeverName, Tile> = {
    A: new Tile(3108, 9745, 0),
    B: new Tile(3118, 9752, 0),
    C: new Tile(3112, 9760, 0),
    D: new Tile(3108, 9767, 0),
    E: new Tile(3097, 9767, 0),
    F: new Tile(3096, 9765, 0)
};

/** The door's own tile, and the tile on the far side of its edge. */
const DOOR_SIDE: Record<string, { near: Tile; far: Tile }> = {
    '1to2': { near: new Tile(3105, 9765, 0), far: new Tile(3104, 9765, 0) },
    '2to3': { near: new Tile(3100, 9765, 0), far: new Tile(3099, 9765, 0) },
    '4to5': { near: new Tile(3105, 9760, 0), far: new Tile(3104, 9760, 0) },
    '5to6': { near: new Tile(3100, 9760, 0), far: new Tile(3099, 9760, 0) },
    '8to9': { near: new Tile(3100, 9755, 0), far: new Tile(3099, 9755, 0) },
    '2to5': { near: new Tile(3102, 9763, 0), far: new Tile(3102, 9762, 0) },
    '3to6': { near: new Tile(3097, 9763, 0), far: new Tile(3097, 9762, 0) },
    '4to7': { near: new Tile(3108, 9758, 0), far: new Tile(3108, 9757, 0) },
    '5to8': { near: new Tile(3102, 9758, 0), far: new Tile(3102, 9757, 0) }
};

type ChainMove =
    | { kind: 'pull'; lever: LeverName; to: 'up' | 'down' }
    | { kind: 'door'; door: string; stand: Tile; arrive: Tile };

const pull = (lever: LeverName, to: 'up' | 'down'): ChainMove => ({ kind: 'pull', lever, to });
const cross = (door: string, from: 'near' | 'far'): ChainMove => ({
    kind: 'door',
    door,
    stand: from === 'near' ? DOOR_SIDE[door]!.near : DOOR_SIDE[door]!.far,
    arrive: from === 'near' ? DOOR_SIDE[door]!.far : DOOR_SIDE[door]!.near
});

/** tools/nav/ernest-basement-derive.ts. Levers are all up on every descent. */
export const CHAIN: readonly ChainMove[] = [
    pull('B', 'down'), pull('A', 'down'), cross('4to7', 'far'),
    pull('D', 'down'), cross('4to5', 'near'), cross('5to8', 'near'),
    pull('B', 'up'), pull('A', 'up'), cross('5to8', 'far'),
    cross('5to6', 'near'), cross('3to6', 'far'),
    pull('F', 'down'), pull('E', 'down'),
    cross('2to3', 'far'), cross('1to2', 'far'),
    pull('C', 'down'),
    cross('1to2', 'near'), cross('2to3', 'near'),
    pull('E', 'up'),
    cross('2to3', 'far'), cross('2to5', 'near'), cross('5to8', 'near'), cross('8to9', 'near')
];

const PULLED = /^you pull lever [a-f] (up|down)\.?$/i;
const PULLED_UP = /^you pull lever [a-f] up\.?$/i;
const DOOR_LOCKED = /this door is locked/i;

const held = (id: number): number => Inventory.countById(id);
const here = (): { x: number; z: number; level: number } | null => Game.tile();

// Why: these levers never change model, so the chat line is the only oracle.
// Why: [oploc1] reads the bit before toggling, so the line names the resulting state.

/** Pull a lever until the server confirms the wanted state. */
async function setLever(lever: LeverName, want: 'up' | 'down', log: (m: string) => void): Promise<boolean> {
    const stand = LEVER_TILE[lever];
    for (let attempt = 0; attempt < 4; attempt++) {
        await Sustain.run();
        if (!(await Traversal.walkResilient(stand, { radius: 1, attempts: 4, timeoutMs: 90_000, log }))) {
            log(`could not reach lever ${lever} at (${stand.x},${stand.z})`);
            return false;
        }
        await settleScene();
        const loc = Locs.query().name(`Lever ${lever}`).action('Pull').within(3).nearest();
        if (!loc) {
            log(`no 'Lever ${lever}' in the scene at (${stand.x},${stand.z})`);
            return false;
        }
        const mark = GameMessages.mark();
        if (!(await loc.interact('Pull'))) {
            continue;
        }
        if (!(await Execution.delayUntil(() => GameMessages.sawSince(mark, PULLED), 6000))) {
            continue;
        }
        const now = GameMessages.sawSince(mark, PULLED_UP) ? 'up' : 'down';
        log(`lever ${lever} is now ${now}`);
        if (now === want) {
            return true;
        }
    }
    log(`could not force lever ${lever} ${want}`);
    return false;
}

/**
 * Cross one puzzle door. `open_and_close_door2` teleports the player through and
 * shuts it behind them, so the tell is the region change, never the door state.
 */
async function crossDoor(
    move: Extract<ChainMove, { kind: 'door' }>,
    log: (m: string) => void
): Promise<'crossed' | 'locked' | 'failed'> {
    const want = basementRegion(move.arrive);
    if (basementRegion(here()) === want) {
        return 'crossed';
    }
    if (!(await Traversal.walkResilient(move.stand, { radius: 0, attempts: 4, timeoutMs: 90_000, log }))) {
        log(`could not reach the ${move.door} stand (${move.stand.x},${move.stand.z})`);
        return 'failed';
    }
    await settleScene();
    const door = Locs.query().name('Door').action('Open').within(3).nearest();
    if (!door) {
        log(`no ${move.door} in the scene`);
        return 'failed';
    }
    const mark = GameMessages.mark();
    if (!(await door.interact('Open'))) {
        return 'failed';
    }
    await Execution.delayUntil(
        () => basementRegion(here()) === want || GameMessages.sawSince(mark, DOOR_LOCKED),
        6000
    );
    if (basementRegion(here()) === want) {
        log(`crossed ${move.door} into ${want}`);
        return 'crossed';
    }
    return GameMessages.sawSince(mark, DOOR_LOCKED) ? 'locked' : 'failed';
}

async function runMove(move: ChainMove, log: (m: string) => void): Promise<boolean> {
    return move.kind === 'pull'
        ? setLever(move.lever, move.to, log)
        : (await crossDoor(move, log)) === 'crossed';
}

/** The inverse of a pull is the same pull; the inverse of a crossing is its mirror. */
function invert(move: ChainMove): ChainMove {
    if (move.kind === 'pull') {
        return { kind: 'pull', lever: move.lever, to: move.to === 'up' ? 'down' : 'up' };
    }
    return { kind: 'door', door: move.door, stand: move.arrive, arrive: move.stand };
}

/**
 * How far into CHAIN this process has got. The only way to know which moves need
 * undoing — the lever bits are unreadable, and nothing but the ladder resets them.
 */
let executed = 0;

/** Retrace the executed prefix, which lands back at the ladder with every lever up. */
async function unwind(log: (m: string) => void): Promise<void> {
    log(`unwinding ${executed} chain move(s) back to the ladder`);
    for (let i = executed - 1; i >= 0; i--) {
        if (!(await runMove(invert(CHAIN[i]!), log))) {
            log(`unwind stalled at move ${i}`);
            return;
        }
        executed = i;
    }
    executed = 0;
}

async function enterBasement(log: (m: string) => void): Promise<boolean> {
    if (basementRegion(here()) !== 'outside') {
        return true;
    }
    if (!(await Traversal.walkResilient(EC_TILE.LADDER_DOWN_STAND, { radius: 1, attempts: 4, timeoutMs: 300_000, log }))) {
        log('could not reach the ladder alcove — is the bookcase crossing in transports.json?');
        return false;
    }
    await settleScene();
    const status = await Reach.locOp({
        name: 'Ladder',
        op: 'Climb-down',
        near: EC_TILE.LADDER_DOWN_STAND,
        expect: () => basementRegion(here()) !== 'outside',
        log
    });
    await settleScene();
    return status === 'done' && basementRegion(here()) !== 'outside';
}

// Why: `entry` and `r9` are the only rooms this can leave from, as everything else needs an unwind and only `fetchOilCan` knows how far the chain got.
// Why: a fresh process that starts stranded mid-maze cannot know the lever bits and says so rather than looping, since the levers reset on the ladder it cannot reach.

/** Walk out of the basement, or report that the position is unrecoverable. */
async function leaveBasement(log: (m: string) => void): Promise<boolean> {
    if (basementRegion(here()) === 'outside') {
        return true;
    }
    if (basementRegion(here()) === 'r9') {
        const back = invert(CHAIN[CHAIN.length - 1]!) as Extract<ChainMove, { kind: 'door' }>;
        if ((await crossDoor(back, log)) !== 'crossed') {
            return false;
        }
    }
    if (basementRegion(here()) !== 'entry') {
        log(`stranded in ${basementRegion(here())} with unknown lever state — cannot climb out`);
        return false;
    }
    const status = await Reach.locOp({
        name: 'Ladder',
        op: 'Climb-up',
        near: EC_TILE.LADDER_UP_STAND,
        expect: () => basementRegion(here()) === 'outside',
        log
    });
    await settleScene();
    return status === 'done' && basementRegion(here()) === 'outside';
}

// Why: the nav crossing exists, but the executor gets one look at the scene and the arrival here is a scripted teleport.
// Why: every loc query is empty for about a tick after one, so a single miss blacklists the edge and strands the bot in a pocket with no other way out.
// Why: Reach retries, which is the difference.

/** Pull the alcove lever back into the manor. */
async function leaveAlcove(log: (m: string) => void): Promise<boolean> {
    if (!inAlcove(here())) {
        return true;
    }
    await Sustain.run();
    if (!(await Traversal.walkResilient(EC_TILE.ALCOVE_LEVER, { radius: 1, attempts: 4, timeoutMs: 90_000, log }))) {
        log('could not reach the alcove lever');
        return false;
    }
    await settleScene();
    const status = await Reach.locOp({
        name: 'Lever',
        op: 'Pull',
        near: EC_TILE.ALCOVE_LEVER,
        expect: () => !inAlcove(here()),
        expectMs: 8000,
        log
    });
    await settleScene();
    if (status === 'done' && !inAlcove(here())) {
        log('pulled the alcove lever back into the manor');
        return true;
    }
    log('the alcove lever did not open the bookcase');
    return false;
}

/** Out of the basement and out of the alcove — two pockets, one exit each. */
export async function leaveManorBasement(log: (m: string) => void): Promise<boolean> {
    if (!(await leaveBasement(log))) {
        return false;
    }
    return leaveAlcove(log);
}

async function takeOilCan(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(EC_TILE.OIL_CAN_SPAWN, { radius: 1, attempts: 4, timeoutMs: 60_000, log }))) {
        return false;
    }
    await settleScene();
    const can = GroundItems.query().name(EC_NAME.OIL_CAN).within(6).nearest();
    if (!can) {
        log('no Oil can on the floor of the west room');
        return false;
    }
    if (!(await can.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => held(EC_ID.OIL_CAN) > 0, 8000);
}

/**
 * Bookcase, ladder, the fixed chain, the can, and back out. Every descent resets
 * `%ernestlever` (~reset_haunted_levers), so a pass always starts all-up.
 */
export async function fetchOilCan(log: (m: string) => void): Promise<boolean> {
    if (held(EC_ID.OIL_CAN) > 0) {
        return leaveManorBasement(log);
    }
    for (let pass = 0; pass < 3; pass++) {
        await Sustain.run();
        if (basementRegion(here()) !== 'entry' && !(await leaveBasement(log))) {
            return false;
        }
        if (!(await enterBasement(log))) {
            return false;
        }
        // The descent ran ~reset_haunted_levers, so the chain starts from all-up.
        executed = 0;
        let failed = false;
        for (const move of CHAIN) {
            await Sustain.run();
            if (!(await runMove(move, log))) {
                log(`chain move ${executed} failed — restarting the pass`);
                failed = true;
                break;
            }
            executed++;
        }
        if (failed || !(await takeOilCan(log))) {
            await unwind(log);
            continue;
        }
        // Why: the can is this step's deliverable, so the report is on the can rather than on the walk out.
        // Why: a false here re-enters the maze for a leg that already succeeded, and `decide()`'s escape branch retries the way out anyway.
        await leaveManorBasement(log);
        return held(EC_ID.OIL_CAN) > 0;
    }
    log('three passes of the lever chain and still no oil can');
    return false;
}
