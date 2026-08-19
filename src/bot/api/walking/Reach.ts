import type { WorldTile } from '../../adapter/ClientAdapter.js';
import { reader } from '../../adapter/ClientAdapter.js';
import { Execution } from '../execution/Execution.js';
import { ChatDialog } from '../ui/dialogue/ChatDialog.js';
import { Locs } from '../locs/Locs.js';
import { Npcs, talkOp } from '../npcs/Npcs.js';
import { Reachability } from '../../event/webwalk/geometry/Reachability.js';
import { Traversal } from './Traversal.js';
import { WalkExecutor, isOpenableBarrier } from '../../event/webwalk/WalkExecutor.js';
import { openOp, towardDest } from '../../event/webwalk/walkOpening.js';
import { chebyshev } from '../../event/webwalk/geometry/followMath.js';
import { CANT_REACH, GameMessages } from '../chatbox/gameMessages.js';
import type { Interactable } from '../model/Interactable.js';

type ReachStatus = 'done' | 'retry' | 'unreachable';

interface ReachLocOpts {
    name: string;
    op: string;
    near: WorldTile;
    within?: number;
    // Why: display names collide — four ordinary crates answer "Search" within six tiles of Wydin's grocery crate, and the nearest is rarely the one the quest means.

    /** Exact loc id, when the display name is shared with something else in range. */
    id?: number;
    expect: () => boolean;
    expectMs?: number;
    log?: (m: string) => void;
}

interface ReachNpcOpts {
    name: string;
    near: WorldTile;
    openMs?: number;
    log?: (m: string) => void;
}

interface ReachEntity extends Interactable {
    tile(): WorldTile;
}

interface ReachEntityOpts<T extends ReachEntity> {
    find: () => T | null;
    op: string;
    expect: () => boolean;
    /** Probe the scene for a shut door instead of waiting on the server's verdict. */
    openWhenUnreachable?: boolean;
    expectMs?: number;
    what?: string;
    log?: (m: string) => void;
}

const REACH_BFS_STEPS = 400;
/**
 * How far the scene probe's verdict is worth trusting.
 * Why: `REACH_BFS_STEPS` expansions run out at ~11 tiles of open ground, so beyond this a plain "too far" is indistinguishable from "walled off" and a patrolling target would have us opening doors for nothing.
 */
const PROBE_RADIUS = 10;

async function closeIn(near: WorldTile, radius: number, log: (m: string) => void): Promise<ReachStatus> {
    const ok = await Traversal.walkResilient(near, { radius, attempts: 4, timeoutMs: 90_000, log });
    if (!ok && WalkExecutor.lastOutcome === 'unreachable') {
        log(`reach: hint (${near.x},${near.z},${near.level}) is unreachable`);
        return 'unreachable';
    }
    return 'retry';
}

/** How long a blank scene at the stand is worth re-asking, matching the transport layer's ceiling. */
const LOC_SCENE_MS = 3000;

// Why: a teleport or level change empties every scene query for a few ticks, so blank while standing where the loc lives means not-yet-rebuilt, not absent (docs/decisions/level-change-lag.md). Walking the hint instead skips the op entirely and hands the caller a 'retry' it reads as a failure.

/** Re-ask for a loc the player is already standing among, so a rebuild in flight does not read as absent. */
async function sceneSettled(find: () => unknown, near: WorldTile, within: number): Promise<boolean> {
    const here = reader.worldTile();
    if (!here || here.level !== near.level || chebyshev(here, near) > within) {
        return false;
    }
    return Execution.delayUntil(() => find() !== null, LOC_SCENE_MS);
}

const REACH_DOOR_ATTEMPTS = 8;

// Why: a shut wall-door blocks the step onto its own tile, so an adjacentOk probe rejects the one door that needs opening (#293).
// Why: wall locs operate from either side of their edge, so reaching any tile on or beside the door is enough to click it.
function doorApproachable(doorTile: WorldTile): boolean {
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            if (Reachability.canReach({ x: doorTile.x + dx, z: doorTile.z + dz, level: doorTile.level }, { maxSteps: REACH_BFS_STEPS })) {
                return true;
            }
        }
    }
    return false;
}

async function openBlockingDoor(toward: WorldTile, log: (m: string) => void): Promise<boolean> {
    const here = reader.worldTile();
    if (!here) { return false; }
    const door = Locs.query()
        .where(l => isOpenableBarrier(l.name, l.actions()))
        .where(l => l.distance() <= 6
            && towardDest(l.tile(), here, toward)
            && doorApproachable(l.tile()))
        .nearest();
    if (!door) { return false; }
    const t = door.tile();
    if (chebyshev(here, t) > 1) {
        await Traversal.walkResilient(t, { radius: 1, attempts: 3, timeoutMs: 30_000, log });
    }
    const shut = Locs.query().where(l => l.tile().x === t.x && l.tile().z === t.z && isOpenableBarrier(l.name, l.actions())).nearest();
    if (!shut) { return true; }
    const op = openOp(shut.actions());
    if (!op) { return false; }
    log(`reach: opening blocking '${shut.name}' at (${t.x},${t.z})`);
    if (!(await shut.interact(op))) { return false; }
    return Execution.delayUntil(() => {
        const still = Locs.query().where(l => l.tile().x === t.x && l.tile().z === t.z && isOpenableBarrier(l.name, l.actions())).nearest();
        return still === null;
    }, 5000);
}

