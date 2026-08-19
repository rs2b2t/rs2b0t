// docs/QUESTS.md
import { DirectNavigator } from '../../../../../event/webwalk/DirectNavigator.js';
import { Reachability } from '../../../../../event/webwalk/geometry/Reachability.js';
import Tile from '../../../../../geometry/Tile.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import { Npcs, type Npc } from '../../../../npcs/Npcs.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { GATE_ZONE, PEN, SHEEP_SPAWN, inBox, sheepName, type SheepIndex } from './areas.js';
import { HERD_DIRS, herdCost, herdDirections, herdPlan, type HerdDir, type HerdGrid } from './herdPath.js';

// Why: the shortest route is 31 pushes and the longest 58, and drift near a sheep's own spawn roughly triples the count — 90 pushes for the 31-tile leg, live.

/** Pushes one leg may spend before it hands the budget back to the engine. */
const PROD_BUDGET = 260;

/** How often the leg reports where the sheep has got to. */
const PROGRESS_EVERY = 25;

/** Consecutive pushes that move nothing before the leg gives up on this sheep. */
const STUCK_LIMIT = 8;

const APPROACH_RADIUS = 6;

/** How far the follow stays on the client's own pathfinder rather than the world-walker. */
const FOLLOW_RADIUS = 14;

/** How far back along the push axis a Prod may be issued from without walking first. */
const APPROACH_RAY = 3;

/** Off-axis landings before the leg stops trusting the server to take the last step. */
const STRAY_LIMIT = 6;

// Why: the strip along the enclosure's south-east corner — (2610,3351), (2612,3349), (2610,3348) — is walkable, on the way home, and has no standable side at all, so the wait here is a brief one and the leg then goes for another copy.

/** Ticks to give a trapped sheep to wander clear, and how many such waits a leg allows. */
const PINNED_WAIT = 3;
const PINNED_LIMIT = 8;

/** How far the herded sheep may be from where the last push left it and still be the same sheep. */
const LOCK_RADIUS = 5;

const SCENE_GRID: HerdGrid = {
    walkable: (x, z) => Reachability.walkable({ x, z, level: 0 }),
    canStep: (x, z, dx, dz) => Reachability.canStep({ x, z, level: 0 }, { x: x + dx, z: z + dz, level: 0 })
};

function copies(n: SheepIndex): Npc[] {
    return Npcs.query().name(sheepName(n)).results();
}

// Why: three copies of every sheep share one quest bit and one display name, and the herded one is only ever a tile or two from where it was last seen — so the lock is its last tile, not its client slot, which churns when the scene rebuilds.

/** The copy still standing where the herd left it. */
function nearLast(n: SheepIndex, last: { x: number; z: number }): Npc | null {
    let best: { npc: Npc; d: number } | null = null;
    for (const npc of copies(n)) {
        const t = npc.tile();
        const d = Math.max(Math.abs(t.x - last.x), Math.abs(t.z - last.z));
        if (d <= LOCK_RADIUS && (best === null || d < best.d)) {
            best = { npc, d };
        }
    }
    return best?.npc ?? null;
}

function routeCost(npc: Npc): number | undefined {
    const t = npc.tile();
    return herdCost(herdPlan(SCENE_GRID, t, GATE_ZONE), t.x, t.z);
}

// Why: a sheep sitting in a trap has no route at all, and the other two copies of its type carry the same quest bit — so the leg fetches one of those rather than waiting out a 500-tick teleport.

/** The copy with the shortest push route home, ignoring any that no push can move. */
function pickSheep(n: SheepIndex): Npc | null {
    let best: { npc: Npc; cost: number } | null = null;
    for (const npc of copies(n)) {
        const cost = routeCost(npc);
        if (cost === undefined) {
            continue;
        }
        if (best === null || cost < best.cost) {
            best = { npc, cost };
        }
    }
    return best?.npc ?? null;
}

export function sheepInPen(n: SheepIndex): Npc | null {
    return copies(n).find(npc => inBox(PEN, npc.tile())) ?? null;
}

// Why: an npc enters the client's list only within about fifteen tiles, so "not in the scene" is a statement about where the character is standing, not about the sheep.

