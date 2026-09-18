import { CANT_REACH, GameMessages } from '../../../../chatbox/gameMessages.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import type { Loc } from '../../../../model/Loc.js';
import { Navigator } from '../../../../../event/webwalk/Navigator.js';
import { Reachability } from '../../../../../event/webwalk/geometry/Reachability.js';
import { Traversal } from '../../../../walking/Traversal.js';
import Tile from '../../../../../geometry/Tile.js';
import { settleScene } from '../../exec/prompts.js';
import { type SpentSides, type Stand, spendFrom, spentHere, spentStateHere } from './spent.js';
import { MUD_CAGE, doorStands, mudCellDoor } from './doors.js';
import { orderSeams } from './rank.js';
import { crossOnce } from './cross.js';
import { bySideThatLands } from './stand.js';
import { verdictSince } from './verdict.js';
import { CAVERN_LINKS, PLATFORM_LINKS, type PlatformLink, UP_ITEM, UP_LOC, type UpassItem } from './areas.js';

// Why: every seam is a scripted obstacle on a tile the collision pack marks blocked, so `walkResilient` past one reports "unreachable" (a component report over the seam endpoints fails 10 of 14 anchors). Movement here is walk the pocket, cross one obstacle, repeat.
// Why: The pass has 16 measured pockets separated by scripted crossings; only the main level-1 landing reaches both wall tunnels on foot.

/** An obstacle joining 2 pockets. Each moves you across a tile the pack calls blocked. */
interface HopKind {
    loc: number;
    op: string;
    /** Op sends before giving up on this obstacle. */
    tries?: number;
    /** Only a seam below this z; the same loc is scenery elsewhere in the pass. */
    below?: number;
    /** Only offer this loc when the journey wants where it leads; `at` is the loc's own tile. */
    when?: (dest: Tile, from: { x: number; z: number; level: number }, at: Tile) => boolean;
    /** Every tile this loc can land you on, for a crossing whose far side is nowhere near it. */
    landing?: (at: Tile) => readonly Tile[];
    /** Locs of this kind within this many tiles spend as one seam. */
    group?: number;
    /** The only tiles this loc can be operated from, best first. A ring of neighbours can't find them. */
    stands?: (at: Tile) => readonly Tile[];
}

/** The first cavern is everything at or above this z; the second is everything below it. */

// Why: the 2 locked cages roll `stat_random(thieving, ...)` and a fail leaves you where you were, so one send is one roll.
const LOCK_TRIES = 5;
// Why: the rockslide, ledge, stone bridges and collapsed bridge each roll agility and drop you short on a fail (the ledge into a rat pit for 5), so one roll can't spend the obstacle.
const ROLL_TRIES = 4;

// Why: Tunnel doors teleport by angle to distant landings, so rank them by landing rather than door position.
const TUNNEL_TO_RAILINGS = new Tile(2401, 9610, 0);
const TUNNEL_TO_UNICORN = new Tile(2376, 9610, 0);
const TUNNEL_TO_FIRST_CAVERN = new Tile(2371, 9666, 0);
// Why: `@upass_area_2_3_entrance` picks one of 3 ends on the door's angle and on `%upass >= ^upass_killed_unicorn`, which the journal can't report because stages 3 and 4 print the same page. So a door is worth its best end, and the crossing test says where it landed.
const TUNNEL_ENDS: readonly Tile[] = [TUNNEL_TO_FIRST_CAVERN, TUNNEL_TO_RAILINGS, TUNNEL_TO_UNICORN];
const tunnelLanding = (): readonly Tile[] => TUNNEL_ENDS;

// Why: Only the cage at (2393,9655) reaches the southbound mud; from inside a cell, select its own door back to the corridor.
const inCageCorridor = (): boolean =>
    Reachability.canReach(MUD_CAGE, { adjacentOk: false, maxSteps: REACH.maxSteps });
const cageWorthTaking = (_dest: Tile, _from: { x: number; z: number; level: number }, at: Tile): boolean =>
    (at.x === MUD_CAGE.x && at.z === MUD_CAGE.z) || !inCageCorridor();

// Why: ordered by how often the route meets them, so the nearest-first search below settles quickly.
const HOP_KINDS: readonly HopKind[] = [
    { loc: UP_LOC.ROCKSLIDE, op: 'Climb-over', tries: ROLL_TRIES },
    { loc: UP_LOC.ROCK_BRIDGE, op: 'Cross', tries: ROLL_TRIES },
    // Why: the ledge is 6 locs in a column and each tile is its own micro-pocket, so stepping between them passes every crossing test. Crossing any of them is crossing the ledge.
    // Why: `[oploc1,upass_ledge]` opens with `if(coordx(coord) < coordx(loc_coord)) { mes("You can't do that from here."); return; }`, so it only runs from the east.
    { loc: UP_LOC.LEDGE, op: 'Cross', tries: ROLL_TRIES, group: 8, stands: at => [new Tile(at.x + 1, at.z, at.level)] },
    { loc: UP_LOC.PIPE_AREA1, op: 'Squeeze-through' },
    { loc: UP_LOC.PIPE_AREA2, op: 'Squeeze-through' },
    { loc: UP_LOC.COLLAPSED_A, op: 'Cross', tries: ROLL_TRIES },
    { loc: UP_LOC.COLLAPSED_B, op: 'Cross', tries: ROLL_TRIES },
    { loc: UP_LOC.ROCKSWING_BACK, op: 'Swing-on', tries: ROLL_TRIES },
    // Why: `@upass_area_2_3_entrance` telejumps by door angle (landings above), so the door worth taking is the one on the far side from the destination, keyed on its own tile, because a journey's endpoints can sit on the same side of the split with a tunnel the only way between.
    { loc: UP_LOC.UNICORN_DOOR_L, op: 'Pass-through', landing: tunnelLanding },
    { loc: UP_LOC.UNICORN_DOOR_R, op: 'Pass-through', landing: tunnelLanding },
    // Why: the second cavern's seams. The well-to-boulder route crosses the slave cages, the swamp and a pipe, all "unreachable" to the navigator.
    // Why: a railing is used from its own tile, which no ring of neighbours offers, see `doors.ts`. From the corridor only the mud cell's cage is worth picking.
    { loc: UP_LOC.RAILINGS_LOCKED, op: 'Pick-lock', tries: LOCK_TRIES, landing: mudCellDoor, stands: doorStands, when: cageWorthTaking },
    { loc: UP_LOC.RAILINGS_HARD, op: 'Pick-lock', tries: LOCK_TRIES, stands: doorStands },
];
// Why: 2 locs that look like seams. `upass_swampbubbles1`'s Cross drops you in the crevasse at (2485,9649) for 15% hp, and `caverockpile` climbs back out to (2482,9715) behind the bridge and the grid. Neither gets you forward.
// Why: `cavewalltunnel_upass_tocells` has an Enter with no script; it's the scenery the mud dig drops you beside, so crossing it wastes the hop.

