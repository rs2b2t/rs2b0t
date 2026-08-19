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

// Why: the pass is not one map the navigator can route across — a component report over its own seam endpoints answers FAIL for 10 of 14 anchors. Every seam is a scripted obstacle whose tile the collision pack marks blocked, so `walkResilient` toward anything past one reports "unreachable" and the step reads as a missing loc. Movement here is therefore: walk inside the pocket, cross one obstacle, repeat.
// Why: measured pocket counts, so the next leg knows what it is walking into — the first cavern is five pockets, the second five, and the level-1 platforms six, of which only the main landing reaches both wall tunnels on foot (costs 60 and 194). The soulless cages, the witch's cat, her door, the demons' platform and Iban's temple are each sealed behind their own crossing.

/** An obstacle that joins two pockets. All of these move the player across a tile the pack calls blocked. */
interface HopKind {
    loc: number;
    op: string;
    /** How many times to send the op before giving up on this obstacle. */
    tries?: number;
    /** Only treat it as a seam below this z — the same loc is scenery elsewhere in the pass. */
    below?: number;
    /** Only offer this loc when the journey wants where it leads; `at` is the loc's own tile. */
    when?: (dest: Tile, from: { x: number; z: number; level: number }, at: Tile) => boolean;
    /** Every tile this loc can put the player on, for a crossing whose far side is nowhere near it. */
    landing?: (at: Tile) => readonly Tile[];
    /** Treat locs of this kind within this many tiles as ONE seam when spending it. */
    group?: number;
    /** The only tiles this loc may be operated from, best first — a ring of neighbours cannot find them. */
    stands?: (at: Tile) => readonly Tile[];
}

/** The first cavern is everything at or above this z; the second is everything below it. */

// Why: the two locked cages roll `stat_random(thieving, …)` and leave the player where they were on a
// failure, so one send is not a verdict on the obstacle — it is one roll.
const LOCK_TRIES = 5;
// Why: the rockslide, the ledge, the stone bridges and the collapsed bridge each roll agility and drop the player short on a failure — the ledge into a rat pit for five. Spending the obstacle on one roll is how a leg ran out of ledges to try while standing next to six of them.
const ROLL_TRIES = 4;

// Why: `@upass_area_2_3_entrance` telejumps rather than opens, and the map fixes which way by the door's own angle: the pair at (2370,9665) and (2371,9665) is angle 1 and lands the player at (2401,9610) beside the loose railings, while the two pairs at z 9611 are angle 3 and land them at (2371,9666) in the first cavern. Neither landing is anywhere near the door, so a search that ranks these by where they STAND puts the one that finishes the journey last and takes the one that undoes it first.
const TUNNEL_TO_RAILINGS = new Tile(2401, 9610, 0);
const TUNNEL_TO_UNICORN = new Tile(2376, 9610, 0);
const TUNNEL_TO_FIRST_CAVERN = new Tile(2371, 9666, 0);
// Why: the doors are one shuttle with three ends, and `@upass_area_2_3_entrance` picks between them on the door's angle AND on `%upass >= ^upass_killed_unicorn` — which the journal cannot report, because stages 3 and 4 print the same page. So a door is worth what its BEST end is worth: taking it is how the route finds out which end it got, and the crossing test says honestly where it landed.
const TUNNEL_ENDS: readonly Tile[] = [TUNNEL_TO_FIRST_CAVERN, TUNNEL_TO_RAILINGS, TUNNEL_TO_UNICORN];
const tunnelLanding = (): readonly Tile[] => TUNNEL_ENDS;

// Why: the slave cages are ten identical locked railings on one corridor, and nine of them open onto a dead end of seven to fourteen tiles. The mud at (2393,9650) is the only way south out of them and it sits in the cell behind (2393,9655) alone, so from the corridor there is one cage worth picking and nine that are not. Inside a cell the rule inverts — the door on that cell's own wall is the way back out — and "which side am I on" is a question the corridor tile answers: reachable means the corridor.
const inCageCorridor = (): boolean =>
    Reachability.canReach(MUD_CAGE, { adjacentOk: false, maxSteps: REACH.maxSteps });
const cageWorthTaking = (_dest: Tile, _from: { x: number; z: number; level: number }, at: Tile): boolean =>
    (at.x === MUD_CAGE.x && at.z === MUD_CAGE.z) || !inCageCorridor();