/** Walk to the sheep's map spawn when no copy of it is both in range and movable. */
async function findSheep(n: SheepIndex, log: (m: string) => void): Promise<Npc | null> {
    const here = pickSheep(n);
    if (here) {
        return here;
    }
    log(`sheepherder: no movable ${sheepName(n)} in range — walking to its field at (${SHEEP_SPAWN[n].x},${SHEEP_SPAWN[n].z})`);
    if (!(await Traversal.walkResilient(SHEEP_SPAWN[n], { radius: 4, attempts: 3, timeoutMs: 180_000, log }))) {
        return null;
    }
    await Execution.delayTicks(2);
    const found = pickSheep(n);
    if (!found) {
        // Why: `npc_del` on the map spawn queues a respawn, so an empty field means waiting rather than failing outright.
        log(`sheepherder: ${sheepName(n)} not at its field — waiting out the respawn`);
        await Execution.delayTicks(8);
    }
    return found;
}

/** Refusals arrive as a mesbox or a player line; both have to be cleared before the next push. */
export async function clearRefusal(): Promise<boolean> {
    let seen = false;
    for (let i = 0; i < 8 && (Modals.isOpen() || ChatDialog.isOpen() || ChatDialog.canContinue()); i++) {
        seen = true;
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
        } else if (Modals.isOpen()) {
            await Modals.close();
        } else {
            break;
        }
        await Execution.delayTicks(1);
    }
    return seen;
}

// Why: the two gate tiles are baked door edges, and a world-walk that has to finish on one spends its budget opening the gate rather than arriving — a stalled follow cost 66 seconds live, and the sheep wandered home inside it.
// Why: the follow is always inside the loaded scene, so the client's own pathfinder is the right tool and the world-walker is for the opening approach alone.

// Why: the Prod op walks the character to an adjacent tile itself, so standing anywhere on the line behind the sheep leaves the server to take the last step — which halves the cycle, and every tick saved is a tick the sheep is not in wander mode.

/** Whether a Prod issued from here will be run from the tile the push needs. */
function behindSheep(me: { x: number; z: number; level: number } | null, sheep: Tile, dir: HerdDir): boolean {
    if (!me || me.level !== 0) {
        return false;
    }
    for (let step = 1; step <= APPROACH_RAY; step++) {
        if (me.x === sheep.x - dir.dx * step && me.z === sheep.z - dir.dz * step) {
            return true;
        }
    }
    return false;
}

/** Step onto the tile the push has to be issued from. */
async function standOpposite(sheep: Tile, dir: HerdDir, log: (m: string) => void): Promise<boolean> {
    const stand = new Tile(sheep.x - dir.dx, sheep.z - dir.dz, 0);
    const on = (): boolean => {
        const t = Game.tile();
        return t !== null && t.level === 0 && t.x === stand.x && t.z === stand.z;
    };
    if (on()) {
        return true;
    }
    const here = Game.tile();
    if (here && here.level === 0 && Math.max(Math.abs(here.x - stand.x), Math.abs(here.z - stand.z)) <= FOLLOW_RADIUS) {
        await DirectNavigator.walkTo(stand, 0, 8000);
    } else {
        await Traversal.walkResilient(stand, { radius: 0, attempts: 1, timeoutMs: 20_000, log });
    }
    if (on()) {
        return true;
    }
    log(`sheepherder: could not stand at (${stand.x},${stand.z}) to push ${sheep.x},${sheep.z}`);
    return false;
}

// Why: inside the gate zone the jump reads the sheep's own coord before the walk, so any push sends it over and the nearest stand is the fastest one.

/** Every tile a prod can be issued from, for a sheep already standing in the gate zone. */
function anyStand(tile: Tile): HerdDir[] {
    const me = Game.tile();
    return HERD_DIRS
        .filter(dir => SCENE_GRID.walkable(tile.x - dir.dx, tile.z - dir.dz)
            && SCENE_GRID.canStep(tile.x - dir.dx, tile.z - dir.dz, dir.dx, dir.dz))
        .sort((a, b) => standCost(tile, a, me) - standCost(tile, b, me));
}

function standCost(tile: Tile, dir: HerdDir, me: { x: number; z: number } | null): number {
    if (!me) {
        return 0;
    }
    return Math.max(Math.abs(tile.x - dir.dx - me.x), Math.abs(tile.z - dir.dz - me.z));
}

type Push = 'wanted' | 'elsewhere' | 'refused';

