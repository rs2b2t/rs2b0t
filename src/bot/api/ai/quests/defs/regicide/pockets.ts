import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Locs } from '../../../../locs/Locs.js';
import type { Loc } from '../../../../model/Loc.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { Traversal } from '../../../../walking/Traversal.js';
import Tile from '../../../../../geometry/Tile.js';
import { settleScene } from '../../exec/prompts.js';
import { REGICIDE_POCKETS, REGICIDE_SEAMS } from './seams.js';

export interface RegicideSeam {
    /** `forest` needs quest stage 8; `gate` southbound needs stage 13. The rest are always open. */
    kind: 'forest' | 'log' | 'pit' | 'trap' | 'gate';
    loc: string;
    locId: number;
    op: string;
    x: number;
    z: number;
    sides: readonly { pocket: string; stand: { x: number; z: number } }[];
// Why: Each pitfall or log loc works from one bank only; selecting the far side can stage the player inside the trap.

    /** True when this seam may only be taken from `sides[0]` toward `sides[1]`. */
    directed?: boolean;
}

/** One sealed pocket of Tirannwn, as `[z, xStart, xEnd]` runs. */
export interface RegicidePocket {
    name: string;
    spans: readonly (readonly number[])[];
}

/** The far side of the Arandar palisade: the rest of the map, which the navigator owns. */
export const ARDOUGNE = 'ardougne';

// Why: `%regicide_quest < ^regicide_spoken_tracker2` refuses every Dense forest with "You can see no way to get past this", and `arandar_gate` refuses southbound until the deed is reported.
export const FOREST_STAGE = 8;
export const GATE_STAGE = 13;

const byZ = new Map<number, { pocket: string; x0: number; x1: number }[]>();
for (const pocket of REGICIDE_POCKETS) {
    for (const [z, x0, x1] of pocket.spans) {
        const row = byZ.get(z) ?? [];
        row.push({ pocket: pocket.name, x0, x1 });
        byZ.set(z, row);
    }
}

/** Which pocket a Tirannwn tile sits in, or undefined for anything the palisade doesn't seal in. */
export function pocketAt(tile: { x: number; z: number; level: number } | null | undefined): string | undefined {
    if (!tile || tile.level !== 0) {
        return undefined;
    }
    return byZ.get(tile.z)?.find(span => tile.x >= span.x0 && tile.x <= span.x1)?.pocket;
}

export interface SeamLeg {
    seam: RegicideSeam;
    from: { pocket: string; stand: { x: number; z: number } };
    to: { pocket: string; stand: { x: number; z: number } };
}

function usable(seam: RegicideSeam, from: string, stage: number): boolean {
    if (seam.kind === 'forest') {
        return stage >= FOREST_STAGE;
    }
    // Why: the palisade opens northbound at any stage, `coordz(coord) < coordz(loc_coord)` being the only test on the way out, and southbound once Iorwerth has been told the deed is done.
    if (seam.kind === 'gate') {
        return from !== ARDOUGNE || stage >= GATE_STAGE;
    }
    return true;
}

/** The chain of crossings from one pocket to another, or null when the quest stage seals every route. */
export function planRoute(from: string, to: string, stage: number): SeamLeg[] | null {
    if (from === to) {
        return [];
    }
    const prev = new Map<string, SeamLeg>();
    const queue = [from];
    const seen = new Set([from]);
    while (queue.length > 0) {
        const at = queue.shift()!;
        if (at === to) {
            const legs: SeamLeg[] = [];
            for (let cursor = to; cursor !== from; ) {
                const leg = prev.get(cursor)!;
                legs.unshift(leg);
                cursor = leg.from.pocket;
            }
            return legs;
        }
        for (const seam of REGICIDE_SEAMS) {
            const here = seam.directed
                ? (seam.sides[0].pocket === at ? seam.sides[0] : undefined)
                : seam.sides.find(side => side.pocket === at);
            if (here === undefined || !usable(seam, at, stage)) {
                continue;
            }
            for (const other of seam.sides) {
                if (other.pocket === at || seen.has(other.pocket)) {
                    continue;
                }
                seen.add(other.pocket);
                prev.set(other.pocket, { seam, from: here, to: other });
                queue.push(other.pocket);
            }
        }
    }
    return null;
}