// Why: ordered by how often the route meets them, so the nearest-first search below settles quickly.
const HOP_KINDS: readonly HopKind[] = [
    { loc: UP_LOC.ROCKSLIDE, op: 'Climb-over', tries: ROLL_TRIES },
    { loc: UP_LOC.ROCK_BRIDGE, op: 'Cross', tries: ROLL_TRIES },
    // Why: the ledge is six locs in a column and each of their tiles is its own micro-pocket, so stepping from one to the next satisfies every crossing test — a run walked the column four times over, spending a hop each way. Crossing any of them is crossing the ledge.
    // Why: and `[oploc1,upass_ledge]` opens with `if(coordx(coord) < coordx(loc_coord)) { mes("You can't do that from here."); return; }`, so the only side it runs from is the east. The ring offered the three western tiles too and spent an attempt on each proving it.
    { loc: UP_LOC.LEDGE, op: 'Cross', tries: ROLL_TRIES, group: 8, stands: at => [new Tile(at.x + 1, at.z, at.level)] },
    { loc: UP_LOC.PIPE_AREA1, op: 'Squeeze-through' },
    { loc: UP_LOC.PIPE_AREA2, op: 'Squeeze-through' },
    { loc: UP_LOC.COLLAPSED_A, op: 'Cross', tries: ROLL_TRIES },
    { loc: UP_LOC.COLLAPSED_B, op: 'Cross', tries: ROLL_TRIES },
    { loc: UP_LOC.ROCKSWING_BACK, op: 'Swing-on', tries: ROLL_TRIES },
    // Why: `@upass_area_2_3_entrance` telejumps rather than opens, and the map fixes which way by the door's own angle: the pair at (2370,9665) and (2371,9665) is angle 1 and lands the player at (2401,9610) beside the loose railings, while the two pairs at z 9611 are angle 3 and land them at (2371,9666) in the first cavern. So the door worth taking is the one standing on the far side from the destination — keyed on the door's own tile, because the journey's endpoints can sit on the same side of the split while the only way between them is one of these.
    { loc: UP_LOC.UNICORN_DOOR_L, op: 'Pass-through', landing: tunnelLanding },
    { loc: UP_LOC.UNICORN_DOOR_R, op: 'Pass-through', landing: tunnelLanding },
    // Why: the second cavern's own seams. The route from the well down to the boulder crosses the slave cages, the swamp and a pipe, and every one of them reads "unreachable" to the navigator.
    // Why: a railing is used from its OWN tile, which no ring of neighbours offers — see `doors.ts`. And only the cage whose cell holds the mud is worth picking from the corridor.
    { loc: UP_LOC.RAILINGS_LOCKED, op: 'Pick-lock', tries: LOCK_TRIES, landing: mudCellDoor, stands: doorStands, when: cageWorthTaking },
    { loc: UP_LOC.RAILINGS_HARD, op: 'Pick-lock', tries: LOCK_TRIES, stands: doorStands },
];
// Why: two locs that look like seams and are not. `upass_swampbubbles1` offers Cross and then drags the player into a crevasse at (2485,9649) for fifteen per cent of their hitpoints — it is a trap wearing a crossing's op. `caverockpile` does climb, but out to the first cavern's landing chamber at (2482,9715), which is behind the bridge and the grid: a way home, not a way on.
// Why: `cavewalltunnel_upass_tocells` carries an Enter it has no script for — it is the scenery the mud dig teleports the player out beside, so crossing it can only waste the hop it is chosen for.

const HOP_TIMEOUT_MS = 12_000;
/** How long the crossing script itself gets, once the op-click's walk has stopped. */
const CROSS_TIMEOUT_MS = 10_000;
// Why: what a silent op gets. Three ticks covers a teleport door end to end, and nothing in the pass moves anyone later than that without saying so first.
const QUIET_MS = 1_800;
// Why: long enough to outlast every stage a crossing ends with — the op-click's approach, `p_arrivedelay`, the roll, the sixty-cycle exactmove and the loc merge that hides the seam's collision for the same sixty cycles. A crossing that worked answers in the first second; only a failed roll pays the window out.
const CROSS_SETTLE_MS = 5_000;
const MAX_HOPS = 24;
/** How much closer to the target an obstacle must sit before it is worth crossing. */
const MIN_GAIN = 3;
// Why: the seam out of a pocket can sit right across it — the rope swing off the bridge shelf is twenty tiles from where the bridge lands — so the search has to cover the pocket, not the neighbourhood. Drift is held off by the gain threshold and by spending an obstacle that led away, not by looking less far.
const HOP_SEARCH = 32;
// Why: the server paths for an op-click, and close in it can see ground the client's flood refuses — the pipe into the railings is operated from a tile the pack calls blocked. Widening this to the build area only bought delay: the server answered "I can't reach that!" from eighteen and twenty-three tiles, four tries a seam, because at that range the character stands in another pocket rather than beside a blocked approach.
const SERVER_PATH_RANGE = 8;
// Why: the pockets wind, so a thirty-tile obstacle is well past the flood's default four hundred steps.
const REACH = { adjacentOk: true, maxSteps: 2_000 } as const;

function here(): { x: number; z: number; level: number } | null {
    return Game.tile();
}

function chebyshev(a: { x: number; z: number }, b: { x: number; z: number }): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