async function pushOnce(n: SheepIndex, npc: Npc, dir: HerdDir, log: (m: string) => void): Promise<Push> {
    const before = npc.tile();
    if (!(await npc.interact('Prod'))) {
        log(`sheepherder: no Prod op on ${sheepName(n)}`);
        return 'refused';
    }
    const moved = await Execution.delayUntil(() => {
        const now = nearLast(n, before);
        return now === null || now.tile().x !== before.x || now.tile().z !== before.z;
    }, 6000);
    await clearRefusal();
    if (!moved) {
        return 'refused';
    }
    const after = nearLast(n, before)?.tile();
    const wanted = after !== undefined && after.x === before.x + dir.dx && after.z === before.z + dir.dz;
    return wanted ? 'wanted' : 'elsewhere';
}

/**
 * Push one sheep out to the tiles west of the gate and then over it.
 * Why: the route is re-derived from the sheep's own tile on every push, because the sheep's ai_timer returns it to wander mode and it drifts back toward spawn.
 */
export async function herdToPen(n: SheepIndex, log: (m: string) => void): Promise<boolean> {
    const first = await findSheep(n, log);
    if (!first) {
        return false;
    }
    if (!(await Traversal.walkResilient(first.tile(), { radius: APPROACH_RADIUS, attempts: 3, timeoutMs: 180_000, log }))) {
        return false;
    }
    let last = (pickSheep(n) ?? first).tile();
    let stuck = 0;
    let pinned = 0;
    let strayed = 0;
    for (let push = 0; push < PROD_BUDGET; push++) {
        const sheep = nearLast(n, last) ?? pickSheep(n);
        if (!sheep) {
            log(`sheepherder: lost ${sheepName(n)} mid-herd`);
            return false;
        }
        const tile = sheep.tile();
        last = tile;
        if (inBox(PEN, tile)) {
            log(`sheepherder: ${sheepName(n)} is in the enclosure after ${push} push(es)`);
            return true;
        }
        if (push > 0 && push % PROGRESS_EVERY === 0) {
            const me = Game.tile();
            log(`sheepherder: ${sheepName(n)} at (${tile.x},${tile.z}) after ${push} push(es), herder at (${me?.x},${me?.z})`);
        }
        const dirs = inBox(GATE_ZONE, tile) ? anyStand(tile) : herdDirections(SCENE_GRID, tile, GATE_ZONE);
        // Why: a sheep that wandered onto a tile with no standable side — the strip north of the enclosure's south fence is one — is pinned rather than lost, so the leg waits it out instead of throwing the pushes away.
        if (dirs.length === 0) {
            if (++pinned > PINNED_LIMIT) {
                log(`sheepherder: ${sheepName(n)} stayed pinned at (${tile.x},${tile.z})`);
                return false;
            }
            await Execution.delayTicks(PINNED_WAIT);
            continue;
        }
        pinned = 0;
        if (stuck >= STUCK_LIMIT) {
            log(`sheepherder: ${sheepName(n)} refused ${STUCK_LIMIT} pushes near (${tile.x},${tile.z})`);
            return false;
        }
        // Why: a refused push falls through to the next-best direction rather than re-issuing the one that landed nothing.
        const dir = dirs[Math.min(stuck, dirs.length - 1)];
        const ready = strayed < STRAY_LIMIT && behindSheep(Game.tile(), tile, dir);
        if (!ready && !(await standOpposite(tile, dir, log))) {
            stuck++;
            continue;
        }
        const now = nearLast(n, tile);
        if (!now || now.tile().x !== tile.x || now.tile().z !== tile.z) {
            // Why: the sheep wandered while the walk landed, so the stand behind it is the wrong tile now.
            await Execution.delayTicks(1);
            continue;
        }
        const outcome = await pushOnce(n, now, dir, log);
        // Why: a landing off the push axis is usually the sheep's own wander step, so the count is a streak — six in a row says the server is approaching from a side of its own choosing, and one good push says it is not.
        // Why: it has to reset, because walking every stand doubles the cycle, which doubles the time the sheep spends walking home, which strays it again — one unlucky run cost twenty minutes on one sheep.
        strayed = outcome === 'wanted' ? 0 : strayed + 1;
        if (strayed === STRAY_LIMIT) {
            log(`sheepherder: ${sheepName(n)} kept landing off the push axis — walking the stand until one lands`);
        }
        stuck = outcome === 'refused' ? stuck + 1 : 0;
    }
    log(`sheepherder: ${sheepName(n)} not penned within ${PROD_BUDGET} pushes`);
    return false;
}