const HOP_TIMEOUT_MS = 12_000;
/** Time the crossing script gets once the op-click's walk has stopped. */
const CROSS_TIMEOUT_MS = 10_000;
// Why: what a silent op gets. 3 ticks covers a teleport door end to end, and nothing in the pass moves you later than that without saying so first.
const QUIET_MS = 1_800;
// Why: Cover approach, arrival delay, roll, and the 60-cycle movement/loc merge; successful crossings resolve much sooner.
const CROSS_SETTLE_MS = 5_000;
const MAX_HOPS = 24;
/** How much closer to the target an obstacle must sit before it is worth crossing. */
const MIN_GAIN = 3;
// Why: the seam out of a pocket can sit right across it, the rope swing is 20 tiles from where the bridge lands, so the search covers the pocket. The gain threshold and the spent set hold off drift.
const HOP_SEARCH = 32;
// Why: Server op pathing can reach slightly beyond the client flood; larger radii cross into another pocket and produce reach failures.
const SERVER_PATH_RANGE = 8;
// Why: the pockets wind, so a 30-tile obstacle is past the flood's default 400 steps.
const REACH = { adjacentOk: true, maxSteps: 2_000 } as const;

function here(): { x: number; z: number; level: number } | null {
    return Game.tile();
}

function chebyshev(a: { x: number; z: number }, b: { x: number; z: number }): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

// Why: the op-click walks you first, so wait for 2 still ticks before judging anything. The crossing's forced move comes after that.
// Why: `spoke` is the op's verdict in the chatbox and it beats the tile: the script says what it did before it moves anyone, and a refusal never moves anyone. Without it a refused obstacle paid 6 ticks here plus the crossing timeout.
async function settleWalk(spoke: () => boolean = () => false): Promise<{ x: number; z: number; level: number } | null> {
    // Why: 2 still ticks are also true before the walk starts, so wait for the first move or a verdict, or every first attempt is judged on the start tile.
    const start = here();
    await Execution.delayUntilTicks(() => {
        const now = here();
        return spoke() || (now !== null && start !== null && (now.x !== start.x || now.z !== start.z));
    }, 6);
    let last = here();
    let still = 0;
    const deadline = performance.now() + HOP_TIMEOUT_MS;
    while (performance.now() < deadline) {
        await Execution.delayTicks(1);
        const now = here();
        if (spoke()) {
            return now;
        }
        if (now && last && now.x === last.x && now.z === last.z && now.level === last.level) {
            if (++still >= 2) {
                return now;
            }
        } else {
            still = 0;
        }
        last = now;
    }
    return here();
}

function held(id: number): number {
    return Inventory.items().filter(item => item.id === id).reduce((sum, item) => sum + item.count, 0);
}

// Why: a seam's own tile is blocked and the flood can refuse it outright where the near side is a single walkable column, so any cardinal neighbour answering is enough.
function seamReachable(at: Tile): boolean {
    if (Reachability.canReach(at, REACH)) {
        return true;
    }
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(
        ([dx, dz]) => Reachability.canReach(new Tile(at.x + dx!, at.z + dz!, at.level), REACH)
    );
}

// Why: where a kind names its stands, those tiles are the test. `[oploc1,upass_ledge]` refuses every tile west of the column, so 5 of the ledge's 6 locs can only be stood beside from another pocket, and a reachable neighbour there means nothing.
function seamOpen(loc: Loc): boolean {
    const at = loc.tile();
    const named = kindOf(loc)?.stands?.(at);
    if (named !== undefined && named.length > 0) {
        return named.some(tile => Reachability.canReach(tile, { adjacentOk: false, maxSteps: REACH.maxSteps }));
    }
    return seamReachable(at);
}

// Why: wider than the hop search. The main cavern's exit is a collapsed bridge 43 tiles off, and the one inside 32 belongs to a pocket this one can't reach.
const SWEEP_SEARCH = 52;

/** Every seam loc in the scene, worth crossing or not, for the stuck-pocket log. */
function seamsInScene(within = HOP_SEARCH): Loc[] {
    const found: Loc[] = [];
    for (const kind of HOP_KINDS) {
        found.push(...Locs.query().where(loc => loc.id === kind.loc).action(kind.op).within(within).results());
    }
    for (const seam of USE_SEAMS) {
        found.push(...Locs.query().where(loc => seam.locs.includes(loc.id)).within(within).results());
    }
    return found;
}

// Why: "no obstacle makes progress" doesn't say whether the seam is out of the scene, under the gain threshold or behind a wall, and a pocket the route can't leave costs the run.
function reportStuck(dest: Tile, from: { x: number; z: number }, log: (m: string) => void): void {
    const mine = chebyshev(from, dest);
    const seams = seamsInScene(SWEEP_SEARCH)
        .slice(0, 12)
        .map(loc => {
            const at = loc.tile();
            return `${loc.id}@${at.x},${at.z}L${at.level}`
                + ` gain${mine - chebyshev(at, dest)}${seamReachable(at) ? '' : ' walled'}`;
        })
        .join(' ');
    log(`pass:   seams in reach of (${from.x},${from.z}): ${seams}`);
    // Why: a seam missing from the scene and one the vocabulary doesn't name look the same from outside, and the second is the likelier bug, so list everything operable.
    // Why: one line: the harness surfaces a bounded number of log lines per tick, so 24 of them arrive as a count.
    const nearby = Locs.query().within(20).results().filter(loc => loc.actions().length > 0);
    const listed = nearby
        .slice(0, 24)
        .map(loc => `${loc.id}@${loc.tile().x},${loc.tile().z}L${loc.tile().level}[${loc.actions().join('|')}]`)
        .join(' ');
    log(`pass:   ${nearby.length} op-bearing within 20 of (${from.x},${from.z}): ${listed}`);
}

// Why: a ground-decor seam sits on a blocked tile, so the server's path for the op-click dead-ends with "I can't reach that!" and the script never runs. `inOperableDistance` is `reachedEntity || reachedObj`, which a cardinal neighbour satisfies, so walk there before sending the op.
// Why: the client's walkability for that tile disagrees with the server on a bridge structure, so it can't short-circuit the walk.