// Why: an op-click walks the player before its script resolves, so nothing can be judged until the walk has stopped. Two unchanged ticks is what "stopped" means here; the forced move of the crossing itself comes after, and shows up as the distance the caller then measures.
// Why: `spoke` is the op's own verdict arriving in the chatbox, and it beats the tile every time — the script says what it did before it moves anyone, and on a refusal it never moves anyone at all. Without it a refused obstacle paid six ticks here and the crossing timeout on top, for an answer the first tick already carried.
async function settleWalk(spoke: () => boolean = () => false): Promise<{ x: number; z: number; level: number } | null> {
    // Why: two still ticks are also true before the walk has begun, so every obstacle's first attempt was
    // judged on the tile it started from and thrown away — the locked cage crossed on try two every time.
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

// Why: a seam's own tile is blocked — that is what makes it a seam — and the flood can refuse it outright where the near side is a single walkable column. Its cardinal neighbours are the tiles a player would stand on to use it, so one of those answering is enough.
function seamReachable(at: Tile): boolean {
    if (Reachability.canReach(at, REACH)) {
        return true;
    }
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(
        ([dx, dz]) => Reachability.canReach(new Tile(at.x + dx!, at.z + dz!, at.level), REACH)
    );
}

// Why: a seam with a forced side is not "open" because some neighbour of it happens to be reachable. `[oploc1,upass_ledge]` refuses every tile west of the column, so five of the ledge's six locs can only be stood beside from a tile in another pocket — and counting those as reachable ranked them ahead of the one loc whose stand the character was standing on. Where a kind names its stands, those tiles are the question.
function seamOpen(loc: Loc): boolean {
    const at = loc.tile();
    const named = kindOf(loc)?.stands?.(at);
    if (named !== undefined && named.length > 0) {
        return named.some(tile => Reachability.canReach(tile, { adjacentOk: false, maxSteps: REACH.maxSteps }));
    }
    return seamReachable(at);
}

// Why: the sweep looks further than the hop search does. The main cavern's own exit is a collapsed bridge forty-three tiles off, while the one inside thirty-two belongs to a pocket this one cannot reach — so a sweep bounded by the hop radius only ever saw the wrong bridge.
const SWEEP_SEARCH = 52;

/** Every seam loc in the scene, whether or not it is worth crossing — the log for a stuck pocket. */
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

// Why: "no obstacle makes progress" says nothing about why — whether the seam is out of the scene, on the wrong side of the gain threshold, or behind a wall. A pocket the route cannot leave is the one failure that costs a run, so it says what it could see and what it made of each one.
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
    // Why: a seam missing from the scene and a seam the vocabulary does not name look identical from the outside, and the second is the likelier bug — so the pocket says everything it can operate.
    // Why: one line, not one per loc — the harness only surfaces a bounded number of log lines per tick, so twenty-four of them arrive as a count and nothing else.
    const nearby = Locs.query().within(20).results().filter(loc => loc.actions().length > 0);
    const listed = nearby
        .slice(0, 24)
        .map(loc => `${loc.id}@${loc.tile().x},${loc.tile().z}L${loc.tile().level}[${loc.actions().join('|')}]`)
        .join(' ');
    log(`pass:   ${nearby.length} op-bearing within 20 of (${from.x},${from.z}): ${listed}`);
}

