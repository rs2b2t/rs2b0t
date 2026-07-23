import { EventSignal } from '../../api/EventSignal.js';
import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import Tile from '../../api/Tile.js';
import { ChatDialog } from '../../api/hud/ChatDialog.js';
import { Locs } from '../../api/queries/Locs.js';
import { Npcs } from '../../api/queries/Npcs.js';
import { Traversal } from '../../api/Traversal.js';
import type { WorldTile } from '../../adapter/ClientAdapter.js';

export function pickPreferred(options: string[], prefer: string[]): string | null {
    for (const p of prefer) {
        const hit = options.find(o => o.toLowerCase().includes(p.toLowerCase()));
        if (hit) {
            return hit;
        }
    }
    return null;
}

export function talkOp(actions: string[]): string | null {
    return actions.find(a => /^talk/i.test(a)) ?? null;
}

export function isUnderground(t: { z: number }): boolean {
    return t.z >= 5000;
}

export function needsHop(here: { z: number }, anchor: { z: number }): boolean {
    return isUnderground(here) !== isUnderground(anchor);
}

export interface LadderHop {
    stand: Tile;
    locName: string;
    op: string;
    arrive: Tile;
    open?: string;
}

export interface NpcStop {
    npc: string;
    anchor: Tile;
    leash: number;
    prefer: string[];
    approach?: Tile[];
}

async function hopLadder(hop: LadderHop, log: (m: string) => void): Promise<boolean> {
    const find = (op: string) => Locs.query().name(hop.locName).action(op).where(l => l.tile().distanceTo(hop.stand) <= 3).nearest();
    let ladder = find(hop.op);
    if (!ladder && hop.open !== undefined) {
        const closed = find(hop.open);
        if (closed && (await closed.interact(hop.open))) {
            await Execution.delayTicks(2);
            ladder = find(hop.op);
            if (!ladder) {
                await Execution.delayTicks(2);
                ladder = find(hop.op);
            }
        }
    }
    if (!ladder) {
        log(`no '${hop.locName}' offering '${hop.op}' near (${hop.stand.x},${hop.stand.z})`);
        return false;
    }
    if (!(await ladder.interact(hop.op))) {
        return false;
    }
    return Execution.delayUntil(() => {
        const t = Game.tile();
        return t !== null && t.level === hop.arrive.level && hop.arrive.distanceTo(t) <= 5;
    }, 8000);
}

async function crossHops(here: WorldTile, dest: { z: number }, hops: LadderHop[], log: (m: string) => void): Promise<WorldTile | null> {
    if (!needsHop(here, dest)) {
        return here;
    }
    const near = hops.filter(h => isUnderground(h.stand) === isUnderground(here));
    const hop = near.sort((a, b) => a.stand.distanceTo(here) - b.stand.distanceTo(here))[0];
    if (!hop) {
        log(`no hop from (${here.x},${here.z}) toward z ${dest.z} — trying the baked graph`);
        return here;
    }
    if (hop.stand.distanceTo(here) > 2 && !(await Traversal.walkResilient(hop.stand, { radius: 2, attempts: 3, log }))) {
        return null;
    }
    if (!(await hopLadder(hop, log))) {
        return null;
    }
    return Game.tile();
}

export async function walkWithHops(dest: Tile, radius: number, hops: LadderHop[], log: (m: string) => void): Promise<boolean> {
    const start = Game.tile();
    if (!start) {
        return false;
    }
    const here = await crossHops(start, dest, hops, log);
    if (!here) {
        return false;
    }
    if (here.level !== dest.level || dest.distanceTo(here) > radius) {
        return Traversal.walkResilient(dest, { radius, attempts: 3, log });
    }
    return true;
}

export async function gotoNpc(stop: NpcStop, hops: LadderHop[], log: (m: string) => void): Promise<boolean> {
    let here = Game.tile();
    if (!here) {
        return false;
    }
    const npcNear = (): boolean => {
        const n = Npcs.query().name(stop.npc).nearest();
        return n !== null && n.distance() <= stop.leash;
    };
    const hopped = await crossHops(here, stop.anchor, hops, log);
    if (!hopped) {
        return false;
    }
    here = hopped;
    let approachFailed = false;
    for (const wp of stop.approach ?? []) {
        if (wp.distanceTo(here) > 2) {
            if (!(await Traversal.walkResilient(wp, { radius: 2, attempts: 2, timeoutMs: 45_000, log }))) {
                approachFailed = true;
                here = Game.tile() ?? here;
                break;
            }
            here = Game.tile() ?? here;
        }
    }
    if (!approachFailed && stop.anchor.distanceTo(here) > 1) {
        await Traversal.walkResilient(stop.anchor, { radius: 1, attempts: 2, timeoutMs: 45_000, log });
        here = Game.tile() ?? here;
    }
    if (isUnderground(here) && isUnderground(stop.anchor) && stop.anchor.distanceTo(here) > 2 && stop.anchor.distanceTo(here) <= 20) {
        const back = hops.find(h => isUnderground(h.stand) === isUnderground(here!));
        if (back) {
            log(`trapped landing at (${here.x},${here.z}) — could not reach anchor, climbing back to re-roll`);
            if (back.stand.distanceTo(here) > 1) {
                await Traversal.walkResilient(back.stand, { radius: 1, attempts: 3, log });
            }
            await hopLadder(back, log);
        }
        return false;
    }
    if (approachFailed) {
        return false;
    }
    return npcNear();
}

export async function driveDialog(prefer: string[], log: (m: string) => void): Promise<boolean> {
    for (let i = 0; i < 120; i++) {
        if (EventSignal.pending()) {
            return false;
        }
        if (!ChatDialog.isOpen() && !ChatDialog.canContinue()) {
            if (!(await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 1500))) {
                break;
            }
        }
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        const opts = ChatDialog.options();
        if (opts.length > 0) {
            const pick = pickPreferred(opts, prefer);
            if (!pick) {
                log(`WARN: no preferred option in [${opts.join(' | ')}] — taking the last`);
            }
            await ChatDialog.chooseOption(pick ?? opts[opts.length - 1]);
            await Execution.delayTicks(2);
            continue;
        }
        await Execution.delayTicks(1);
    }
    return !ChatDialog.isOpen();
}

export async function talkThrough(npcName: string, prefer: string[], log: (m: string) => void): Promise<boolean> {
    if (!ChatDialog.isOpen()) {
        const npc = Npcs.query().name(npcName).where(n => talkOp(n.actions()) !== null).nearest();
        if (!npc) {
            log(`no '${npcName}' nearby to talk to`);
            return false;
        }
        if (!(await npc.interact(talkOp(npc.actions())!))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => ChatDialog.isOpen(), 8000))) {
            log(`'${npcName}' never opened a dialogue`);
            return false;
        }
    }
    return driveDialog(prefer, log);
}
