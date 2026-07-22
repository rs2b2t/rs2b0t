// The shared LAST-MILE primitive: get to a loc/NPC and act on it, using each
// channel the way the real game does — client web-walk to get NEAR, the op's
// own SERVER-walk for the final tiles (it crosses furniture-tight interiors
// the client BFS refuses and tracks patrolling NPCs), and a walk-THROUGH when
// a closed door/wall blocks an in-scene target: the server op-walk HALTS at,
// and races the auto-reshut of, a closed door, so we walkResilient to the
// target and the hardened walker drives the baked door-edge open and steps
// across (the earlier "open the nearest leaf" pre-step only opened it — the
// racing op-walk lost to the reshut; live: the L1 Traiborn stall).
// Replaces the per-quest interior-stand/OPLOC/open-the-leaf hacks.
// Honest tri-state: 'done' | 'retry' (re-enter me) | 'unreachable' (the walk
// PROVED the hint can't be reached — re-plan, don't loop).

import type { WorldTile } from '../adapter/ClientAdapter.js';
import { reader } from '../adapter/ClientAdapter.js';
import { Execution } from './Execution.js';
import { ChatDialog } from './hud/ChatDialog.js';
import { Locs } from './queries/Locs.js';
import { Npcs } from './queries/Npcs.js';
import { Reachability } from './Reachability.js';
import { Traversal } from './Traversal.js';
import { WalkExecutor, isOpenableBarrier } from '../nav/WalkExecutor.js';
import { openOp, towardDest } from './walkOpening.js';
import { chebyshev } from '../nav/followMath.js';
import { CANT_REACH, GameMessages } from '../events/gameMessages.js';
import { talkOp } from '../quests/exec/primitives.js';

export type ReachStatus = 'done' | 'retry' | 'unreachable';

export interface ReachLocOpts {
    name: string;
    op: string;
    near: WorldTile;
    within?: number;
    expect: () => boolean;
    expectMs?: number;
    log?: (m: string) => void;
}

export interface ReachNpcOpts {
    name: string;
    near: WorldTile;
    openMs?: number;
    log?: (m: string) => void;
}

const REACH_BFS_STEPS = 400;

/** Walk toward a hint tile; map a PROVEN-unreachable walk to the honest
 *  tri-state so callers re-plan instead of re-entering forever. */
async function closeIn(near: WorldTile, radius: number, log: (m: string) => void): Promise<ReachStatus> {
    // attempts:4 (not 3) so the W1 verify/unreachable terminal runs before the bound
    const ok = await Traversal.walkResilient(near, { radius, attempts: 4, timeoutMs: 90_000, log });
    if (!ok && WalkExecutor.lastOutcome === 'unreachable') {
        log(`reach: hint (${near.x},${near.z},${near.level}) is unreachable`);
        return 'unreachable';
    }
    return 'retry';
}

// How many click→(open a door)→click cycles before we give up and let the
// caller re-enter. Bounds a genuinely-stuck reach; a normal multi-door interior
// needs one cycle per door in the way.
const REACH_DOOR_ATTEMPTS = 8;

/**
 * Open the ONE shut door/gate between us and `toward`, as a discrete settled
 * step (walk to the door's own tile — reachable on our side, unlike a wall-
 * locked target — open it, wait for the leaf to swing). The counterpart to the
 * server's "I can't reach that!": that message means a closed door blocks the
 * op-walk, so we open it and let the next op-walk cross. False when there is no
 * reachable openable door in front of us (a genuine block, not a door problem).
 */
async function openBlockingDoor(toward: WorldTile, log: (m: string) => void): Promise<boolean> {
    const here = reader.worldTile();
    if (!here) { return false; }
    const door = Locs.query()
        .where(l => isOpenableBarrier(l.name, l.actions()))
        .where(l => l.distance() <= 6
            && towardDest(l.tile(), here, toward)
            && Reachability.canReach(l.tile(), { maxSteps: REACH_BFS_STEPS, adjacentOk: true }))
        .nearest();
    if (!door) { return false; }
    const t = door.tile();
    if (chebyshev(here, t) > 1) {
        // A stable tile on our side of the wall — walking to it never dances the
        // way walking to a wall-locked target does.
        await Traversal.walkResilient(t, { radius: 1, attempts: 3, timeoutMs: 30_000, log });
    }
    const shut = Locs.query().where(l => l.tile().x === t.x && l.tile().z === t.z && isOpenableBarrier(l.name, l.actions())).nearest();
    if (!shut) { return true; } // already open (someone/we swung it) — progress made
    const op = openOp(shut.actions());
    if (!op) { return false; }
    log(`reach: server said 'can't reach' — opening blocking '${shut.name}' at (${t.x},${t.z})`);
    if (!(await shut.interact(op))) { return false; }
    return Execution.delayUntil(() => {
        const still = Locs.query().where(l => l.tile().x === t.x && l.tile().z === t.z && isOpenableBarrier(l.name, l.actions())).nearest();
        return still === null;
    }, 5000);
}