/** Whether the character is in place for the op, and whether the walk to it is still to come. */
type Placed = 'stood' | 'from-range' | 'no';

async function standBeside(
    at: Tile,
    dest: Tile,
    note: (m: string) => void,
    skip = 0,
    named: readonly Tile[] = []
): Promise<Placed> {
    const me = here();
    const on = (tile: Tile): boolean => me !== null && me.x === tile.x && me.z === tile.z && me.level === tile.level;
    // Why: a railing is only used from its own tile or the tile across its edge. A tile off its row sets `~check_axis_locactive` false and the script teleports you onto the door's tile without opening it.
    if (named.length > 0) {
        if (skip === 0 && named.some(on)) {
            return 'stood';
        }
    } else if (skip === 0 && me && me.level === at.level && chebyshev(me, at) <= 1) {
        return 'stood';
    } else if (skip === 0 && me && me.level === at.level && chebyshev(me, at) <= 4
        // Why: a 3-tile loc reached from its far end leaves you 3 out and already in place.
        && Reachability.canReach(new Tile(at.x, at.z, at.level), { ...REACH, maxSteps: 64 })) {
        return 'stood';
    }
    // Why: the flood and the walker disagree on single tiles: the ledge's east neighbour at z 9643 floods as reachable and the walker says "unreachable beyond (2375,9644)".
    // Why: `reached` can still refuse from a side the walk reaches because a cavern wall is between them, so a retry takes the next side.
    // Why: adjacency is to the loc's footprint. A collapsed bridge is 3 tiles long, so its stand is 3 out from the origin and a ring of 1 finds only chasm.
    const ring: [number, number][] = [];
    for (let d = 1; d <= 4; d++) {
        ring.push([d, 0], [-d, 0], [0, d], [0, -d]);
    }
    // Why: a 4-sided door puts you out opposite the side you used it from, so the stand decides the landing. Nearest-first took the cage at (2380,9619) from the east every time when south opens toward the unicorn area. Rank stands by where they land and tie-break on the seam's distance.
    const nearMe = bySideThatLands(at, dest, me);
    const candidates = named.length > 0
        ? [...named]
        : ring.map(([dx, dz]) => new Tile(at.x + dx!, at.z + dz!, at.level));
    // Why: `adjacentOk` accepts tiles you can only get next to and a radius-0 walk then refuses them, but strict alone throws away the rope swing's stand. So strict first, loose behind, and the walk radius follows the list.
    // Why: named stands keep their given order, the door's own tile before the tile across it, because that order says which way the crossing goes and only one is ever reachable.
    const rank = (list: Tile[]): Tile[] => (named.length > 0 ? list : list.sort(nearMe));
    const strict = rank(candidates
        .filter(tile => Reachability.canReach(tile, { adjacentOk: false, maxSteps: REACH.maxSteps })));
    const loose = rank(candidates
        .filter(tile => !strict.some(s => s.x === tile.x && s.z === tile.z))
        .filter(tile => Reachability.canReach(tile, REACH)));
    const sides = [...strict, ...loose];
    if (sides.length === 0) {
        // Why: never for a named stand. Server-pathing to a railing picks any side, and every side but 2 sets `~check_axis_locactive` false and teleports you onto the door without opening it. A door with both tiles out of reach is in another cell.
        if (named.length > 0) {
            note(`neither tile of the door at ${at.x},${at.z} is reachable — it belongs to another cell`);
            return 'no';
        }
        // Why: a seam whose approach the pack calls blocked has no reachable ring (the pipe into the railings is operated from a tile no flood will stand on). Close in, send the op and let the server path; a refusal comes back in words. Far off it's another pocket and the click wouldn't send.
        if (me !== null && me.level === at.level && chebyshev(me, at) <= SERVER_PATH_RANGE) {
            note(`no stand beside ${at.x},${at.z} the flood will take — sending the op from (${me.x},${me.z}) and letting the server path`);
            return 'from-range';
        }
        // Why: "nowhere to stand" has 3 causes: the ring is off the loaded scene, the scene calls it all blocked, or the flood can't get there from this pocket. The counts tell them apart.
        const inScene = candidates.filter(tile => Reachability.probeable(tile)).length;
        const walkable = candidates.filter(tile => Reachability.walkable(tile)).length;
        note(`nowhere to stand beside ${at.x},${at.z} (${candidates.length} ring, ${inScene} in scene, ${walkable} walkable, 0 reachable)`);
        return 'no';
    }
    const pick = sides[skip % sides.length]!;
    const exact = skip % sides.length < strict.length;
    // Why: the ring is cardinal because `reachRectangle` takes nothing else, and radius 1 lands on the diagonal next to it, where the op answers "You can't do that from here."
    // Why: walkResilient logs a dozen lines a walk; the caller keeps one.
    if (await Traversal.walkResilient(pick, { radius: exact ? 0 : 1, attempts: 1, timeoutMs: 20_000 })) {
        note(`stood@${here()?.x},${here()?.z}`);
        return 'stood';
    }
    note(`could not stand at ${pick.x},${pick.z}`);
    return 'no';
}

