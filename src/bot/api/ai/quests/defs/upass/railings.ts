import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Navigator } from '../../../../../event/webwalk/Navigator.js';
import { Reachability } from '../../../../../event/webwalk/geometry/Reachability.js';
import { Traversal } from '../../../../walking/Traversal.js';
import Tile from '../../../../../geometry/Tile.js';
import { settleScene } from '../../exec/prompts.js';
import { UP_ITEM, UP_LOC } from './areas.js';
import { verdictSince } from './verdict.js';

// Why: the way from the well's corridor down to the loose railings is six crossings and it never varies. A search over it offered five ledge locs whose stand is in another pocket, two telejumps twenty-one tiles the wrong way, seven walled stone bridges and ten cages in another cell — and reported a cage thirty tiles off as crossed. Spelled out, there is nothing to choose.

/** One crossing of the run: walk the stand, send the op at THAT loc, arrive on `lands`. */
export interface Crossing {
    what: string;
    /** Stepping stones walked before the stand, where one walk will not carry it. */
    via?: readonly Tile[];
    /** The tile the op is sent from. */
    stand: Tile;
    /** The loc's OWN tile. A seam that is a row of identical locs cannot be picked by `nearest()`. */
    at: Tile;
    loc: number;
    op: string;
    /** Where the crossing puts the character — and the guard that says it has already happened. */
    lands: Tile;
    /** The item to use on the loc, where the crossing is a use rather than an op. */
    item?: { id: number; name: string };
}

// Why: `at` is carried because the ledge is six locs in a column and the two nearest the stand are BOTH chebyshev one from it — `nearest()` picks whichever, and the wrong one answers "I can't reach that!" without the script ever running.
// Why: the cage, the dig and the ledge are their own chain because Regicide walks them too — it re-enters the pass westbound with the quest finished, and the well drops it in the same corridor. Aiming a mover at the dig's own tile instead is what sent a leg back up through the thieving railings for twenty-four hops: (2393,9650) carries the loc, so live it routes to nothing and the free search takes over.
export const OUT_OF_CAGES: readonly Crossing[] = [
    // Why: the run starts in the CORRIDOR, where the well drops the character — not in the mud pocket. The cage and the dig are the first two crossings of the same chain, and leaving them to a search is what had a leg standing in the corridor trying to reach a ledge two crossings away, a hundred and five times over.
    {
        what: 'the cage into the mud cell',
        stand: new Tile(2393, 9655, 0), at: new Tile(2393, 9655, 0),
        loc: UP_LOC.RAILINGS_LOCKED, op: 'Pick-lock', lands: new Tile(2393, 9654, 0)
    },
    {
        what: 'the spade dig south out of the cells',
        stand: new Tile(2393, 9651, 0), at: new Tile(2393, 9650, 0),
        loc: UP_LOC.MUD_DIG, op: 'Dig', item: UP_ITEM.SPADE, lands: new Tile(2392, 9646, 0)
    },
    {
        what: 'the ledge south out of the mud pocket',
        stand: new Tile(2375, 9644, 0), at: new Tile(2374, 9644, 0),
        loc: UP_LOC.LEDGE, op: 'Cross', lands: new Tile(2374, 9638, 0)
    }
];

export const TO_RAILINGS: readonly Crossing[] = [
    ...OUT_OF_CAGES,
    {
        what: 'the first thieving railing',
        stand: new Tile(2380, 9619, 0), at: new Tile(2380, 9619, 0),
        loc: UP_LOC.RAILINGS_HARD, op: 'Pick-lock', lands: new Tile(2381, 9619, 0)
    },
    {
        what: 'the second thieving railing',
        stand: new Tile(2403, 9620, 0), at: new Tile(2404, 9620, 0),
        loc: UP_LOC.RAILINGS_HARD, op: 'Pick-lock', lands: new Tile(2404, 9620, 0)
    },
    {
        what: 'the pipe into the loose railings',
        via: [new Tile(2420, 9617, 0)],
        stand: new Tile(2419, 9605, 0), at: new Tile(2417, 9605, 0),
        loc: UP_LOC.PIPE_AREA2, op: 'Squeeze-through', lands: new Tile(2412, 9605, 0)
    }
];

// Why: the engine re-decides every tick and recognises "the same step" only by what it calls itself, so a step whose name covers six crossings is one step retried forever — the attempt counter never resets, no progress is visible, and the watchdog parks a leg that was advancing. Each crossing names itself, so crossing one resets the count for crossing two.
// Why: the client's own flood, because `decide` is synchronous. Out of the loaded scene it reads unreachable, which is indistinguishable from "not crossed yet" — so the outstanding crossing is the first whose landing cannot be reached AND whose stand can. That is the one the character is standing in position for.
export function outstandingCrossing(chain: readonly Crossing[] = TO_RAILINGS): Crossing | null {
    const flood = { adjacentOk: false, maxSteps: 2_000 } as const;
    return chain.find(step =>
        !Reachability.canReach(step.lands, flood) && Reachability.canReach(step.stand, flood)) ?? null;
}