// Why: a ground-decor seam sits on a tile the pack calls blocked, so the server's own path search for the op-click dead-ends and answers "I can't reach that!" — the script never runs, and the step reads it as a failed agility roll. `inOperableDistance` is `reachedEntity || reachedObj`, which a CARDINAL neighbour satisfies, so the walk is made explicit before the op is sent.
// Why: and the client's own walkability for that tile is not the test. It disagrees with the server on a bridge structure, so trusting it short-circuited the walk and sent the op from twenty tiles away again.

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
    // Why: a railing is used from its own tile and from the tile across its edge, and from nowhere else — so "close enough" is the wrong test for one. Standing a tile off its row sets `~check_axis_locactive` false and the script teleports the character onto the door's tile without opening it, which is how a leg picked the same two cages back and forth along the cage corridor.
    if (named.length > 0) {
        if (skip === 0 && named.some(on)) {
            return 'stood';
        }
    } else if (skip === 0 && me && me.level === at.level && chebyshev(me, at) <= 1) {
        return 'stood';
    } else if (skip === 0 && me && me.level === at.level && chebyshev(me, at) <= 4
        // Why: a three-tile loc reached from its far end leaves the character three out and already in place.
        && Reachability.canReach(new Tile(at.x, at.z, at.level), { ...REACH, maxSteps: 64 })) {
        return 'stood';
    }
    // Why: the client's flood and the walker disagree about single tiles — the ledge's east neighbour at z 9643 floods as reachable and the walker answers "unreachable beyond (2375,9644)".
    // Why: and `reached` can still refuse from a side the walk reaches, because a cavern wall stands between them. So a retry takes the NEXT side rather than sending the same op from the same tile again.
    // Why: adjacency is to the loc's FOOTPRINT, not its origin. A collapsed bridge is three tiles long, so the tile a character stands on to cross it is three out from the origin — and a ring of one found nothing but chasm and reported there was nowhere to stand.
    const ring: [number, number][] = [];
    for (let d = 1; d <= 4; d++) {
        ring.push([d, 0], [-d, 0], [0, d], [0, -d]);
    }
    // Why: a door with four sides puts the player out the side opposite the one it was used from, so the stand decides where the crossing lands. Sorted by what is nearest, the cage at (2380,9619) was always taken from the east and always landed east — while the side that matters opens south toward the unicorn area. Rank a stand by where crossing from it would put the character, and let the seam's own distance break the tie.
    const nearMe = bySideThatLands(at, dest, me);
    const candidates = named.length > 0
        ? [...named]
        : ring.map(([dx, dz]) => new Tile(at.x + dx!, at.z + dz!, at.level));
    // Why: a tile the character can stand *on* is the one worth having — `adjacentOk` accepts tiles it can only get next to, and a radius-zero walk then refuses those same tiles. But strict as a veto is worse than the disease: it threw away the rope swing's stand and left the route with nothing at all. So strict first, loose behind it, and the walk's radius follows which list the tile came from.
    // Why: named stands keep the order they were given — the door's own tile before the tile across it — because that order says which way the crossing goes, and only one of the two is ever reachable.
    const rank = (list: Tile[]): Tile[] => (named.length > 0 ? list : list.sort(nearMe));
    const strict = rank(candidates
        .filter(tile => Reachability.canReach(tile, { adjacentOk: false, maxSteps: REACH.maxSteps })));
    const loose = rank(candidates
        .filter(tile => !strict.some(s => s.x === tile.x && s.z === tile.z))
        .filter(tile => Reachability.canReach(tile, REACH)));
    const sides = [...strict, ...loose];
    if (sides.length === 0) {
        // Why: not for a named stand. Letting the server path to a railing walks the character to whatever side its own search likes, and every side but two sets `~check_axis_locactive` false — the door then teleports them onto its own tile and opens nothing, four tries a cage, up and down the corridor. A door whose two tiles are both out of reach is a door in another cell, and saying so is the answer.
        if (named.length > 0) {
            note(`neither tile of the door at ${at.x},${at.z} is reachable — it belongs to another cell`);
            return 'no';
        }
        // Why: a seam whose approach the pack calls blocked has no reachable ring at all — the pipe into the railings is operated from a tile no flood will stand on. Close by, the server's own path search is the better authority: send the op from where we are and let it walk, and a refusal comes back in words rather than as a leg that retries forever. Far off it is a seam in another pocket and the click would not even send, so the report stands.
        if (me !== null && me.level === at.level && chebyshev(me, at) <= SERVER_PATH_RANGE) {
            note(`no stand beside ${at.x},${at.z} the flood will take — sending the op from (${me.x},${me.z}) and letting the server path`);
            return 'from-range';
        }
        // Why: "nowhere to stand" has three causes that need different fixes — the ring is off the loaded scene, the scene calls every tile of it blocked, or the flood cannot walk there from this pocket. The counts separate them in one run rather than three.
        const inScene = candidates.filter(tile => Reachability.probeable(tile)).length;
        const walkable = candidates.filter(tile => Reachability.walkable(tile)).length;
        note(`nowhere to stand beside ${at.x},${at.z} (${candidates.length} ring, ${inScene} in scene, ${walkable} walkable, 0 reachable)`);
        return 'no';
    }
    const pick = sides[skip % sides.length]!;
    const exact = skip % sides.length < strict.length;
    // Why: the ring is cardinal because `reachRectangle` takes nothing else, and a radius of one throws that away — it lands next to the tile that was chosen, which is the diagonal, and the op answers "You can't do that from here." Four tries at the second cavern's ledge all came from one diagonal tile that way.
    // Why: walkResilient's own logging is a dozen lines a walk, and the caller keeps one line.
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
        // Why: a seam struck off by its kind's own `when` is invisible to every later line, and a pocket whose shortlist was filtered away entirely reads as a scene with no seams in it. The count is what tells those two apart.
        const locs = all.filter(loc => !kind.when || kind.when(dest, { ...from, level: dest.level }, loc.tile()));
        filtered += all.length - locs.length;
        for (const loc of locs) {
            // Why: a telejump whose best end lands beside the destination leads the list however far off its door stands, and one whose ends are all worse keeps its turn at the back rather than being struck off — the route to the railings needs one of each, in that order.
            // Why: and a landing the character is already standing on is not a gain. The cage into the mud cell carries that cell as its landing, so from inside the cell it led the list and took the route straight back out to the corridor it had left a moment before.
            const lands = (kind.landing?.(loc.tile()) ?? []).filter(tile => chebyshev(tile, from) > MIN_GAIN);
            const best = lands.length === 0 ? undefined : Math.min(...lands.map(tile => chebyshev(tile, dest)));
            (best !== undefined && best + MIN_GAIN <= mine ? jumps : found).push(loc);
        }
    }
    // Why: the obstacle worth crossing is the one that leaves the player closer to the target than standing still does — sorting by the target's distance from the obstacle is what encodes "forward".
    // Why: "any obstacle closer than I am" picks marginal ones that cross sideways and drift the route — three of them in a row carried a run twenty tiles the wrong way before the loop gave up.
    // Why: and an obstacle in the scene is not one this pocket can walk to. The stone bridges of the second cavern sit behind its locked cages, closer to the target than the cages are, so the search chose them first and burned eighteen seconds each proving it could not get there. The scene's own collision flags answer that for free.
    // Why: and a seam can be the only way on while sitting FURTHER from the target than the character already is — the pipe into the boulder's pocket is sixteen tiles from the boulder while the character stands fourteen away on the wrong side of it. A gain threshold alone therefore cannot leave that pocket, and the run oscillated through one cage door instead. So the gain is a preference, not a filter: seams that gain come first, the rest follow, and `spent` is what stops it going in circles.
    // Why: and the scene's own verdict orders them too rather than vetoing them. It called the bridge the character had walked a hundred and forty tiles to stand beside "walled off", which dropped it from the list entirely and sent the run over a different bridge, away from the target. Every one of these tests is a preference; the only hard filter left is whether the loc is in the scene at all.
    const byDistance = (a: Loc, b: Loc): number => chebyshev(a.tile(), dest) - chebyshev(b.tile(), dest);
    const gains = (loc: Loc): boolean => chebyshev(loc.tile(), dest) + MIN_GAIN <= mine;
    const open = (loc: Loc): boolean => seamOpen(loc);
    // Why: a telejump is the map's own transition and not one candidate among twenty — the door that lands beside the railings sits fifty-nine tiles from them, so every gain test ranks it last and the search spends a leg's worth of bridges proving the ones that gain lead nowhere.
    // Why: and reachability outranks gain among the rest — see `rank.ts`. Live at (2375,9644), the mud pocket's only exit is the ledge beside the character, which gains nothing by straight line, and it sat behind seven stone bridges with both sides blocked and ten cages in another cell.
    // Why: a telejump leads on where it LANDS, not on where its door stands — but one this pocket cannot walk to leads nowhere at all. The two unicorn tunnels are twenty-one tiles the wrong way and walled off from the mud pocket, and they took the first two turns of every round there.
    const ordered = orderSeams(found, loc => ({ gains: gains(loc), open: open(loc) }), loc => chebyshev(loc.tile(), dest));
    return {
        leading: [...jumps.filter(open).sort(byDistance), ...ordered.filter(loc => gains(loc) && open(loc))],
        trailing: [...ordered.filter(loc => !(gains(loc) && open(loc))), ...jumps.filter(loc => !open(loc)).sort(byDistance)],
        filtered
    };
}