/** Obstacles in the scene: the ones worth a walk first, everything else behind the item-uses. */
function hopsToward(dest: Tile, from: { x: number; z: number }): { leading: Loc[]; trailing: Loc[]; filtered: number } {
    const found: Loc[] = [];
    const jumps: Loc[] = [];
    let filtered = 0;
    const mine = chebyshev(from, dest);
    for (const kind of HOP_KINDS) {
        const all = Locs.query()
            .where(loc => loc.id === kind.loc && (kind.below === undefined || loc.tile().z < kind.below))
            .action(kind.op)
            .within(HOP_SEARCH)
            .results();
        // Why: a seam struck off by its kind's `when` is invisible later, so a fully filtered pocket would read as a scene with no seams. The count tells them apart.
        const locs = all.filter(loc => !kind.when || kind.when(dest, { ...from, level: dest.level }, loc.tile()));
        filtered += all.length - locs.length;
        for (const loc of locs) {
            // Why: a telejump whose best end lands by the destination leads however far off its door stands, and one whose ends are all worse goes to the back. The route to the railings needs one of each, in that order.
            // Why: a landing you're already standing on isn't a gain. The cage into the mud cell lands in that cell, so from inside it would lead the list and take you back out.
            const lands = (kind.landing?.(loc.tile()) ?? []).filter(tile => chebyshev(tile, from) > MIN_GAIN);
            const best = lands.length === 0 ? undefined : Math.min(...lands.map(tile => chebyshev(tile, dest)));
            (best !== undefined && best + MIN_GAIN <= mine ? jumps : found).push(loc);
        }
    }
    // Why: sorting by the obstacle's distance to the target is what encodes "forward".
    // Why: "any obstacle closer than I am" picks marginal ones that cross sideways and drift the route 20 tiles the wrong way.
    // Why: an obstacle in the scene may not be walkable from this pocket. The second cavern's stone bridges sit behind its locked cages and closer to the target, 18 seconds each to prove unreachable; the scene's collision flags answer that for free.
    // Why: a seam can be the only way on while further from the target than you are: the pipe into the boulder's pocket is 16 tiles from the boulder with you 14 away on the wrong side. So gain is a preference, seams that gain come first and the rest follow, and `spent` stops the circles.
    // Why: the scene's verdict orders too: it called a bridge 140 tiles of walking away "walled off" and dropped it. The only hard filter is whether the loc is in the scene.
    const byDistance = (a: Loc, b: Loc): number => chebyshev(a.tile(), dest) - chebyshev(b.tile(), dest);
    const gains = (loc: Loc): boolean => chebyshev(loc.tile(), dest) + MIN_GAIN <= mine;
    const open = (loc: Loc): boolean => seamOpen(loc);
    // Why: a telejump is the map's own transition; the door that lands beside the railings is 59 tiles from them, so every gain test ranks it last.
    // Why: reachability outranks gain among the rest, see `rank.ts`. At (2375,9644) the mud pocket's only exit is the ledge beside you, which gains nothing by straight line and sat behind 7 walled bridges and 10 cages in another cell.
    // Why: a telejump leads on where it lands, unless this pocket can't walk to it. The 2 unicorn tunnels are 21 tiles the wrong way and walled off from the mud pocket.
    const ordered = orderSeams(found, loc => ({ gains: gains(loc), open: open(loc) }), loc => chebyshev(loc.tile(), dest));
    return {
        leading: [...jumps.filter(open).sort(byDistance), ...ordered.filter(loc => gains(loc) && open(loc))],
        trailing: [...ordered.filter(loc => !(gains(loc) && open(loc))), ...jumps.filter(loc => !open(loc)).sort(byDistance)],
        filtered
    };
}

// Why: a leg that stops moving has to say what it was choosing between; every silent `continue` below reads from outside as the module doing nothing.
function tag(loc: Loc, dest: Tile, mine: number, state: 'fresh' | 'here' | 'elsewhere'): string {
    const at = loc.tile();
    const gain = mine - chebyshev(at, dest);
    return `${loc.id}@${at.x},${at.z}${gain >= 0 ? '+' : ''}${gain}`
        + (state === 'fresh' ? '' : `:${state}`)
        + (seamReachable(at) ? '' : ':walled');
}

// Why: one line: the harness surfaces a bounded number of log lines per poll, so 20 of them arrive as the last one.
function shortlist(name: string, list: readonly Loc[], dest: Tile, mine: number, state: (loc: Loc) => 'fresh' | 'here' | 'elsewhere'): string {
    if (list.length === 0) {
        return `${name} none`;
    }
    const shown = list.slice(0, 6).map(loc => tag(loc, dest, mine, state(loc))).join(' ');
    return `${name} ${shown}${list.length > 6 ? ` +${list.length - 6}` : ''}`;
}

// Why: Use the collision navigator for route checks; `walkResilient` can spend nine seconds and move the player while probing.
async function packRoute(from: { x: number; z: number; level: number }, to: Tile): Promise<boolean> {
    return (await Navigator.findPath(from, to, { policy: { useTeleports: false } })).ok;
}

// Why: a seam's own tile is blocked so a route to it never reports ok; its cardinal neighbours are what a walk can reach.
async function packRouteBeside(from: { x: number; z: number; level: number }, at: Tile): Promise<boolean> {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (await packRoute(from, new Tile(at.x + dx!, at.z + dz!, at.level))) {
            return true;
        }
    }
    return false;
}

function kindOf(loc: Loc): HopKind | null {
    return HOP_KINDS.find(k => k.loc === loc.id) ?? null;
}

// Why: one key for the freshness filter and the spend. The ledge is 6 locs collapsed by `group`, and keying the two differently made a ledge spent from one loc read fresh on the next.
function seamKey(loc: Loc): string {
    const at = loc.tile();
    const span = kindOf(loc)?.group;
    return span === undefined
        ? `${loc.id}@${at.x},${at.z}`
        : `${loc.id}@${Math.floor(at.x / span)},${Math.floor(at.z / span)}`;
}

/**
 * Cross one obstacle toward `dest`. Returns false when none makes progress.
 * Why: the test is distance to `dest`, since the op-click walks you before its script resolves and a tile change is usually the approach. A failed roll leaves you where you were, so the locks get their retries.
 */
