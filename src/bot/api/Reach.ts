// The shared LAST-MILE primitive: get to a loc/NPC and act on it, using each
// channel the way the real game does — client web-walk to get NEAR, the op's
// own SERVER-walk for the final tiles (it crosses furniture-tight interiors
// the client BFS refuses and tracks patrolling NPCs), with a door-open
// pre-step because the server op-walk HALTS at closed doors (live-verified:
// Traiborn). Replaces the per-quest interior-stand/OPLOC/open-the-leaf hacks.
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
            // a closed door likely separates us — the server op-walk halts at
            // closed doors, so open the nearest leaf first
            await WalkExecutor.tryNearbyDoor(log);
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
        if (!Reachability.canReach(npc.tile(), { maxSteps: REACH_BFS_STEPS, adjacentOk: true })) {
            await WalkExecutor.tryNearbyDoor(log);
        }
        if (!(await npc.interact('Talk-to'))) {
            return 'retry';
        }
        if (await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), opts.openMs ?? 15_000)) {
            return 'done';
        }
        log(`reach: '${opts.name}' never opened a dialogue — retrying`);
        return 'retry';
    }
};