/**
 * The reach loop: click the target (the SERVER walks us there — it crosses
 * furniture-tight interiors the client BFS refuses); on the server's own "I
 * can't reach that!", open the ONE blocking door and click again. Decoupled
 * from the client-side canReach gate + the open-and-cross-in-one-motion that
 * raced the door reshut and DANCED in multi-door interiors (the Wizards' Tower).
 * `attempt` issues one interaction (re-finding the live target) and returns
 * whether it dispatched; `targetTile` gives the door-bias direction. Honest
 * tri-state: 'done' on `expect`, 'unreachable' on can't-reach with no openable
 * door, 'retry' otherwise (re-entrant).
 */
async function reachThroughDoors(
    attempt: () => Promise<boolean>,
    expect: () => boolean,
    expectMs: number,
    targetTile: () => WorldTile | null,
    what: string,
    log: (m: string) => void
): Promise<ReachStatus> {
    for (let i = 0; i < REACH_DOOR_ATTEMPTS; i++) {
        const mark = GameMessages.mark();
        if (await attempt()) {
            // Wait for the op-walk to land OR the server to reject it at a door.
            await Execution.delayUntil(() => expect() || GameMessages.sawSince(mark, CANT_REACH), expectMs);
            if (expect()) { return 'done'; }
            if (GameMessages.sawSince(mark, CANT_REACH)) {
                const toward = targetTile();
                if (!toward || !(await openBlockingDoor(toward, log))) {
                    log(`reach: '${what}' — server can't reach it and no openable door in front (unreachable)`);
                    return 'unreachable';
                }
                continue; // door open — click again; the op-walk crosses it
            }
        }
        // Couldn't dispatch (out of range / patrol shifted) or timed out still
        // walking a long op-path: brief settle, then retry.
        await Execution.delayTicks(1);
    }
    return 'retry';
}

export const Reach = {
    /** Reach a loc and fire `op` on it, awaiting `expect`. Re-entrant. Clicks the
     *  loc and lets the SERVER walk the last mile, opening any blocking door on
     *  the server's "can't reach" (never trusting the client canReach BFS, which
     *  danced in multi-door interiors). Out of scene → web-walk to `near` first. */
    async locOp(opts: ReachLocOpts): Promise<ReachStatus> {
        const log = opts.log ?? ((): void => {});
        const find = () => Locs.query().name(opts.name).action(opts.op).within(opts.within ?? 10).nearest();
        if (!find()) {
            return closeIn(opts.near, 2, log);
        }
        // Walk onto the caller's REACHABLE stand (crossing entrance doors — the
        // walker's job). Never walk to the loc's own tile: a wall-locked target
        // (a tower staircase) is only enterable via the op, so arriving there is
        // geometrically impossible and the walker danced on the wrong-side tile.
        const arrived = await Traversal.walkResilient(opts.near, { radius: 1, attempts: 4, timeoutMs: 90_000, log });
        if (!arrived && WalkExecutor.lastOutcome === 'unreachable') {
            log(`reach: stand (${opts.near.x},${opts.near.z},${opts.near.level}) unreachable`);
            return 'unreachable';
        }
        // From the stand, click the loc (server op-walks the last tiles / crosses
        // furniture-tight interiors) and open any remaining door on 'can't reach'.
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

    /** Reach an NPC and get a Talk-to dialogue OPEN (driving it is the
     *  caller's job — talkThrough). Tracks patrols via the live query +
     *  server-walk. Re-entrant. */
    async npcDialog(opts: ReachNpcOpts): Promise<ReachStatus> {
        const log = opts.log ?? ((): void => {});
        if (ChatDialog.isOpen()) {
            // Only treat an already-open box as THIS npc's dialogue when we're
            // standing next to the target — a foreign box (a random-event dialogue,
            // or another NPC's sticky menu; live: Merlin's candle maker) must NOT
            // read as success, or the caller's talkThrough mis-drives it with the
            // wrong prefer. Foreign box → retry (the runtime clears random events; a
            // re-enter finds it gone). Keeps npcDialog re-entrant for an interrupted
            // TARGET dialogue while ignoring foreign ones.
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
        // Walk onto the caller's reachable stand (crossing entrance doors), then
        // Talk-to and let the server op-walk track the NPC's patrol. Never walk
        // to the npc's own tile — a door-gated npc sits on the far side, so that
        // arrival danced (the L1 Traiborn stall).
        const arrived = await Traversal.walkResilient(opts.near, { radius: 1, attempts: 4, timeoutMs: 90_000, log });
        if (!arrived && WalkExecutor.lastOutcome === 'unreachable') {
            log(`reach: stand (${opts.near.x},${opts.near.z},${opts.near.level}) unreachable`);
            return 'unreachable';
        }
        // Talk-to and open any remaining door on the server's "can't reach".
        return reachThroughDoors(
            async () => {
                const npc = find();
                return npc ? await npc.interact(talkOp(npc.actions()) ?? 'Talk-to') : false;
            },
            () => ChatDialog.isOpen() || ChatDialog.canContinue(),
            opts.openMs ?? 15_000,
            () => find()?.tile() ?? null,
            opts.name,
            log
        );
    }
};