async function tryHops(
    list: readonly Loc[],
    dest: Tile,
    from: { x: number; z: number; level: number },
    log: (m: string) => void,
    spent: SpentSides
): Promise<boolean> {
    // Why: the 2 silent `continue`s below can skip every candidate before an op is sent, which from outside looks like the step never ran, so they're counted.
    const skipped: string[] = [];
    for (const obstacle of list) {
        const at = obstacle.tile();
        const key = seamKey(obstacle);
        // Why: a stand you can still walk to is on this side of the seam, so skip seams spent from this pocket and keep the one that let you in.
        if (spentHere(spent, key, tile => Reachability.canReach(new Tile(tile.x, tile.z, tile.level), { adjacentOk: false, maxSteps: REACH.maxSteps }))) {
            skipped.push(`${obstacle.id}@${at.x},${at.z}:spent-here`);
            continue;
        }
        const kind = kindOf(obstacle);
        if (!kind) {
            skipped.push(`${obstacle.id}@${at.x},${at.z}:no-vocabulary`);
            continue;
        }
        const op = kind.op;
        let now = from;
        // Why: every one of these refuses in words: "You can't do that from here", "I can't reach that!", "The rock is being used". "did not cross" alone hides which.
        const mark = GameMessages.mark();
        // Why: one line per attempt: the harness surfaces a bounded number of log lines per tick, so 4 tries plus walks would arrive as the last one.
        const trace: string[] = [];
        let stood = false;
        // Why: the tile the op was sent from is the side the seam is spent on, and the one the far side can't walk to.
        let stand: { x: number; z: number; level: number } | null = null;
        // Why: an op sent from range walks you before its script runs and the approach alone clears any distance test, so measure the crossing from where that walk stopped.
        let origin = from;
        const named = kind.stands?.(at) ?? [];
        // Why: `~open_and_close_door2` teleports you 1 tile across the edge, and the 2-tile floor only exists to tell a crossing from the approach walk. A named stand has no approach, so 1 tile is the floor there and `left` carries the rest.
        const moved = named.length > 0 ? 1 : 2;
        for (let attempt = 0; attempt < (kind.tries ?? 1); attempt++) {
            const placed = await standBeside(obstacle.tile(), dest, m => trace.push(m), attempt, named);
            if (placed === 'no') {
                break;
            }
            stood = true;
            stand = here() ?? stand;
            // Why: the walk to the stand isn't the crossing either; a ring tile 14 tiles off clears every distance test on its own.
            origin = stand ?? from;
            const fromRange = placed === 'from-range';
            // Why: a seam is often a row of identical locs (the ledge is 6) and the one picked isn't the one you end up beside. `reachRectangle` takes a cardinal side only, and `nearest()` can't tell diagonal from cardinal at distance 1, so the server answered "I can't reach that!".
            // Why: never for a named stand. A railing's stand is the door's own tile and the cage's other door is 1 tile off, so "whatever is cardinal" sends the op at the north door from the south one, which opens nothing.
            const me = here();
            const cardinal = me === null || named.length > 0
                ? null
                : Locs.query()
                    .where(loc => loc.id === obstacle.id)
                    .action(op)
                    .within(2)
                    .results()
                    .find(loc => Math.abs(loc.tile().x - me.x) + Math.abs(loc.tile().z - me.z) === 1);
            const adjacent = cardinal ?? obstacle;
            if (!(await adjacent.interact(op))) {
                trace.push('the op would not send');
                break;
            }
            // Why: the chatbox beats the tile: the script speaks in the tick the op resolves, then moves you. Waiting on the tile alone cost a refused obstacle 6 ticks plus the crossing timeout.
            now = (await settleWalk(() => verdictSince(mark) !== null)) ?? now;
            const said = verdictSince(mark);
            // Why: a refusal from range is the server's path search saying no, and a second identical click can't change it; the retries are for skill rolls.
            const rangedRefusal = fromRange && GameMessages.sawSince(mark, CANT_REACH);
            if (fromRange) {
                origin = { ...now };
                stand = { ...now };
                trace.push(`walked@${now.x},${now.z}`);
            }
            trace.push(`try${attempt + 1}@${now.x},${now.z}${said === null ? '' : `:${said}`}`);
            if (chebyshev(now, origin) >= moved) {
                break;
            }
            // Why: "You can't do that from here" is the server refusing the side, and every cooldown in the pass refuses for 3 to 15 ticks. Neither improves by waiting, so move to the next seam.
            if (said === 'refused' || rangedRefusal) {
                break;
            }
            // Why: a failed roll leaves you where you were, so the next try goes out this tick with no empty crossing timeout first.
            if (said === 'failed') {
                continue;
            }
            // Why: the walk can stop while the script is still running: the locked cages roll thieving over a 2-tick delay, and the pipes run 2 exactmoves and a telejump. An announced crossing gets the script's own time and ends once you've moved far enough; a silent op gets a short look.
            await Execution.delayUntil(
                () => chebyshev(here() ?? origin, origin) >= moved,
                said === 'crossing' ? CROSS_TIMEOUT_MS : QUIET_MS
            );
            now = here() ?? now;
            trace.push(`then@${now.x},${now.z}`);
            if (chebyshev(now, origin) >= moved) {
                break;
            }
        }
        await settleScene();
        // Why: 2 tiles isn't proof for a door: the slave cages stand on the corridor they open off, so walking round one clears any distance test. A crossing leaves the pocket (`~open_and_close_door2` shuts behind you, a ledge or bridge puts a chasm in the way), so the stand has to be somewhere you can no longer walk to.
        // Why: can't ask while the crossing is running. `~agility_exactmove` merges the seam into the player for the animation and `locChangeUnchecked` calls `collision.delLoc` for the 60-cycle window, the 2 ticks `settleScene` waits, so a flood then walks straight through the seam's tile. Poll: a crossing turns the answer true when the loc comes back, a failure runs the window out.
        // Why: only a crossing is worth polling for. A refusal or failed roll leaves you on the near side by its own account, so one look answers it.
        const standTile = stand === null ? null : new Tile(stand.x, stand.z, stand.level);
        const gone = (): boolean => !Reachability.canReach(standTile!, { adjacentOk: false, maxSteps: REACH.maxSteps });
        const settle = verdictSince(mark) === 'crossing' ? CROSS_SETTLE_MS : verdictSince(mark) === null ? QUIET_MS : 0;
        // Why: `settle` runs before the veto below because a crossing in flight has to land before the stand can be judged.
        const left = standTile === null || (settle === 0 ? gone() : await Execution.delayUntil(gone, settle));
        // Why: the crossing lands during that window, so a log that stops at the last try can't tell an approach from a late crossing.
        const settled = here() ?? now;
        if (chebyshev(settled, now) > 0) {
            trace.push(`settled@${settled.x},${settled.z}`);
        }
        now = settled;
        // Why: a crossing counts when the script ran. The bridge out of the main cavern lands 84 tiles from the witch's cat from 78 away, and the log says "you manage to cross safely".
        // Why: 2 tiles because the op-click walks you before the script resolves, and a 1-tile drift toward the obstacle is the approach.
        // Why: a failed roll can move you without crossing: the ledge's failure is `p_exactmove(coord, coord + (-1,0))` into the rat pit, 1 tile west into a pocket the stand can't walk back to, which clears both tests. The script's verdict outranks anything measured after.
        const verdict = verdictSince(mark);
        if (verdict === 'failed' || verdict === 'refused' || chebyshev(now, origin) < moved || !left) {
            // Why: a seam you couldn't stand beside is one you were in the wrong pocket for; spending it there blocks the crossing once the route gets you 3 tiles from it.
            if (stood && stand) {
                spendFrom(spent, key, stand);
            }
            const said = GameMessages.since(mark).map(m => m.text).slice(-6).join(' / ') || 'nothing';
            log(`pass: ${op} ${obstacle.name ?? obstacle.id} at (${obstacle.tile().x},${obstacle.tile().z})`
                + ` did not cross toward (${dest.x},${dest.z}) from (${from.x},${from.z})`
                + ` — ${trace.join(' | ')} — it said: ${said}`);
            continue;
        }
        // Why: a crossing is spent whether it helped or not, because nothing here can tell which side is useful until the far side is walked, but only from the side it was crossed from or the pocket it leads into has no way out.
        if (stand) {
            spendFrom(spent, key, stand);
        }
        log(`pass: ${op} ${obstacle.name ?? obstacle.id} at (${obstacle.tile().x},${obstacle.tile().z}) → (${now.x},${now.z})`
            + ` — crossed, ${chebyshev(now, origin)} tiles from the stand and it is behind us now`);
        return true;
    }
    if (skipped.length > 0) {
        log(`pass: skipped ${skipped.length} of ${list.length} without sending an op — ${skipped.slice(0, 8).join(' ')}`);
    }
    return false;
}