async function reachThroughDoors(
    attempt: () => Promise<boolean>,
    expect: () => boolean,
    expectMs: number,
    targetTile: () => WorldTile | null,
    what: string,
    log: (m: string) => void,
    retryAfterTimeout = true,
    probeUnreachable = false
): Promise<ReachStatus> {
    for (let i = 0; i < REACH_DOOR_ATTEMPTS; i++) {
        // Why: the server only says "I can't reach that!" once its own path search dead-ends, which a target that keeps moving can postpone forever.
        // Why: for those, probing the scene is cheap — a wrong probe falls through to the click below and costs nothing.
        if (probeUnreachable && !expect()) {
            const blocked = targetTile();
            const here = reader.worldTile();
            if (blocked && here && blocked.level === here.level && chebyshev(here, blocked) <= PROBE_RADIUS
                && !Reachability.canReach(blocked, { maxSteps: REACH_BFS_STEPS, adjacentOk: true })
                && (await openBlockingDoor(blocked, log))) {
                continue;
            }
        }
        const mark = GameMessages.mark();
        const dispatched = await attempt();
        if (dispatched) {
            await Execution.delayUntil(() => expect() || GameMessages.sawSince(mark, CANT_REACH), expectMs);
            if (expect()) { return 'done'; }
            if (GameMessages.sawSince(mark, CANT_REACH)) {
                const toward = targetTile();
                if (!toward || !(await openBlockingDoor(toward, log))) {
                    log(`reach: '${what}' — server can't reach it and no openable door in front (unreachable)`);
                    return 'unreachable';
                }
                continue;
            }
        }
        if (!retryAfterTimeout) {
            if (!dispatched) {
                await Execution.delayTicks(1);
            }
            return 'retry';
        }
        await Execution.delayTicks(1);
    }
    return 'retry';
}

/**
 * The shared last-mile primitive: walk to a stand, act, and open the blocking door when the server says it cannot reach.
 * Why: use this rather than hand-rolling another approach loop.
 * @see docs/reference/nav-walker.md#the-reach-primitive
 */
export const Reach = {
    async entityOp<T extends ReachEntity>(opts: ReachEntityOpts<T>): Promise<ReachStatus> {
        const log = opts.log ?? ((): void => {});
        return reachThroughDoors(
            async () => {
                if (opts.expect()) { return true; }
                const entity = opts.find();
                return entity ? await entity.interact(opts.op) : false;
            },
            opts.expect,
            opts.expectMs ?? 5000,
            () => opts.find()?.tile() ?? null,
            opts.what ?? opts.op,
            log,
            false,
            opts.openWhenUnreachable ?? false
        );
    },

    async locOp(opts: ReachLocOpts): Promise<ReachStatus> {
        const log = opts.log ?? ((): void => {});
        const find = () => Locs.query()
            .name(opts.name)
            .action(opts.op)
            .within(opts.within ?? 10)
            .where(l => opts.id === undefined || l.id === opts.id)
            .nearest();
        if (!find() && !(await sceneSettled(find, opts.near, opts.within ?? 10))) {
            return closeIn(opts.near, 2, log);
        }
        const arrived = await Traversal.walkResilient(opts.near, { radius: 1, attempts: 4, timeoutMs: 90_000, log });
        if (!arrived && WalkExecutor.lastOutcome === 'unreachable') {
            log(`reach: stand (${opts.near.x},${opts.near.z},${opts.near.level}) unreachable`);
            return 'unreachable';
        }
        return reachThroughDoors(
            async () => {
                const loc = find();
                return loc ? await loc.interact(opts.op) : false;
            },
            opts.expect,
            opts.expectMs ?? 12_000,
            () => find()?.tile() ?? null,
            opts.name,
            log
        );
    },

    async npcDialog(opts: ReachNpcOpts): Promise<ReachStatus> {
        const log = opts.log ?? ((): void => {});
        if (ChatDialog.isOpen()) {
            const cur = Npcs.query().name(opts.name).nearest();
            const me = reader.worldTile();
            if (cur && me && cur.tile().level === me.level &&
                Math.max(Math.abs(cur.tile().x - me.x), Math.abs(cur.tile().z - me.z)) <= 1) {
                return 'done';
            }
            return 'retry';
        }
        const find = () => Npcs.query().name(opts.name).where(n => talkOp(n.actions()) !== null).nearest();
        if (!find()) {
            return closeIn(opts.near, 3, log);
        }
        const arrived = await Traversal.walkResilient(opts.near, { radius: 1, attempts: 4, timeoutMs: 90_000, log });
        if (!arrived && WalkExecutor.lastOutcome === 'unreachable') {
            log(`reach: stand (${opts.near.x},${opts.near.z},${opts.near.level}) unreachable`);
            return 'unreachable';
        }
        return reachThroughDoors(
            async () => {
                const npc = find();
                return npc ? await npc.interact(talkOp(npc.actions()) ?? 'Talk-to') : false;
            },
            () => ChatDialog.isOpen() || ChatDialog.canContinue(),
            opts.openMs ?? 15_000,
            () => find()?.tile() ?? null,
            opts.name,
            log,
            true,
            true
        );
    }
};