const CROSS_MS = 10_000;
const MAX_LEGS = 40;
// Why: the pitfall, the tripwire and the sticks all roll `stat_random(agility, ...)` and a fail leaves you where you were or in the pit below, so one send is one roll.
// Why: 8 because the sticks roll `stat_random(agility, 30, 155)`, under a coin flip even at 70, and a 4-try budget fails the leg outright about 1 run in 10.
const CROSS_TRIES = 8;
/** Walk to candidate crossing banks; unreachable candidates consume one timeout. */
const STAND_TRIES = 3;
const STAND_MS = 45_000;
// Why: a crossing's bank is metres away inside the same pocket, so the walk to it stays out of the transport graph; left open, the navigator answered a blocked gate stand with a ship to Karamja.
const LOCAL_WALK = { useTeleportCatalog: false, policy: { useTeleports: false } } as const;
/** Refused crossings tolerated across one journey before the destination is called unreachable. */
const CROSS_FAILS = 3;
/** `regicide_trap_hand_holds`, the way out of a spike pit. */
const HAND_HOLDS = 3927;

// Why: `pocketAt` returns undefined outside Tirannwn, while the graph calls that region ARDOUGNE; normalize them before checking arrival.
function standingIn(): string {
    return pocketAt(Game.tile()) ?? ARDOUGNE;
}

function seamLoc(seam: RegicideSeam): Loc | null {
    return Locs.query()
        .where(loc => loc.id === seam.locId && Math.abs(loc.tile().x - seam.x) <= 1 && Math.abs(loc.tile().z - seam.z) <= 1)
        .within(12)
        .nearest();
}

/**
 * Climb out of a spike pit, back to the forest floor beside it.
 * Why: a failed pitfall jump teleports you into mapsquare 36_150 with 15 damage and the protruding rocks are the only loc there, so every other leg reads "unreachable" until this has run.
 */
export async function climbOutOfPit(log: (m: string) => void): Promise<boolean> {
    const rocks = Locs.query().where(loc => loc.id === HAND_HOLDS).action('Climb').within(24).nearest();
    if (!rocks) {
        log('fell into a spike pit with no protruding rocks in reach');
        return false;
    }
    if (!(await rocks.interact('Climb'))) {
        return false;
    }
    const out = await Execution.delayUntil(() => (Game.tile()?.z ?? 9999) < 9000, CROSS_MS);
    if (out) {
        const now = Game.tile();
        log(`climbed out of the pit at (${now?.x},${now?.z})`);
    }
    return out;
}

/**
 * Cross one seam. True only once the pocket has changed.
 * Why: the op walks you before its script resolves and the pitfall's agility roll drops a failure into a spike pit, both of which look like movement, so the pocket is the only signal. `regicide_move_trap_woodspring` p_walks a failed sticks roll to a tile beside the loc, sometimes the far side of the barrier, so a failure spends an attempt inside the loop and keeps the crossing.
 */