/** Take one crossing and no more — the one the character is in position for. */
export async function takeNextCrossing(log: (m: string) => void, chain: readonly Crossing[] = TO_RAILINGS): Promise<boolean> {
    const step = outstandingCrossing(chain);
    if (step === null) {
        const me = Game.tile();
        log(`pass: (${me?.x},${me?.z}) is in position for no crossing of the run`);
        return false;
    }
    return take(step, log);
}

/** How long a crossing gets to land once its script has spoken. */
const CROSS_MS = 12_000;
/** What a silent op gets — three ticks covers a teleport end to end. */
const QUIET_MS = 1_800;

async function canWalkTo(to: Tile): Promise<boolean> {
    const me = Game.tile();
    return me !== null && (await Navigator.findPath(me, to, { policy: { useTeleports: false } })).ok;
}

async function take(step: Crossing, log: (m: string) => void): Promise<boolean> {
    for (const stone of step.via ?? []) {
        await Traversal.walkResilient(stone, { radius: 2, attempts: 1, timeoutMs: 30_000 });
    }
    if (!(await Traversal.walkResilient(step.stand, { radius: 0, attempts: 2, timeoutMs: 30_000 }))) {
        log(`pass: could not stand on (${step.stand.x},${step.stand.z}) for ${step.what}`);
        return false;
    }
    // Why: by its own tile, not by `nearest()`. Both (2374,9644) and (2374,9643) are one tile from the
    // stand, and only the first of them can be crossed from there.
    const named = Locs.query()
        .where(l => l.id === step.loc && l.tile().x === step.at.x && l.tile().z === step.at.z);
    const loc = (step.item === undefined ? named.action(step.op) : named).nearest();
    if (!loc) {
        log(`pass: ${step.loc} is not at (${step.at.x},${step.at.z}) from (${Game.tile()?.x},${Game.tile()?.z})`);
        return false;
    }
    const mark = GameMessages.mark();
    // Why: `[oplocu,upass_mud]` carries no op the client can send — the crossing is a spade used on it.
    const sent = step.item === undefined
        ? await loc.interact(step.op)
        : await (Inventory.items().find(inv => inv.id === step.item!.id)?.useOn(loc) ?? false);
    if (!sent) {
        log(`pass: ${step.item ? `the ${step.item.name}` : `'${step.op}'`} would not send at ${step.what}`);
        return false;
    }
    await Execution.delayUntil(() => verdictSince(mark) !== null, QUIET_MS);
    const said = verdictSince(mark);
    if (said === 'refused') {
        log(`pass: ${step.what} refused — ${GameMessages.since(mark).map(m => m.text).slice(-2).join(' / ')}`);
        return false;
    }
    await Execution.delayUntil(() => {
        const t = Game.tile();
        return t !== null && t.x === step.lands.x && t.z === step.lands.z;
    }, said === 'crossing' ? CROSS_MS : QUIET_MS);
    await settleScene();
    const now = Game.tile();
    const done = await canWalkTo(step.lands);
    log(`pass: ${step.what} → (${now?.x},${now?.z})${done ? '' : ' — but it did not land'}`
        + (said === null ? '' : ` [${said}]`));
    return done;
}

/**
 * Walk the cage corridor down to the loose railings, one named crossing at a time.
 * Why: a step whose landing the character can already walk to has happened, so the run resumes from wherever it is rather than tracking an index — the six crossings are one-way and in one order.
 */
export async function reachLooseRailings(log: (m: string) => void): Promise<boolean> {
    // Why: a run that does not apply from here says so once. The outstanding step is the first whose landing cannot be walked to, and if its stand cannot be walked to either then the character is off the chain entirely — from the unicorn area, past its far end. Walking at it anyway is seventy-three rounds of `could not stand`, twenty-eight minutes, and no way for the caller to learn anything.
    const outstanding: Crossing[] = [];
    for (const step of TO_RAILINGS) {
        if (!(await canWalkTo(step.lands))) {
            outstanding.push(step);
        }
    }
    const next = outstanding[0];
    if (next && !(await canWalkTo(next.stand))) {
        const me = Game.tile();
        log(`pass: (${me?.x},${me?.z}) is not on the run to the loose railings —`
            + ` ${outstanding.length} crossing(s) outstanding and (${next.stand.x},${next.stand.z}) for ${next.what} is not walkable from here`);
        return false;
    }
    for (let round = 0; round < 3; round++) {
        let outstanding = 0;
        for (const step of TO_RAILINGS) {
            if (await canWalkTo(step.lands)) {
                continue;
            }
            outstanding++;
            if (!(await take(step, log))) {
                break;
            }
        }
        if (outstanding === 0) {
            return true;
        }
    }
    const last = TO_RAILINGS[TO_RAILINGS.length - 1]!;
    return canWalkTo(last.lands);
}
