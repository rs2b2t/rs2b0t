import { EventSignal } from '../../api/EventSignal.js';
import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import Tile from '../../api/Tile.js';
import { ChatDialog } from '../../api/hud/ChatDialog.js';
import { Locs } from '../../api/queries/Locs.js';
import { Npcs } from '../../api/queries/Npcs.js';
import { Traversal } from '../../api/Traversal.js';
import type { WorldTile } from '../../adapter/ClientAdapter.js';

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
    /** Staged walk targets on the way to `anchor`, walked in order (radius 2)
     *  before the anchor leg. Needed for horseshoe rooms: the 2004 client's
     *  ground-click fallback walks to the reachable tile NEAREST the click, so
     *  when every tile along the only route is FARTHER from the target than
     *  the start (wizard-tower basement: landing → east → south corridor →
     *  west through the door to Sedridor), clicks are no-ops and the walker
     *  freezes at the ladder (probe-verified live: 9s of clicks, zero
     *  movement). A waypoint at the corridor mouth is a plain reachable dest
     *  the client paths happily; the door crossing then starts from the right
     *  side of the horseshoe. */
    approach?: Tile[];
}

/**
 * Interact the hop's loc and wait until we land at (or beside) the scripted
 * far-side tile. Distance-to-arrive is the success test — NOT a level
 * change: underground hops keep level 0 and move z by ±6400, so `arrive`
 * (from the engine's ladders.rs2) is the only reliable signal for both
 * directions.
 */
