import { Execution } from '../../../../execution/Execution.js';
import type Tile from '../../../../../geometry/Tile.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs, type Loc } from '../../../../locs/Locs.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { Reach } from '../../../../walking/Reach.js';
import { Traversal } from '../../../../walking/Traversal.js';
import type { NpcStop } from '../../exec/primitives.js';
import { driveChoice, driveUntil, heldId, settleScene } from '../../exec/prompts.js';
import {
    BONZO_ENTER,
    BONZO_REPORT,
    DWARF_REPORT,
    DWARF_START,
    FC_ID,
    FC_LOC,
    FC_NPC,
    FC_TILE,
    inCompound,
    nearestDwarf
} from './areas.js';

const WALK_MS = 180_000;
/** Morris runs two chat pages and an objbox before the teleport lands. */
const GATE_MS = 20_000;
/** Cast, four ticks of delay, the catch line — and on the third fish, Bonzo's hand-over. */
const CATCH_MS = 20_000;
/** The stash, then the stranger's complaint and his move to the willow tree. */
const STASH_MS = 20_000;

async function walkAndTalk(stop: NpcStop, log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (!here || here.level !== stop.anchor.level || stop.anchor.distanceTo(here) > stop.leash) {
        await Traversal.walkResilient(stop.anchor, { radius: 2, attempts: 3, timeoutMs: WALK_MS, log });
    }
    const status = await Reach.npcDialog({ name: stop.npc, near: stop.anchor, log });
    if (status !== 'done') {
        log(`could not open a dialogue with ${stop.npc} (${status})`);
        return false;
    }
    return driveChoice([...stop.prefer], log);
}

/** Whichever tunnel mouth is nearer, with the preference list this stage needs. */
function dwarfStop(prefer: readonly string[]): NpcStop {
    return { ...DWARF_START, anchor: nearestDwarf(Game.tile()), prefer: [...prefer] };
}

// Why: both halves run the crossing, but only the left one leaves without Bonzo's prompt on a merely-started quest, so it is asked for first and the right half is the fallback.
function gateLoc(): Loc | null {
    const find = (match: (id: number) => boolean): Loc | null =>
        Locs.query().where(l => match(l.id)).action('Open').within(5).nearest();
    return find(id => id === FC_LOC.GATE_LEFT) ?? find(id => id === FC_LOC.GATE_RIGHT);
}

// Why: leaving before the contest is won puts Bonzo's "calling it quits" in the way, and its other option leaves the gate shut — so the exit takes the reset, which costs the 5gp fee and keeps the stashed pipe.
const QUIT_CONTEST = "Yes I'll compete again another day.";

async function crossGate(stand: Tile, inside: boolean, log: (m: string) => void): Promise<boolean> {
    if (inCompound(Game.tile()) === inside) {
        return true;
    }
    if (!(await Traversal.walkResilient(stand, { radius: 1, attempts: 3, timeoutMs: WALK_MS, log }))) {
        return false;
    }
    await settleScene();
    const door = gateLoc();
    if (!door) {
        log(`no Hemenster Gate at (${stand.x},${stand.z})`);
        return false;
    }
    if (!(await door.interact('Open'))) {
        return false;
    }
    return driveUntil(() => inCompound(Game.tile()) === inside, inside ? [] : [QUIT_CONTEST], log, GATE_MS);
}

// Why: the gate is a baked door edge, but crossing it inbound is a conversation — Morris asks for the pass, spends two continues and an objbox on it, and only then teleports the player through, which no door handler drives.

/** Get past Morris onto the competition ground. */
function enterCompound(log: (m: string) => void): Promise<boolean> {
    return crossGate(FC_TILE.GATE_OUTSIDE, true, log);
}

/** Step back out through the gate, taking the reset if the contest is still running. */
export function leaveCompound(log: (m: string) => void): Promise<boolean> {
    return crossGate(FC_TILE.GATE_INSIDE, false, log);
}

