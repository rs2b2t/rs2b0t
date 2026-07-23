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

async function closeIn(near: WorldTile, radius: number, log: (m: string) => void): Promise<ReachStatus> {
    const ok = await Traversal.walkResilient(near, { radius, attempts: 4, timeoutMs: 90_000, log });
    if (!ok && WalkExecutor.lastOutcome === 'unreachable') {
        log(`reach: hint (${near.x},${near.z},${near.level}) is unreachable`);
        return 'unreachable';
    }
    return 'retry';
}

const REACH_DOOR_ATTEMPTS = 8;

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
        await Traversal.walkResilient(t, { radius: 1, attempts: 3, timeoutMs: 30_000, log });
    }
    const shut = Locs.query().where(l => l.tile().x === t.x && l.tile().z === t.z && isOpenableBarrier(l.name, l.actions())).nearest();
    if (!shut) { return true; }
    const op = openOp(shut.actions());
    if (!op) { return false; }
    log(`reach: server said 'can't reach' — opening blocking '${shut.name}' at (${t.x},${t.z})`);
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
    log: (m: string) => void
): Promise<ReachStatus> {
    for (let i = 0; i < REACH_DOOR_ATTEMPTS; i++) {
        const mark = GameMessages.mark();
        if (await attempt()) {
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
        await Execution.delayTicks(1);
    }
    return 'retry';
}

export const Reach = {
    async locOp(opts: ReachLocOpts): Promise<ReachStatus> {
        const log = opts.log ?? ((): void => {});
        const find = () => Locs.query().name(opts.name).action(opts.op).within(opts.within ?? 10).nearest();
        if (!find()) {
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
            log
        );
    }
};