async function crossSeam(leg: SeamLeg, log: (m: string) => void): Promise<boolean> {
    const stand = new Tile(leg.from.stand.x, leg.from.stand.z, 0);
    let walkFails = 0;
    for (let attempt = 0; attempt < CROSS_TRIES; attempt++) {
        if (standingIn() === leg.to.pocket) {
            return true;
        }
        if ((Game.tile()?.z ?? 0) > 9000 && !(await climbOutOfPit(log))) {
            return false;
        }
        // Why: a failed jump is 15 damage and a fall, the tripwires poison and the sticks hit for 8, so a crossing retried 8 times is a fight the walk between attempts can't pay for.
        await Sustain.run();
        if (!(await Traversal.walkResilient(stand, { radius: 1, attempts: 3, timeoutMs: STAND_MS, log, ...LOCAL_WALK }))) {
            // Why: bounded separately from the roll budget, because a walk that can't answer burns its full timeout every attempt while a failed roll costs a couple of ticks.
            if (++walkFails >= STAND_TRIES) {
                log(`could not stand at (${stand.x},${stand.z}) to take ${leg.seam.op} ${leg.seam.loc} after ${walkFails} tries`);
                return false;
            }
            log(`could not stand at (${stand.x},${stand.z}) — retrying from (${Game.tile()?.x},${Game.tile()?.z})`);
            continue;
        }
        await settleScene();
        const loc = seamLoc(leg.seam);
        if (!loc) {
            log(`no ${leg.seam.loc} at (${leg.seam.x},${leg.seam.z}) — retrying`);
            continue;
        }
        if (!(await loc.interact(leg.seam.op))) {
            continue;
        }
        if (await Execution.delayUntil(() => standingIn() === leg.to.pocket, CROSS_MS)) {
            const now = Game.tile();
            log(`${leg.seam.op} ${leg.seam.loc} → ${leg.to.pocket} (${now?.x},${now?.z})`);
            return true;
        }
        const now = Game.tile();
        log(`${leg.seam.op} ${leg.seam.loc} @(${leg.seam.x},${leg.seam.z}) left us at (${now?.x},${now?.z}) — retrying`);
    }
    log(`${CROSS_TRIES} tries at ${leg.seam.op} ${leg.seam.loc} without reaching ${leg.to.pocket}`);
    return false;
}

/**
 * Walk to `dest`, crossing whatever seals its pocket off from this one.
 * Why: a component report over the quest's anchors fails every pair inside Tirannwn, so a plain `walkResilient` reports "unreachable" for anything past a crossing. Inside one pocket the navigator is still the right tool, so each round tries it.
 */
export async function travelTirannwn(dest: Tile, radius: number, stage: number, log: (m: string) => void): Promise<boolean> {
    let crossFails = 0;
    for (let hop = 0; hop < MAX_LEGS; hop++) {
        const here = Game.tile();
        if (here && here.level === dest.level && dest.distanceTo(here) <= radius) {
            return true;
        }
        if ((here?.z ?? 0) > 9000 && !(await climbOutOfPit(log))) {
            return false;
        }
        const from = pocketAt(Game.tile()) ?? ARDOUGNE;
        const to = pocketAt(dest) ?? ARDOUGNE;
        if (from === to) {
            return Traversal.walkResilient(dest, { radius, attempts: 3, timeoutMs: 180_000, log });
        }
        const route = planRoute(from, to, stage);
        if (route === null || route.length === 0) {
            // Why: the seam graph is derived from the collision pack and the pathfinder's edges, so it's the conservative half of what the live walker can do and can't see a door the derivation had no reason to trust. Where it has no chain, ask the navigator before giving up.
            log(`no crossing chain from ${from} to ${to} at stage ${stage} — asking the navigator`);
            return Traversal.walkResilient(dest, { radius, attempts: 2, timeoutMs: 180_000, log });
        }
        if (!(await crossSeam(route[0], log))) {
            // Why: a trap that refused the crossing has usually moved you, sometimes into a different pocket, so the next round replans from the new tile, where the leg's route may still be open.
            if (++crossFails >= CROSS_FAILS) {
                log(`${crossFails} crossings refused on the way to (${dest.x},${dest.z}) — giving up`);
                return false;
            }
            log(`crossing ${route[0].seam.loc} refused — replanning from ${pocketAt(Game.tile()) ?? ARDOUGNE}`);
        }
    }
    log(`${MAX_LEGS} crossings without reaching (${dest.x},${dest.z})`);
    return false;
}