// Why: what a candidate is, where it stands, how much closer crossing it would leave the character, and why it is not first. A leg that stops moving has to say what it was choosing between — every silent `continue` in the search below reads from the outside as the module having done nothing at all.
function tag(loc: Loc, dest: Tile, mine: number, state: 'fresh' | 'here' | 'elsewhere'): string {
    const at = loc.tile();
    const gain = mine - chebyshev(at, dest);
    return `${loc.id}@${at.x},${at.z}${gain >= 0 ? '+' : ''}${gain}`
        + (state === 'fresh' ? '' : `:${state}`)
        + (seamReachable(at) ? '' : ':walled');
}

// Why: one line, not one per candidate — the harness surfaces a bounded number of log lines per poll, so twenty of them arrive as the last one and nothing else.
function shortlist(name: string, list: readonly Loc[], dest: Tile, mine: number, state: (loc: Loc) => 'fresh' | 'here' | 'elsewhere'): string {
    if (list.length === 0) {
        return `${name} none`;
    }
    const shown = list.slice(0, 6).map(loc => tag(loc, dest, mine, state(loc))).join(' ');
    return `${name} ${shown}${list.length > 6 ? ` +${list.length - 6}` : ''}`;
}

// Why: `walkResilient` cannot answer "is there a route" cheaply. Even bounded to one pass it ladders through a baked walk, a six-second scene walk and an unstick step that drags the character a tile off the stand it was put on, and only then says unreachable — nine seconds a call, eighteen at two passes, and `travelTo` bought one after every crossing while `sweepPocket` bought one per seam. The navigator answers the same question against the collision pack in under a millisecond.
async function packRoute(from: { x: number; z: number; level: number }, to: Tile): Promise<boolean> {
    return (await Navigator.findPath(from, to, { policy: { useTeleports: false } })).ok;
}

// Why: a seam's own tile is blocked, so a route to it never reports ok — its cardinal neighbours are what a walk toward it can reach.
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

// Why: one key, used by both the freshness filter and the spend. The ledge is six locs collapsed into one seam by `group`, and the two were keying it differently — the filter said fresh on the loc's own tile while the spend said used on the group — so a ledge spent from one loc read as fresh on the next and the search kept offering a seam it had already answered.
function seamKey(loc: Loc): string {
    const at = loc.tile();
    const span = kindOf(loc)?.group;
    return span === undefined
        ? `${loc.id}@${at.x},${at.z}`
        : `${loc.id}@${Math.floor(at.x / span)},${Math.floor(at.z / span)}`;
}

/**
 * Cross one obstacle toward `dest`. Returns false when there is none that makes progress.
 * Why: the test is the distance to `dest`, not "the tile changed". An op-click walks the player before its script resolves, so a tile change is usually the approach — one run read a one-tile drift toward a cage it never reached as a crossing and spent seventy seconds a round on it. A roll that fails leaves the player where they were, which is a retry rather than a stop, so the locks get theirs.
 */