async function hopLadder(hop: LadderHop, log: (m: string) => void): Promise<boolean> {
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
 * Shared hop core for gotoNpc and walkWithHops: when `here`/`dest` straddle the
 * surface/underground boundary, walk to the nearest same-side hop and cross it.
 * Returns the post-hop tile (or `here` unchanged when no hop is needed); null on
 * any failure (no reachable hop, failed walk to the stand, failed climb, no tile
 * after landing). Factored verbatim out of gotoNpc's old inline hop block so
 * gotoNpc's control flow — and its tests — are unchanged, while walkWithHops
 * reuses the exact same crossing.
 */
async function crossHops(here: WorldTile, dest: { z: number }, hops: LadderHop[], log: (m: string) => void): Promise<WorldTile | null> {
    if (!needsHop(here, dest)) {
        return here;
    }
    const near = hops.filter(h => isUnderground(h.stand) === isUnderground(here));
    const hop = near.sort((a, b) => a.stand.distanceTo(here) - b.stand.distanceTo(here))[0];
    if (!hop) {
        // No usable hop supplied — clue talk steps pass none, and a quest list
        // can be one-sided. The baked graph carries stair/dungeon edges of its
        // own (handleTransport crosses them), so proceed and let the caller's
        // walkResilient route the boundary; if the graph has no edge either,
        // that walk fails honestly. Hard-failing here starved graph-reachable
        // underground anchors (live: Brimstail's cave, the "no hop from ...
        // toward z 9810" loop).
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

/**
 * Cross the surface/underground boundary via the nearest hop when needed, then
 * web-walk to `dest` (radius `radius`). The public point-to-point walker for
 * custom quest steps that move between fixed tiles (e.g. graveyard ↔ basement),
 * sharing gotoNpc's hop crossing but without its NPC-anchor staged-approach and
 * trapped-landing machinery. Returns true once within `radius` of `dest`.
 */
export async function walkWithHops(dest: Tile, radius: number, hops: LadderHop[], log: (m: string) => void): Promise<boolean> {
    const start = Game.tile();
    if (!start) {
        return false;
    }
    const here = await crossHops(start, dest, hops, log);
    if (!here) {
        return false;
    }
    if (dest.distanceTo(here) > radius) {
        return Traversal.walkResilient(dest, { radius, attempts: 3, log });
    }
    return true;
}

/**
 * Web-walk to the stop's `anchor` (a probe-verified walkable tile beside the
 * NPC's spawn), taking a region-crossing hop first when here/anchor straddle
 * the surface/underground boundary, then re-check the leash — NPCs wander, and
 * talkThrough re-finds them from the anchor.
 *
 * The final approach lands RIGHT ON the anchor (radius 1), NOT merely "within
 * leash". Two reasons, both found live in the Task 6 smoke:
 *   - A loose arrival (the old radius 3) can halt the bot on the wrong side of
 *     a wall from a wandering NPC — e.g. the cramped wizard-tower basement,
 *     where stopping ~6 tiles short of Sedridor left the client's Talk-to
 *     auto-walk unable to path to him: "'Sedridor' never opened a dialogue",
 *     retried forever. The A* walk routes around the wall to the anchor; only
 *     the loose radius made it stop early.
 *   - There is deliberately no "already within leash, skip the walk"
 *     short-circuit: leash (up to 8) is far wider than talk range, so returning
 *     true from wherever we happen to stand let a failed talk re-loop from the
 *     same unreachable spot indefinitely. Re-centring on the anchor every call
 *     makes a failed talk self-heal on the next loop instead.
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
    const hopped = await crossHops(here, stop.anchor, hops, log);
    if (!hopped) {
        return false;
    }
    here = hopped;
    // Staged approach: walk each waypoint in order before the anchor leg, so a
    // horseshoe route is broken into segments the client can path (see
    // NpcStop.approach). No "already past it" shortcut — straight-line distance
    // is exactly what a horseshoe breaks (the landing is CLOSER to the anchor
    // than the waypoint is), and the npcNear() check above already skips all
    // walking once we're in the chamber with the NPC. A failed leg must NOT
    // return yet: it has to fall through to the trapped-landing recovery below
    // (live 2026-07-12 21:49: a pocket landing froze the corridor-mouth leg at
    // (3107,9575) with 0 clicks, and an early return here looped the bot on
    // that walk forever instead of climbing out).
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
        // Bounded attempts so a dead-end landing (handled next) is diagnosed in
        // ~1 min, not the default 3x90s. On a good landing the short chamber
        // approach finishes well inside one attempt.
        await Traversal.walkResilient(stop.anchor, { radius: 1, attempts: 2, timeoutMs: 45_000, log });
        here = Game.tile() ?? here;
    }
    // Trapped-landing recovery. The wizard-tower ladder occasionally drops you on
    // a dead-end basement tile the baked pack thinks reaches Sedridor but the
    // live scene walls off — the walker makes 0 clicks and never arrives (the
    // Task 6 notes-leg freeze at (3104,9575); the 2026-07-12 21:49 approach-leg
    // freeze at (3107,9575)). Signature: still underground and NOT at the
    // (nearby) anchor after trying to walk — it guards the approach legs above as
    // much as the anchor leg. Climb back up and return so the caller re-descends;
    // the re-descent lands on a reachable tile from which the next approach
    // completes. Proximity-gated so the far-anchor Aubury climb-up (a surface
    // hop AWAY from its anchor) never trips it.
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
    // A failed approach outside the trapped signature stays a failure: the
    // leash (up to 8) can see the NPC across the very wall that blocked the
    // walk, and a true here would send talkThrough into the "never opened a
    // dialogue" retry loop the radius-1 anchor rule exists to prevent.
    if (approachFailed) {
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
    // Drive the dialogue, TOLERATING page-transition gaps: a server-scripted
    // branch closes the box for a beat BETWEEN pages, and a plain isOpen() loop
    // exits there — BEFORE mid-branch varp-sets (sir_lancelot.rs2:34 is line 4
    // of a 6-line branch), so a correct option pick silently failed to advance
    // the stage (live 2026-07-19). A transient close now waits ~1.5s for the
    // next page before concluding the dialogue is genuinely over.
    for (let i = 0; i < 120; i++) {
        if (EventSignal.pending()) {
            return false; // let the runtime clear the random event
        }
        if (!ChatDialog.isOpen() && !ChatDialog.canContinue()) {
            if (!(await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 1500))) {
                break; // genuinely closed
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