async function hopToward(dest: Tile, log: (m: string) => void, spent: SpentSides): Promise<boolean> {
    const from = here();
    if (!from) {
        return false;
    }
    const { leading, trailing, filtered } = hopsToward(dest, from);
    const state = (loc: Loc): 'fresh' | 'here' | 'elsewhere' =>
        spentStateHere(spent, seamKey(loc), tile =>
            Reachability.canReach(new Tile(tile.x, tile.z, tile.level), { adjacentOk: false, maxSteps: REACH.maxSteps }));
    const fresh = (list: readonly Loc[]): Loc[] => list.filter(loc => state(loc) === 'fresh');
    const mine = chebyshev(from, dest);
    const back = [...leading, ...trailing].filter(loc => state(loc) === 'elsewhere');
    // Why: the shortlist before anything is tried, so a quiet leg says what it chose between. The filtered count covers seams a kind's `when` removed, or an emptied list looks like a pocket with no seams.
    log(`pass: at (${from.x},${from.z}) → (${dest.x},${dest.z}) d${mine} —`
        + ` ${shortlist('lead', fresh(leading), dest, mine, state)}`
        + ` | ${shortlist('trail', fresh(trailing), dest, mine, state)}`
        + ` | ${shortlist('back', back, dest, mine, state)}`
        + (filtered > 0 ? ` | ${filtered} not for this journey` : ''));
    if (await tryHops(fresh(leading), dest, from, log, spent)) {
        return true;
    }
    // Why: the rope swing and spade dig are each the only way out of their pocket, and a walled-off seam costs a second of floods to disprove, so item-uses go ahead of seams nothing can reach.
    if (await useSeamToward(dest, log)) {
        return true;
    }
    if (await tryHops(fresh(trailing), dest, from, log, spent)) {
        return true;
    }
    // Why: the way back goes last. A pocket with nothing fresh is a dead end and backing out is the only move; one with anything fresh spends that first, or the route swings between 2 sides of one bridge.
    if (back.length > 0) {
        log(`pass: nothing fresh at (${from.x},${from.z}) — backing out over ${back.length} crossing(s) already used`);
    }
    return tryHops(back, dest, from, log, spent);
}

/** A seam crossed by using an item on a loc. */
interface UseSeam {
    item: UpassItem;
    locs: readonly number[];
    /** The script deletes the item before it rolls, so it leaving the pack is the signal. */
    consumes: boolean;
    /** Where the crossing lands you, when that's nowhere near the loc. */
    landing?: Tile;
    /** The tile the script runs from, where it names one. Stand there before using the item. */
    stand?: Tile;
    label: string;
}

// Why: 2 seams are item-uses and both are the only way out of their pocket: the swing east off the bridge shelf onto the grid, and the spade dig south out of the slave cages. They share the vocabulary so the search can pick them.
const USE_SEAMS: readonly UseSeam[] = [
    // Why: `@upass_rock_ropeswing` sets `$start_pos = 0_38_151_30_35`, (2462,9699), `~forcemove`s you there before it rolls, then swings you 4 east to (2466,9699). The forcemove is a server walk that never arrives from a pocket that can't reach the tile, so stand there first.
    {
        item: UP_ITEM.ROPE,
        locs: [UP_LOC.ROCKSWING, UP_LOC.ROCKSWING_ANCHOR],
        consumes: true,
        stand: new Tile(2462, 9699, 0),
        landing: new Tile(2466, 9699, 0),
        label: 'rope swing'
    },
    // Why: `[oplocu,upass_mud]` ends in `p_teleport(0_37_150_24_46)`, so the dig lands at (2392,9646), 40 tiles nearer the boulder than the mud pile. Scored by the loc's tile it's 1 tile of progress, under the gain threshold.
    { item: UP_ITEM.SPADE, locs: [UP_LOC.MUD_DIG], consumes: false, landing: new Tile(2392, 9646, 0), label: 'mud dig' }
];

async function useSeamToward(dest: Tile, log: (m: string) => void): Promise<boolean> {
    const from = here();
    if (!from) {
        return false;
    }
    // Why: 4 silent `continue`s sit between a carried rope and the swing, so say which one passed on it.
    const passed: string[] = [];
    for (const seam of USE_SEAMS) {
        const item = Inventory.items().find(inv => inv.id === seam.item.id);
        if (!item) {
            continue;
        }
        const target = Locs.query()
            .where(loc => seam.locs.includes(loc.id))
            .within(HOP_SEARCH)
            .nearest();
        if (!target) {
            passed.push(`${seam.label}: no loc within ${HOP_SEARCH}`);
            continue;
        }
        const lands = seam.landing ?? target.tile();
        if (chebyshev(lands, dest) + MIN_GAIN > chebyshev(from, dest)) {
            passed.push(`${seam.label}@${target.tile().x},${target.tile().z}: lands (${lands.x},${lands.z}), no nearer than d${chebyshev(from, dest)}`);
            continue;
        }
        if (!seamReachable(target.tile())) {
            passed.push(`${seam.label}@${target.tile().x},${target.tile().z}: walled off`);
            continue;
        }
        if (seam.stand && !(await Traversal.walkResilient(seam.stand, { radius: 0, attempts: 1, timeoutMs: 20_000 }))) {
            log(`pass: could not stand at (${seam.stand.x},${seam.stand.z}) for the ${seam.label}`);
            continue;
        }
        // Why: the op-click walks you to the loc before the use resolves, so "the tile changed" would fire on the walk.
        const mark = GameMessages.mark();
        const before = held(seam.item.id);
        if (!(await item.useOn(target))) {
            continue;
        }
        // Why: `%upass_rockswing_used` is a 5-tick cooldown answered by a `~mesbox`, which holds a main modal open and never takes the rope, so waiting on the pack alone burns the full 12 seconds. The refusal is in the chatbox on tick 1.
        if (seam.consumes && !(await Execution.delayUntil(
            () => held(seam.item.id) < before || verdictSince(mark) === 'refused', HOP_TIMEOUT_MS))) {
            continue;
        }
        if (verdictSince(mark) === 'refused' || verdictSince(mark) === 'failed') {
            log(`pass: the ${seam.label} refused — ${GameMessages.since(mark).map(m => m.text).slice(-3).join(' / ')}`);
            continue;
        }
        const staged = (await settleWalk(() => verdictSince(mark) !== null)) ?? from;
        if (chebyshev(staged, dest) + MIN_GAIN > chebyshev(from, dest)) {
            await Execution.delayUntil(() => chebyshev(here() ?? from, from) >= 2,
                verdictSince(mark) === 'crossing' ? CROSS_TIMEOUT_MS : QUIET_MS);
        }
        await settleScene();
        const now = here() ?? from;
        // Why: a failed swing spends the rope and drops you in the swamp below, which is no progress.
        if (chebyshev(now, from) < 2) {
            log(`pass: the ${seam.label} did not cross toward (${dest.x},${dest.z}) — now at (${now.x},${now.z})`);
            continue;
        }
        log(`pass: ${seam.label} → (${now.x},${now.z})`);
        return true;
    }
    if (passed.length > 0) {
        log(`pass: item seams carried but not taken — ${passed.join('; ')}`);
    }
    return false;
}

