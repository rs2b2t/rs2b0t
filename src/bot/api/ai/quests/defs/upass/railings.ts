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

// Why: The six-crossing route is fixed; a free search also sees inaccessible ledges, tunnels, bridges, and cages.

/** One crossing of the run: walk the stand, send the op at that loc, arrive on `lands`. */
export interface Crossing {
    what: string;
    /** Stepping stones walked before the stand, where one walk will not carry it. */
    via?: readonly Tile[];
    /** The tile the op is sent from. */
    stand: Tile;
    /** The loc's own tile; a row of identical locs can't be picked by `nearest()`. */
    at: Tile;
    loc: number;
    op: string;
    /** Where the crossing lands you, and the guard that says it has already happened. */
    lands: Tile;
    /** The item to use on the loc, where the crossing is a use. */
    item?: { id: number; name: string };
}

// Why: Two ledges tie at distance one, so preserve the exact loc tile instead of using `nearest()`.
// Why: Regicide reuses this chain from the well corridor; the mud loc itself has no routable pocket.
export const OUT_OF_CAGES: readonly Crossing[] = [
    // Why: the run starts in the corridor where the well drops you. The cage and the dig are the first 2 crossings of the chain, and left to a search a leg stands in the corridor trying to reach a ledge 2 crossings away.
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

// Why: Step identity uses the name, so include the crossing index to reset attempts after each successful crossing.
// Why: the client's flood, because `decide` is synchronous. Out of the loaded scene reads unreachable, same as "not crossed yet", so the outstanding crossing is the first whose landing can't be reached and whose stand can.
export function outstandingCrossing(chain: readonly Crossing[] = TO_RAILINGS): Crossing | null {
    const flood = { adjacentOk: false, maxSteps: 2_000 } as const;
    return chain.find(step =>
        !Reachability.canReach(step.lands, flood) && Reachability.canReach(step.stand, flood)) ?? null;
}

/** Take one crossing, the one you're in position for. */
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
/** What a silent op gets; 3 ticks covers a teleport end to end. */
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
    // Why: by its own tile: both (2374,9644) and (2374,9643) are 1 tile from the stand and only the first can be crossed from there.
    const named = Locs.query()
        .where(l => l.id === step.loc && l.tile().x === step.at.x && l.tile().z === step.at.z);
    const loc = (step.item === undefined ? named.action(step.op) : named).nearest();
    if (!loc) {
        log(`pass: ${step.loc} is not at (${step.at.x},${step.at.z}) from (${Game.tile()?.x},${Game.tile()?.z})`);
        return false;
    }
    const mark = GameMessages.mark();
    // Why: `[oplocu,upass_mud]` carries no op the client can send. The crossing is a spade used on it.
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
 * Why: a step whose landing you can already walk to has happened, so the run resumes from wherever it is; the 6 crossings are one-way and in one order.
 */
export async function reachLooseRailings(log: (m: string) => void): Promise<boolean> {
    // Why: a run that doesn't apply from here says so once. The outstanding step is the first whose landing can't be walked to, and if its stand can't be either you're off the chain, past its far end from the unicorn area.
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
