import { EventSignal } from '../../api/EventSignal.js';
import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import Tile from '../../api/Tile.js';
import { ChatDialog } from '../../api/hud/ChatDialog.js';
import { Locs } from '../../api/queries/Locs.js';
import { Npcs } from '../../api/queries/Npcs.js';
import { Traversal } from '../../api/Traversal.js';

// Quest-executor primitives (first consumer: RuneMysteries). Pure helpers
// here; the I/O walkers/talkers are added alongside them (gotoNpc,
// talkThrough, hopLadder) and stay thin so all decision logic is testable.

/**
 * First `prefer` entry that case-insensitively substring-matches one of
 * `options`, returned as the FULL option text (ChatDialog.chooseOption wants
 * the visible label). Null when nothing matches — the caller decides the
 * fallback and warns, because a fallback firing means the dialogue drifted
 * from the .rs2 sources the prefer list was written against. Pure.
 */
export function pickPreferred(options: string[], prefer: string[]): string | null {
    for (const p of prefer) {
        const hit = options.find(o => o.toLowerCase().includes(p.toLowerCase()));
        if (hit) {
            return hit;
        }
    }
    return null;
}

/** Underground mapsquares are the surface z + 6400 (wizard basement 3162 →
 *  9562-region). Surface z tops out ~4100, so 5000 splits cleanly. Pure. */
export function isUnderground(t: { z: number }): boolean {
    return t.z >= 5000;
}

/** A ladder hop is needed when here/anchor disagree about undergroundness —
 *  the A* graph doesn't span the boundary (no baked edge; the 2D heuristic
 *  can't cross the +6400 offset usefully). Pure. */
export function needsHop(here: { z: number }, anchor: { z: number }): boolean {
    return isUnderground(here) !== isUnderground(anchor);
}

/** A scripted ladder/stair crossing the nav graph doesn't know. `stand` is a
 *  pack-walkable tile beside the loc on the NEAR side; `arrive` the scripted
 *  far-side landing (from the engine's ladders.rs2). */
export interface LadderHop {
    stand: Tile;
    locName: string;
    op: string;
    arrive: Tile;
}

/** Where a quest NPC lives and how to talk to it. `prefer` are the dialogue
 *  options to pick, in priority order, verbatim from the quest .rs2. */
export interface NpcStop {
    npc: string;
    anchor: Tile;
    leash: number;
    prefer: string[];
}

/**
 * Interact the hop's loc and wait until we land at (or beside) the scripted
 * far-side tile. Distance-to-arrive is the success test — NOT a level
 * change: underground hops keep level 0 and move z by ±6400, so `arrive`
 * (from the engine's ladders.rs2) is the only reliable signal for both
 * directions.
 */
export async function hopLadder(hop: LadderHop, log: (m: string) => void): Promise<boolean> {
    const ladder = Locs.query().name(hop.locName).action(hop.op).where(l => l.tile().distanceTo(hop.stand) <= 3).nearest();
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

/**
 * Web-walk until the stop's NPC is within its leash. Takes a region-crossing
 * hop first when here/anchor straddle the surface/underground boundary. The
 * final approach targets `anchor` (a probe-verified walkable tile near the
 * spawn), then re-checks the leash — NPCs wander, talkThrough re-finds them.
 */
export async function gotoNpc(stop: NpcStop, hops: LadderHop[], log: (m: string) => void): Promise<boolean> {
    let here = Game.tile();
    if (!here) {
        return false;
    }
    const npcNear = (): boolean => {
        const n = Npcs.query().name(stop.npc).nearest();
        return n !== null && n.distance() <= stop.leash;
    };
    if (npcNear()) {
        return true;
    }
    if (needsHop(here, stop.anchor)) {
        const near = hops.filter(h => isUnderground(h.stand) === isUnderground(here!));
        const hop = near.sort((a, b) => a.stand.distanceTo(here!) - b.stand.distanceTo(here!))[0];
        if (!hop) {
            log(`no hop from (${here.x},${here.z}) toward (${stop.anchor.x},${stop.anchor.z})`);
            return false;
        }
        if (hop.stand.distanceTo(here) > 2 && !(await Traversal.walkResilient(hop.stand, { radius: 2, log }))) {
            return false;
        }
        if (!(await hopLadder(hop, log))) {
            return false;
        }
        here = Game.tile();
        if (!here) {
            return false;
        }
    }
    if (stop.anchor.distanceTo(here) > 3 && !(await Traversal.walkResilient(stop.anchor, { radius: 3, log }))) {
        return false;
    }
    return npcNear();
}

/**
 * Talk-to `npcName` and drive the whole conversation: continue through
 * pages, pick preferred options (fallback = LAST option + a warning — the
 * last option is the safe decline everywhere in this era's dialogues).
 * If a dialogue is already open (relog mid-talk, stray page), drives it
 * without re-interacting. Returns true once the dialog is closed.
 */
export async function talkThrough(npcName: string, prefer: string[], log: (m: string) => void): Promise<boolean> {
    if (!ChatDialog.isOpen()) {
        const npc = Npcs.query().name(npcName).action('Talk-to').nearest();
        if (!npc) {
            log(`no '${npcName}' nearby to talk to`);
            return false;
        }
        if (!(await npc.interact('Talk-to'))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => ChatDialog.isOpen(), 8000))) {
            log(`'${npcName}' never opened a dialogue`);
            return false;
        }
    }
    // The final Sedridor conversation is ~40 continue-pages; 120 iterations
    // bounds a stuck dialogue without cutting a long legitimate one short.
    for (let i = 0; i < 120 && ChatDialog.isOpen(); i++) {
        if (EventSignal.pending()) {
            return false; // let the runtime clear the random event
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
            await Execution.delayTicks(1);
            continue;
        }
        await Execution.delayTicks(1);
    }
    return !ChatDialog.isOpen();
}