async function tryHops(
    list: readonly Loc[],
    dest: Tile,
    from: { x: number; z: number; level: number },
    log: (m: string) => void,
    spent: SpentSides
): Promise<boolean> {
    // Why: the two silent `continue`s below are how a list of eight candidates could produce no log line at all — every entry can be skipped before one op is sent, and from the outside that is indistinguishable from the step never running. They are counted and reported instead.
    const skipped: string[] = [];
    for (const obstacle of list) {
        const at = obstacle.tile();
        const key = seamKey(obstacle);
        // Why: a stand the character can still walk to is a stand on this side of the seam, so a seam spent
        // from the pocket they are in now is the one to skip — and the one that let them in here is not.
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
        // Why: every one of these refuses in words — "You can't do that from here", "I can't reach that!", "The rock is being used" — and a step that only reports "did not cross" hides which. Twenty ledge rolls at ninety-five per cent each cannot all fail, so the script was never running.
        const mark = GameMessages.mark();
        // Why: one line covering the attempt, not one per try — the harness surfaces a bounded number of
        // log lines per tick, and four tries plus their walks arrive as the last of them and nothing else.
        const trace: string[] = [];
        let stood = false;
        // Why: the tile the op was sent from is the side of the seam it was spent on, and the only one the far side cannot walk to.
        let stand: { x: number; z: number; level: number } | null = null;
        // Why: an op sent from range walks the player before its script runs, so the approach alone clears any distance test — the crossing is measured from where that walk stopped, not from where it started.
        let origin = from;
        const named = kind.stands?.(at) ?? [];
        // Why: a door crossing is one tile and no more — `~open_and_close_door2` teleports the character across the edge and no further — and the two-tile floor exists only to tell a crossing apart from the op-click's own approach walk. A named stand has no approach: the walk to it finished before the op was sent, and the character was standing on the door's own tile. So one tile is the honest floor there, and `left` carries the rest.
        const moved = named.length > 0 ? 1 : 2;
        for (let attempt = 0; attempt < (kind.tries ?? 1); attempt++) {
            const placed = await standBeside(obstacle.tile(), dest, m => trace.push(m), attempt, named);
            if (placed === 'no') {
                break;
            }
            stood = true;
            stand = here() ?? stand;
            // Why: the walk to the stand is not the crossing either. A ring tile fourteen tiles off cleared every distance test on its own, and the pipe out of the cages reported a crossing it had only walked up to — which spent the seam and left the route in the pocket it started in.
            origin = stand ?? from;
            const fromRange = placed === 'from-range';
            // Why: a seam is often a row of identical locs — the ledge is six — and the one the search picked is not the one the character ended up beside. `reachRectangle` takes a cardinal side and nothing else, and `nearest()` cannot tell a diagonal neighbour from a cardinal one: both are distance one, so it kept returning the diagonal and the server kept answering "I can't reach that!".
            // Why: never for a named stand. The stand for a railing is the door's OWN tile, and the other door of the same cage stands one tile off it — so swapping to "whatever is cardinal" sends the op at the north door while the character stands on the south one, which opens nothing and shuffles them along the corridor. The stand was chosen for this loc; the op goes to this loc.
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
            // Why: the tile and the chatbox race, and the chatbox wins — the script speaks in the tick the op resolves, then moves anyone it is going to move. Waiting on the tile alone is what made a refused obstacle cost six ticks here and the crossing timeout on top.
            now = (await settleWalk(() => verdictSince(mark) !== null)) ?? now;
            const said = verdictSince(mark);
            // Why: a refusal from range is the server's own path search saying no, and a second identical click cannot change it — the retries exist for a skill roll, and none was rolled.
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
            // Why: "You can't do that from here" is the server refusing the SIDE, not a failed roll, and every cooldown in the pass refuses for three to fifteen ticks. Neither improves by being waited on, so the search moves to the next seam now.
            if (said === 'refused' || rangedRefusal) {
                break;
            }
            // Why: a failed roll leaves the character standing where they were, which is what the retries are for — the next one can go out this tick rather than after a crossing timeout that has nothing to time.
            if (said === 'failed') {
                continue;
            }
            // Why: the walk can stop on the near side while the crossing script is still running — the two locked cages roll thieving over a two-tick delay before moving anyone, and the pipes run two exactmoves and a telejump. So an announced crossing gets the script's own time, and it ends the moment the character has moved far enough rather than when the clock does. A silent op gets a short look instead of the same long one.
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
        // Why: two tiles is not proof for a door. The slave cages stand ON the corridor they open off, so a walk from one side of a cage to the other along that corridor clears any distance test without opening anything — and the cage is then struck off as used. What a crossing does is leave the pocket: `~open_and_close_door2` shuts behind the player, and a ledge or a bridge puts a chasm in the way. So the stand has to be somewhere the character can no longer walk to.
        // Why: and that question cannot be asked while the crossing is still running. `~agility_exactmove` merges the seam INTO the player for the length of the animation, and the client takes its collision out of the scene with it — `locChangeUnchecked` calls `collision.delLoc` for the sixty-cycle window, which is the two ticks `settleScene` waits. A flood run inside that hole walks straight through the tile the seam stands on and answers "the stand is still reachable", so a rockslide the chatbox had already reported climbed was logged as a failure and spent. Poll instead: a crossing that happened turns the answer true the moment the loc comes back, and one that did not runs the window out.
        // Why: and only a crossing is worth polling for. A refusal and a failed roll both leave the character on the near side by their own account, so asking the flood the same question for five seconds only delays the next seam — one look answers it.
        const standTile = stand === null ? null : new Tile(stand.x, stand.z, stand.level);
        const gone = (): boolean => !Reachability.canReach(standTile!, { adjacentOk: false, maxSteps: REACH.maxSteps });
        const settle = verdictSince(mark) === 'crossing' ? CROSS_SETTLE_MS : verdictSince(mark) === null ? QUIET_MS : 0;
        // Why: `settle` is read before the veto below, because a crossing still in flight has to land before the stand can be judged.
        const left = standTile === null || (settle === 0 ? gone() : await Execution.delayUntil(gone, settle));
        // Why: the crossing lands during that window, so where it left the character is only known after it — and a log that stops at the last try cannot tell an approach apart from a crossing that arrived late.
        const settled = here() ?? now;
        if (chebyshev(settled, now) > 0) {
            trace.push(`settled@${settled.x},${settled.z}`);
        }
        now = settled;
        // Why: a crossing counts when the script ran, not when the straight line got shorter. The bridge out of the main cavern lands the character eighty-four tiles from the witch's cat where they were seventy-eight away, and the log said "you manage to cross safely" while this called it a failure and spent the only way on. Distance across a pocket graph is not distance.
        // Why: two tiles, because the op-click walks the player before the script resolves — a one-tile drift toward the obstacle is the approach, and reading that as a crossing burned seventy seconds a round on a cage the character never reached.
        // Why: a failed roll can move the character without crossing anything — the ledge's own failure is `p_exactmove(coord, coord + (-1,0))` into the rat pit, one tile west into a pocket the stand cannot walk back to, which clears both the distance floor and the reachability test. The script said it fell. Nothing measured afterwards outranks that.
        const verdict = verdictSince(mark);
        if (verdict === 'failed' || verdict === 'refused' || chebyshev(now, origin) < moved || !left) {
            // Why: a seam that could not be stood beside is not a seam that does not work — it is one the character was in the wrong pocket for. Spending it there meant that when the route finally put them three tiles from it, the search refused to try the crossing at all.
            if (stood && stand) {
                spendFrom(spent, key, stand);
            }
            const said = GameMessages.since(mark).map(m => m.text).slice(-6).join(' / ') || 'nothing';
            log(`pass: ${op} ${obstacle.name ?? obstacle.id} at (${obstacle.tile().x},${obstacle.tile().z})`
                + ` did not cross toward (${dest.x},${dest.z}) from (${from.x},${from.z})`
                + ` — ${trace.join(' | ')} — it said: ${said}`);
            continue;
        }
        // Why: a crossing is spent whether it helped or not, because nothing here can tell which side of a seam is the useful one until the far side is walked — but only from the side it was crossed from, or the pocket it leads into has no way out of it.
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
    // Why: the shortlist BEFORE anything is tried, so a leg that goes quiet says what it had to choose between. Each entry carries its gain and why it is not leading, and the filtered count covers the seams a kind's own `when` removed — a pocket where that emptied the list looks identical to a pocket with no seams in it.
    log(`pass: at (${from.x},${from.z}) → (${dest.x},${dest.z}) d${mine} —`
        + ` ${shortlist('lead', fresh(leading), dest, mine, state)}`
        + ` | ${shortlist('trail', fresh(trailing), dest, mine, state)}`
        + ` | ${shortlist('back', back, dest, mine, state)}`
        + (filtered > 0 ? ` | ${filtered} not for this journey` : ''));
    if (await tryHops(fresh(leading), dest, from, log, spent)) {
        return true;
    }
    // Why: the rope swing and the spade dig are each the only way out of their pocket, and a seam the scene calls walled off costs a second of floods to disprove — eight of them ran before every rope swing in one leg. The item-uses come ahead of the seams nothing can reach.
    if (await useSeamToward(dest, log)) {
        return true;
    }
    if (await tryHops(fresh(trailing), dest, from, log, spent)) {
        return true;
    }
    // Why: the way back is the last thing to try, not one candidate among the rest. A pocket with nothing fresh left is a dead end and backing out of it is the only move; a pocket with anything fresh should spend that first, or the route swings between two sides of the same bridge instead of exploring.
    if (back.length > 0) {
        log(`pass: nothing fresh at (${from.x},${from.z}) — backing out over ${back.length} crossing(s) already used`);
    }
    return tryHops(back, dest, from, log, spent);
}

/** A seam crossed by using an item on a loc rather than by an op on it. */
interface UseSeam {
    item: UpassItem;
    locs: readonly number[];
    /** The script deletes the item before it rolls, so its leaving the pack is the one honest signal. */
    consumes: boolean;
    /** Where the crossing puts the player, when that is nowhere near the loc it is used on. */
    landing?: Tile;
    /** The tile the script runs from, where it names one — stand there before the item goes on the loc. */
    stand?: Tile;
    label: string;
}

// Why: two of the seams are item-uses rather than ops, and both are the only way out of their pocket — the swing east off the bridge shelf onto the grid, and the spade dig that is the sole route south out of the slave cages. They belong in the same vocabulary rather than special-cased by a caller that cannot know whether the navigator already got there.
const USE_SEAMS: readonly UseSeam[] = [
    // Why: `@upass_rock_ropeswing` sets `$start_pos = 0_38_151_30_35` — (2462,9699) — and `~forcemove`s the character there before it rolls, then swings them four east to (2466,9699). The forcemove is a server walk: from a pocket that cannot reach that tile it never arrives, and the use reads as a seam that did nothing. Standing there first is what makes the roll the only thing left to fail.
    {
        item: UP_ITEM.ROPE,
        locs: [UP_LOC.ROCKSWING, UP_LOC.ROCKSWING_ANCHOR],
        consumes: true,
        stand: new Tile(2462, 9699, 0),
        landing: new Tile(2466, 9699, 0),
        label: 'rope swing'
    },
    // Why: `[oplocu,upass_mud]` ends in `p_teleport(0_37_150_24_46)`, so the dig lands the player at (2392,9646) — forty tiles nearer the boulder than the mud pile it is used on. Scored by the loc's own tile it reads as one tile of progress, under the gain threshold, and a character standing in the cell with a spade walks away from the only way south.
    { item: UP_ITEM.SPADE, locs: [UP_LOC.MUD_DIG], consumes: false, landing: new Tile(2392, 9646, 0), label: 'mud dig' }
];

async function useSeamToward(dest: Tile, log: (m: string) => void): Promise<boolean> {
    const from = here();
    if (!from) {
        return false;
    }
    // Why: four silent `continue`s stood between a rope in the pack and a swing that never happened, and none of them said which. A seam whose item IS carried is a candidate, so being passed over is worth a word.
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
        // Why: the op-click walks the player to the loc before the use resolves, so "the tile changed" fires
        // on the walk and reports a crossing that never happened.
        const mark = GameMessages.mark();
        const before = held(seam.item.id);
        if (!(await item.useOn(target))) {
            continue;
        }
        // Why: `%upass_rockswing_used` is a five-tick cooldown answered by a `~mesbox`, which holds a main modal open — so the rope never leaves the pack and this waited the full twelve seconds for an item the script had already declined to take. The refusal is in the chatbox on the first tick.
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
        // Why: a failed swing spends the rope and drops the player into the swamp below, so the caller has to
        // see that as no progress rather than as a crossing.
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

// Why: an op-click can only name a loc the client already holds in its build area, and that area follows the player — so a seam at the far side of a pocket is invisible from the near side. The mud pocket's only exit is a ledge eighteen tiles west while its target lies south, so walking "toward the target" never brought it into view and the leg stopped in a room with a door in it. When nothing crosses, the pocket is swept.
// Why: the probe has to land inside the pocket, and a pocket is rarely a square — so each direction is tried at falling distances and the furthest one the scene says is walkable wins.
const SWEEP_STEPS = [20, 14, 9, 5] as const;
const SWEEP_DIRS: readonly [number, number][] = [
    [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]
];

// Why: which platform pocket anything is in cannot be read off the map at runtime, but the navigator can answer "can I walk there" against the full collision pack in a millisecond — so the character's pocket is whichever side tile it can reach, and the target's is whichever side tile can reach the target.
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
        // Why: three different answers that all returned null. "Not on the baked graph" and "already in the target's pocket" want opposite things from the caller, and neither said so.
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

// Why: on the platforms the solved route is the authority, not one candidate among twenty. Letting the obstacle search choose freely there sent a run back and forth across the same two bridges: the step it was serving alternates between the cat and the witch's door, the spent set is keyed by destination, and every switch wiped the memory of which crossings had already been used.
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
    // Why: a compass probe walks where the pocket happens to extend, which in the main cavern is a corridor running the wrong way — eight rounds of it never came within sight of the bridge fifteen tiles north. Walking AT a seam the scene can see but not reach is what carries the build area to it.
    // Why: the client's own flood is not the authority on this — it called the collapsed bridge walled off from twenty-nine tiles away inside the same pocket, which the collision pack says is one walk. So every seam in the scene is walked at, and the budget is the length of that walk rather than a short probe.
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
    // Why: and the crossing that leaves a platform can be a hundred and forty tiles off, well past any scene — so the known bridge placements are walked at too, nearest the target first. The walker refuses the ones in other components in a second each, which is what makes trying them all cheap.
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
 * Why: a plain `walkResilient` is tried first every round, because inside a pocket it is the right tool — the obstacle search only runs once the navigator has said there is no route.
 */

// Why: `spent` has to outlive one call. Each decide cycle starts a fresh `travelTo`, and a seam that led nowhere last cycle is the nearest one again this cycle — which is how a run crossed the same cage door back and forth for four minutes. It is dropped once the destination is reached or changes.
const spentByDest = new Map<string, SpentSides>();

export async function travelTo(dest: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    const destKey = `${dest.x},${dest.z},${dest.level}`;
    if (!spentByDest.has(destKey)) {
        spentByDest.clear();
        spentByDest.set(destKey, new Map<string, Stand[]>());
    }
    const spent = spentByDest.get(destKey)!;
    // Why: once the navigator has said there is no route to this tile, saying it again costs a full walk
    // timeout per obstacle and changes nothing — only crossing one can change the answer.
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
        // Why: a numbered hop is what turns a stalled leg into a readable one — twenty-four of these can run before the cap is hit, and without the count a log that repeats itself looks like a loop that is not advancing when it is, or the reverse.
        log(`pass: hop ${hop + 1}/${MAX_HOPS} at (${at?.x},${at?.z}), d${at ? chebyshev(at, dest) : -1} to go`
            + ` — ${navWorthTrying ? 'walking it first' : 'the pack has no route, crossing instead'}`);
        if (navWorthTrying) {
            if (await Traversal.walkResilient(dest, { radius, attempts: 1, timeoutMs: 60_000, log })) {
                log(`pass: walked the rest of the way to (${dest.x},${dest.z})`);
                return true;
            }
            navWorthTrying = false;
        }
        // Why: the derived route first, and the free search only where it has nothing to say. Every crossing in the pass has a fixed stand and a fixed landing that `tools/nav/upass-areas.ts` reads off the map and the scripts, so the area the character is standing in names the action — no gain threshold, no spent set, no sweep. The search below stays for the legs that are not loc ops at all: the fire arrow, the spiked grid, the orb corridor.
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
        // Why: the platforms first, because their route is solved and the free search is not.
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
        // Why: a crossing only changes the answer when it was the LAST seam, so asking the pack costs a millisecond and saves the nine seconds the walk spends proving it again.
        navWorthTrying = await packRoute(here() ?? at ?? dest, dest);
    }
    log(`pass: STUCK — ${MAX_HOPS} crossings made without reaching (${dest.x},${dest.z}); still at (${here()?.x},${here()?.z}), ${spent.size} seam(s) spent`);
    return false;
}
