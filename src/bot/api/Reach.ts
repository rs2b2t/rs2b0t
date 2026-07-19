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
import { Execution } from './Execution.js';
import { ChatDialog } from './hud/ChatDialog.js';
import { Locs } from './queries/Locs.js';
import { Npcs } from './queries/Npcs.js';
import { Reachability } from './Reachability.js';
import { Traversal } from './Traversal.js';
import { WalkExecutor } from '../nav/WalkExecutor.js';

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
    const ok = await Traversal.walkResilient(near, { radius, attempts: 3, timeoutMs: 90_000, log });
    if (!ok && WalkExecutor.lastOutcome === 'unreachable') {
        log(`reach: hint (${near.x},${near.z},${near.level}) is unreachable`);
        return 'unreachable';
    }
    return 'retry';
}

export const Reach = {
    /** Reach a loc and fire `op` on it, awaiting `expect`. Re-entrant. */
    async locOp(opts: ReachLocOpts): Promise<ReachStatus> {
        const log = opts.log ?? ((): void => {});
        const loc = Locs.query().name(opts.name).action(opts.op).within(opts.within ?? 10).nearest();
        if (!loc) {
            return closeIn(opts.near, 2, log);
        }
        if (!Reachability.canReach(loc.tile(), { maxSteps: REACH_BFS_STEPS, adjacentOk: true })) {
            // In scene but blocked by a closed door/wall. WALK to the loc — the
            // hardened walker drives baked door-edges open and steps THROUGH
            // (the server op-walk halts at, and races the auto-reshut of, a
            // closed door). Re-query after: our position changed, so canReach is
            // now satisfiable and the OPLOC server-walks the final tiles.
            const walked = await Traversal.walkResilient(loc.tile(), { radius: 1, attempts: 3, timeoutMs: 90_000, log });
            if (!walked && WalkExecutor.lastOutcome === 'unreachable') {
                log(`reach: '${opts.name}' unreachable across the door`);
                return 'unreachable';
            }
            const near = Locs.query().name(opts.name).action(opts.op).within(opts.within ?? 10).nearest();
            if (!near) {
                return 'retry';
            }
            if (!(await near.interact(opts.op))) {
                return 'retry';
            }
            if (await Execution.delayUntil(opts.expect, opts.expectMs ?? 12_000)) {
                return 'done';
            }
            log(`reach: '${opts.op}' on '${opts.name}' did not produce the expected outcome — retrying`);
            return 'retry';
        }
        if (!(await loc.interact(opts.op))) {
            return 'retry';
        }
        if (await Execution.delayUntil(opts.expect, opts.expectMs ?? 12_000)) {
            return 'done';
        }
        log(`reach: '${opts.op}' on '${opts.name}' did not produce the expected outcome — retrying`);
        return 'retry';
    },

    /** Reach an NPC and get a Talk-to dialogue OPEN (driving it is the
     *  caller's job — talkThrough). Tracks patrols via the live query +
     *  server-walk. Re-entrant. */
    async npcDialog(opts: ReachNpcOpts): Promise<ReachStatus> {
        const log = opts.log ?? ((): void => {});
        if (ChatDialog.isOpen()) {
            return 'done';
        }
        const npc = Npcs.query().name(opts.name).action('Talk-to').nearest();
        if (!npc) {
            return closeIn(opts.near, 3, log);
        }
        let target = npc;
        if (!Reachability.canReach(npc.tile(), { maxSteps: REACH_BFS_STEPS, adjacentOk: true })) {
            // In scene but blocked by a closed door/wall. WALK to the NPC — the
            // hardened walker drives baked door-edges open and steps THROUGH;
            // tryNearbyDoor opened the leaf but only the racing server Talk-to
            // would cross it, and it loses to the door's auto-reshut (the L1
            // Traiborn stall, live 2026-07-19). Re-query after — the NPC may have
            // shifted and the pre-walk handle is stale.
            const walked = await Traversal.walkResilient(npc.tile(), { radius: 1, attempts: 3, timeoutMs: 90_000, log });
            if (!walked && WalkExecutor.lastOutcome === 'unreachable') {
                log(`reach: '${opts.name}' unreachable across the door`);
                return 'unreachable';
            }
            const requery = Npcs.query().name(opts.name).action('Talk-to').nearest();
            if (!requery) {
                return 'retry';
            }
            target = requery;
        }
        if (!(await target.interact('Talk-to'))) {
            return 'retry';
        }
        if (await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), opts.openMs ?? 15_000)) {
            return 'done';
        }
        log(`reach: '${opts.name}' never opened a dialogue — retrying`);
        return 'retry';
    }
};