// Why: an op-click can only name a loc in the client's build area, which follows you, so a seam across the pocket is invisible. The mud pocket's only exit is a ledge 18 tiles west while its target lies south, so walking toward the target never sees it. When nothing crosses, sweep the pocket.
// Why: the probe has to land inside the pocket, which is rarely square, so each direction tries falling distances and the furthest walkable one wins.
const SWEEP_STEPS = [20, 14, 9, 5] as const;
const SWEEP_DIRS: readonly [number, number][] = [
    [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]
];

// Why: the map can't say which platform pocket anything is in at runtime, but the navigator answers "can I walk there" in a millisecond, so your pocket is the side tile you can reach and the target's is the side tile that reaches it.
function linksFor(level: number): readonly PlatformLink[] {
    return level === 1 ? PLATFORM_LINKS : CAVERN_LINKS;
}

async function platformPocket(from: { x: number; z: number; level: number }): Promise<string | null> {
    for (const link of linksFor(from.level)) {
        for (const side of [link.a, link.b]) {
            if ((await Navigator.findPath(from, side.tile, { policy: { useTeleports: false } })).ok) {
                return side.pocket;
            }
        }
    }
    return null;
}

async function pocketOfTarget(dest: Tile): Promise<string | null> {
    for (const link of linksFor(dest.level)) {
        for (const side of [link.a, link.b]) {
            if ((await Navigator.findPath(side.tile, dest, { policy: { useTeleports: false } })).ok) {
                return side.pocket;
            }
        }
    }
    return null;
}

/** The tile to stand on for the next crossing along the shortest chain of bridges toward `dest`. */
async function platformStep(
    from: { x: number; z: number; level: number },
    dest: Tile,
    log: (m: string) => void
): Promise<Tile | null> {
    const here = await platformPocket(from);
    const goal = await pocketOfTarget(dest);
    if (here === null || goal === null || here === goal) {
        // Why: 3 answers all return null, and "not on the baked graph" and "already in the target's pocket" want opposite things from the caller.
        log(`pass: no baked route — standing in ${here ?? 'a pocket the graph does not name'},`
            + ` target in ${goal ?? 'a pocket the graph does not name'}${here !== null && here === goal ? ' (same pocket, walk it)' : ''}`);
        return null;
    }
    // Breadth-first over the bridge graph, so the first crossing is the first step of a shortest chain.
    const links = linksFor(dest.level);
    const seen = new Set<string>([here]);
    let frontier: { pocket: string; first: Tile }[] = [];
    for (const link of links) {
        for (const [side, far] of [[link.a, link.b], [link.b, link.a]] as const) {
            if (side.pocket === here && !seen.has(far.pocket)) {
                seen.add(far.pocket);
                frontier.push({ pocket: far.pocket, first: side.tile });
            }
        }
    }
    while (frontier.length > 0) {
        const hit = frontier.find(f => f.pocket === goal);
        if (hit) {
            log(`pass: platform route ${here} → ${goal}, standing at (${hit.first.x},${hit.first.z})`);
            return hit.first;
        }
        const next: { pocket: string; first: Tile }[] = [];
        for (const step of frontier) {
            for (const link of links) {
                for (const [side, far] of [[link.a, link.b], [link.b, link.a]] as const) {
                    if (side.pocket === step.pocket && !seen.has(far.pocket)) {
                        seen.add(far.pocket);
                        next.push({ pocket: far.pocket, first: step.first });
                    }
                }
            }
        }
        frontier = next;
    }
    log(`pass: no chain of bridges from ${here} to ${goal}`);
    return null;
}

// Why: on the platforms the solved route is the authority. The free search alternates between the cat and the witch's door, and since the spent set is keyed by destination every switch wipes the memory of used crossings.
async function crossByRoute(
    from: { x: number; z: number; level: number },
    dest: Tile,
    log: (m: string) => void
): Promise<boolean> {
    const stand = await platformStep(from, dest, log);
    if (!stand) {
        return false;
    }
    if (!(await packRoute(from, stand))) {
        log(`pass: no route to the crossing tile (${stand.x},${stand.z}) from (${from.x},${from.z})`);
        return false;
    }
    if (!(await Traversal.walkResilient(stand, { radius: 0, attempts: 2, timeoutMs: 60_000 }))) {
        log(`pass: could not reach the crossing tile (${stand.x},${stand.z})`);
        return false;
    }
    const onPlatforms = dest.level === 1;
    const op = onPlatforms ? 'Cross' : 'Climb-over';
    const bridge = Locs.query()
        .where(loc => (onPlatforms
            ? loc.id === UP_LOC.COLLAPSED_A || loc.id === UP_LOC.COLLAPSED_B
            : loc.id === UP_LOC.ROCKSLIDE))
        .action(op)
        .within(6)
        .nearest();
    if (!bridge) {
        log(`pass: no bridge within reach of the crossing tile (${stand.x},${stand.z})`);
        return false;
    }
    const before = here() ?? from;
    if (!(await bridge.interact(op))) {
        return false;
    }
    const after = (await settleWalk()) ?? before;
    await Execution.delayUntil(() => {
        const t = here();
        return t !== null && chebyshev(t, before) >= 2;
    }, CROSS_TIMEOUT_MS);
    await settleScene();
    const now = here() ?? after;
    if (chebyshev(now, before) < 2) {
        log(`pass: the routed bridge at (${bridge.tile().x},${bridge.tile().z}) did not carry anyone`);
        return false;
    }
    log(`pass: routed across (${bridge.tile().x},${bridge.tile().z}) → (${now.x},${now.z})`);
    return true;
}

