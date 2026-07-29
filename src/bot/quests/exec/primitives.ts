// docs/QUESTS.md#exec-primitives
import { EventSignal } from '../../api/EventSignal.js';
import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import { Reach } from '../../api/Reach.js';
import Tile from '../../api/Tile.js';
import { ChatDialog } from '../../api/hud/ChatDialog.js';
import { Locs } from '../../api/queries/Locs.js';
import { Npcs, talkOp, type Npc } from '../../api/queries/Npcs.js';
import { Traversal } from '../../api/Traversal.js';
import type { WorldTile } from '../../adapter/ClientAdapter.js';

export { talkOp };

export function pickPreferred(options: string[], prefer: string[]): string | null {
    for (const p of prefer) {
        const hit = options.find(o => o.toLowerCase().includes(p.toLowerCase()));
        if (hit) {
            return hit;
        }
    }
    return null;
}

export interface LineRule {
    /** Lower-case fragment of the NPC's spoken line. */
    whenLine: string;
    /** Option to choose when that fragment is present. */
    choose: string;
}

function flattenLines(lines: string[]): string {
    return lines.join(' ').replace(/@[a-z0-9]{3}@/gi, ' ').replace(/[|\s]+/g, ' ').trim().toLowerCase();
}

export function pickByLine(lines: string[], options: string[], rules: readonly LineRule[]): string | null {
    const said = flattenLines(lines);
    if (said.length === 0) {
        return null;
    }
    // Longest first: overlapping phrases like "cur tanath" and "ar cur" must not
    // let the shorter rule win on a line that contains both.
    const hit = [...rules]
        .sort((a, b) => b.whenLine.length - a.whenLine.length)
        .find(rule => said.includes(rule.whenLine.toLowerCase()));
    if (!hit) {
        return null;
    }
    return options.find(o => o.toLowerCase().includes(hit.choose.toLowerCase())) ?? null;
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

const DIALOGUE_OPEN_MS = 8000;

async function openDialogue(npcName: string, log: (m: string) => void): Promise<boolean> {
    const dialogReady = (): boolean => ChatDialog.isOpen() || ChatDialog.canContinue();
    if (dialogReady()) {
        return true;
    }
    const find = (): Npc | null => Npcs.query().name(npcName).where(n => talkOp(n.actions()) !== null).nearest();
    const npc = find();
    if (!npc) {
        log(`no '${npcName}' nearby to talk to`);
        return false;
    }
    // An NPC who wandered behind a shut door is in the scene and inside the leash,
    // yet unreachable — Reach opens the door rather than waiting out the talk.
    const status = await Reach.entityOp({
        find,
        op: talkOp(npc.actions())!,
        expect: dialogReady,
        openWhenUnreachable: true,
        expectMs: DIALOGUE_OPEN_MS,
        what: npcName,
        log
    });
    if (status !== 'done') {
        log(`'${npcName}' never opened a dialogue`);
        return false;
    }
    return true;
}

export async function talkThrough(npcName: string, prefer: string[], log: (m: string) => void): Promise<boolean> {
    if (!(await openDialogue(npcName, log))) {
        return false;
    }
    return driveDialog(prefer, log);
}

/**
 * Like `talkThrough`, but abandons the dialogue instead of guessing when no
 * preferred option matches. Use it wherever the unmatched option is harmful —
 * several ogres offer "I have come to kill you" as the alternative.
 * @see docs/QUESTS.md#exec-primitives
 */
export function talkStrict(npcName: string, prefer: string[], log: (m: string) => void): Promise<boolean> {
    return talkChoosingBy(npcName, [], prefer, log);
}

/**
 * Drive a dialogue whose correct option depends on what the NPC just said.
 * @see docs/QUESTS.md#exec-primitives
 */
export async function talkChoosingBy(
    npcName: string,
    rules: readonly LineRule[],
    prefer: string[],
    log: (m: string) => void
): Promise<boolean> {
    if (!(await openDialogue(npcName, log))) {
        return false;
    }
    let spoken: string[] = [];
    for (let i = 0; i < 120; i++) {
        if (EventSignal.pending()) {
            return false;
        }
        const opts = ChatDialog.options();
        // Capture the NPC's line only while no option list is up: the options page
        // is itself made of text components, and would otherwise overwrite the very
        // phrase the rules match against.
        if (opts.length === 0 && ChatDialog.isOpen()) {
            const texts = ChatDialog.texts();
            if (texts.length > 0) {
                spoken = texts;
            }
        }
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        if (opts.length > 0) {
            const pick = pickByLine(spoken, opts, rules) ?? pickPreferred(opts, prefer);
            if (!pick) {
                log(`no rule or preference matched [${opts.join(' | ')}] after "${spoken.join(' ')}"`);
                return false;
            }
            await ChatDialog.chooseOption(pick);
            await Execution.delayTicks(2);
            continue;
        }
        if (!ChatDialog.isOpen()) {
            break;
        }
        await Execution.delayTicks(1);
    }
    return !ChatDialog.isOpen();
}