export function startQuest(log: (m: string) => void): Promise<boolean> {
    return walkAndTalk(dwarfStop(DWARF_START.prefer), log);
}

export function claimPass(log: (m: string) => void): Promise<boolean> {
    return walkAndTalk(dwarfStop(DWARF_REPORT.prefer), log);
}

export async function payEntryFee(log: (m: string) => void): Promise<boolean> {
    if (!(await enterCompound(log))) {
        return false;
    }
    return walkAndTalk(BONZO_ENTER, log);
}

// Why: the pipe is what moves the stranger off the winning spot, and Bonzo only re-seats the contest while no fish has been caught yet — so this runs before the first cast, never after.
// Why: the stand is the pipe's own tile rather than the tile beside it, which is what `useOnLoc`'s radius-2 walk would settle for — the engine refuses a straight wall decoration from anywhere else.

/** Push the clove into the wall pipe; the stranger smells it and swaps spots. */
export async function stashGarlic(log: (m: string) => void): Promise<boolean> {
    if (!(await enterCompound(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(FC_TILE.PIPE_STAND, { radius: 0, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    await settleScene();
    const here = Game.tile();
    const pipe = Locs.query()
        .where(l => l.id === FC_LOC.WALL_PIPE && here !== null && l.tile().x === here.x && l.tile().z === here.z)
        .nearest();
    const garlic = Inventory.items().find(item => item.id === FC_ID.GARLIC);
    if (!pipe || !garlic) {
        log(`no Wall Pipe underfoot at (${FC_TILE.PIPE_STAND.x},${FC_TILE.PIPE_STAND.z}) or no garlic to stash`);
        return false;
    }
    if (!(await garlic.useOn(pipe))) {
        return false;
    }
    return driveUntil(() => heldId(FC_ID.GARLIC) === 0, [], log, STASH_MS);
}

// Why: one cast per call — the third fish triggers Bonzo's hand-over inside the same script, and the trophy, not the carp, is what proves the contest is over.

/** Cast once at the pipes spot. */
export async function fishAtPipes(log: (m: string) => void): Promise<boolean> {
    if (!(await enterCompound(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(FC_TILE.PIPES_SPOT, { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    await settleScene();
    const spot = Npcs.query().where(n => n.id === FC_NPC.PIPES_SPOT).action('Fish').within(8).nearest();
    if (!spot) {
        log(`no contest Fishing spot at (${FC_TILE.PIPES_SPOT.x},${FC_TILE.PIPES_SPOT.z})`);
        return false;
    }
    const before = heldId(FC_ID.RAW_GIANT_CARP);
    if (!(await spot.interact('Fish'))) {
        return false;
    }
    return driveUntil(() => heldId(FC_ID.RAW_GIANT_CARP) > before || heldId(FC_ID.TROPHY) > 0, [], log, CATCH_MS);
}

// Why: sardines mean the willow spot was fished, which cannot win — handing them to Bonzo loses the round and resets the entry, and the stashed pipe seats the re-entry beside the pipes.

/** Lose the round on purpose, back to a payable entry. */
export async function handOverCatch(log: (m: string) => void): Promise<boolean> {
    if (!(await enterCompound(log))) {
        return false;
    }
    if (!(await walkAndTalk(BONZO_REPORT, log))) {
        return false;
    }
    return heldId(FC_ID.RAW_SARDINE) === 0;
}

/** Bonzo keeps a spare trophy for a champion who lost theirs. */
export async function claimSpareTrophy(log: (m: string) => void): Promise<boolean> {
    if (!(await enterCompound(log))) {
        return false;
    }
    if (!(await walkAndTalk(BONZO_REPORT, log))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(FC_ID.TROPHY) > 0, 5000);
}

export async function deliverTrophy(log: (m: string) => void): Promise<boolean> {
    if (!(await leaveCompound(log))) {
        return false;
    }
    return walkAndTalk(dwarfStop(DWARF_REPORT.prefer), log);
}