/** Walk to the pocket's edge in each direction, looking for a crossing that was out of sight. */
async function sweepPocket(dest: Tile, log: (m: string) => void, spent: SpentSides): Promise<boolean> {
    const from = here();
    if (!from) {
        return false;
    }
    // Why: a compass probe follows where the pocket extends, which in the main cavern is a corridor away from the bridge 15 tiles north. Walking at a seam the scene can see but not reach carries the build area to it.
    // Why: the client's flood called the collapsed bridge walled off from 29 tiles inside the same pocket, which the collision pack says is one walk, so every seam in the scene gets walked at with the budget of that walk.
    let skipped = 0;
    for (const loc of seamsInScene(SWEEP_SEARCH).sort((a, b) => chebyshev(a.tile(), dest) - chebyshev(b.tile(), dest))) {
        if (!(await packRouteBeside(here() ?? from, loc.tile()))) {
            skipped++;
            continue;
        }
        if (!(await Traversal.walkResilient(loc.tile(), { radius: 8, attempts: 2, timeoutMs: 60_000 }))) {
            continue;
        }
        log(`pass: closed on ${loc.name ?? loc.id} at (${loc.tile().x},${loc.tile().z}) — now at (${here()?.x},${here()?.z})`);
        if (await hopToward(dest, log, spent)) {
            return true;
        }
    }
    // Why: the crossing off a platform can be 140 tiles off, past any scene, so known bridge placements get walked at too, nearest the target first. The walker refuses other components in a second each.
    if (skipped > 0) {
        log(`pass: ${skipped} seam(s) in the scene the pack has no route to from (${here()?.x},${here()?.z}) — not walked at`);
    }
    const probes = SWEEP_DIRS
        .map(([dx, dz]) => SWEEP_STEPS
            .map(step => new Tile(from.x + dx * step, from.z + dz * step, from.level))
            .find(tile => chebyshev(tile, from) > 3 && Reachability.canReach(tile, REACH)))
        .filter((tile): tile is Tile => tile !== undefined)
        .sort((a, b) => chebyshev(a, dest) - chebyshev(b, dest));
    log(`pass: sweeping ${probes.length} edge(s) of the pocket at (${from.x},${from.z})`);
    for (const probe of probes) {
        if (!(await Traversal.walkResilient(probe, { radius: 4, attempts: 1, timeoutMs: 30_000, log }))) {
            continue;
        }
        log(`pass: swept to (${here()?.x},${here()?.z}) looking for a crossing out of sight`);
        if (await hopToward(dest, log, spent)) {
            return true;
        }
    }
    return false;
}

/**
 * Walk to `dest`, crossing whatever obstacles stand between its pocket and this one.
 * Why: a plain `walkResilient` goes first every round because inside a pocket it's the right tool; the obstacle search only runs once the navigator says there's no route.
 */

// Why: `spent` outlives one call: each decide cycle starts a fresh `travelTo` and a seam that led nowhere last cycle is nearest again this cycle. Dropped once the destination is reached or changes.
const spentByDest = new Map<string, SpentSides>();

export async function travelTo(dest: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    const destKey = `${dest.x},${dest.z},${dest.level}`;
    if (!spentByDest.has(destKey)) {
        spentByDest.clear();
        spentByDest.set(destKey, new Map<string, Stand[]>());
    }
    const spent = spentByDest.get(destKey)!;
    // Why: once the navigator says there's no route, asking again costs a full walk timeout per obstacle; only a crossing changes the answer.
    let navWorthTrying = true;
    const start = here();
    log(`pass: leg to (${dest.x},${dest.z},${dest.level}) r${radius} from (${start?.x},${start?.z}) — ${spent.size} seam(s) already spent this leg`);
    for (let hop = 0; hop < MAX_HOPS; hop++) {
        const at = here();
        if (at && at.level === dest.level && dest.distanceTo(at) <= radius) {
            spentByDest.delete(destKey);
            log(`pass: arrived at (${at.x},${at.z}), within ${radius} of (${dest.x},${dest.z}) after ${hop} crossing(s)`);
            return true;
        }
        // Why: 24 hops can run before the cap, and without the number a repeating log can't be told from a loop that isn't advancing.
        log(`pass: hop ${hop + 1}/${MAX_HOPS} at (${at?.x},${at?.z}), d${at ? chebyshev(at, dest) : -1} to go`
            + ` — ${navWorthTrying ? 'walking it first' : 'the pack has no route, crossing instead'}`);
        if (navWorthTrying) {
            if (await Traversal.walkResilient(dest, { radius, attempts: 1, timeoutMs: 60_000, log })) {
                log(`pass: walked the rest of the way to (${dest.x},${dest.z})`);
                return true;
            }
            navWorthTrying = false;
        }
        // Why: the derived route first. Every crossing has a fixed stand and landing that `tools/nav/upass-areas.ts` reads off the map and scripts, so the area you stand in names the action. The free search below stays for legs that aren't loc ops: the fire arrow, the spiked grid, the orb corridor.
        if (at && at.level === dest.level) {
            const took = await crossOnce(dest, log);
            if (took === 'crossed') {
                navWorthTrying = await packRoute(here() ?? at, dest);
                continue;
            }
            if (took === 'same') {
                continue;
            }
        }
        // Why: the platforms first because their route is solved.
        if (at && at.level === dest.level && (await crossByRoute(at, dest, log))) {
            navWorthTrying = await packRoute(here() ?? at, dest);
            continue;
        }
        if (!(await hopToward(dest, log, spent)) && !(await sweepPocket(dest, log, spent))) {
            const stuck = here();
            log(`pass: STUCK on hop ${hop + 1} at (${stuck?.x},${stuck?.z}) — nothing in the shortlist crossed and the pocket sweep found nothing new toward (${dest.x},${dest.z})`);
            if (stuck) {
                reportStuck(dest, stuck, log);
            }
            return false;
        }
        // Why: a crossing only changes the answer when it was the last seam, so ask the pack (a millisecond) before the walk (9 seconds).
        navWorthTrying = await packRoute(here() ?? at ?? dest, dest);
    }
    log(`pass: STUCK — ${MAX_HOPS} crossings made without reaching (${dest.x},${dest.z}); still at (${here()?.x},${here()?.z}), ${spent.size} seam(s) spent`);
    return false;
}
