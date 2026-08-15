/**
 * Pure decisions for Brimhaven Agility Arena (tag pillars for tickets).
 * Platform graph + level-gated edges come from rev-274 content map m43_149.
 */

export const BOAT_FARE = 30;
export const ENTRANCE_FEE = 200;
/** Coins kept for Ardougne↔Brimhaven both ways + first-time entrance. */
export const TRIP_COINS = BOAT_FARE * 2 + ENTRANCE_FEE;
export const DEFAULT_FOOD_PER_TRIP = 25;
export const DEFAULT_BANK_TICKETS = 1000;
export const EAT_AT_HP = 5;
export const TICKET_NAME = 'Agility arena ticket';
export const ARENA_VARP = 309; // agilityarena_varbit
const PAID_BIT = 1;
const PILLAR_TAGGED_BIT = 0;

// Why: once on this footprint the outbound boat is paid, so only the return fare plus any unpaid entrance remains.
// Why: charging TRIP_COINS here funds both legs again and loops the bot between bank and boat.

/** Rough surface Karamja / Brimhaven footprint, ship landing through arena entrance. */
export function onBrimhavenSurface(x: number, z: number, level: number): boolean {
    return level === 0 && x >= 2740 && x <= 2960 && z >= 3130 && z <= 3280;
}

// Why: indices 0–23 match the server ticket-pillar enum.
// Why: index 24 is the SE ladder landing where Climb-Down drops you, and it carries no ticket dispenser.

/** Absolute world tiles of arena platforms (level 3). */
export const PILLARS: ReadonlyArray<{ x: number; z: number }> = [
    { x: 2761, z: 9546 },
    { x: 2772, z: 9546 },
    { x: 2783, z: 9546 },
    { x: 2794, z: 9546 },
    { x: 2805, z: 9546 },
    { x: 2761, z: 9557 },
    { x: 2772, z: 9557 },
    { x: 2783, z: 9557 },
    { x: 2794, z: 9557 },
    { x: 2805, z: 9557 },
    { x: 2761, z: 9568 },
    { x: 2772, z: 9568 },
    { x: 2783, z: 9568 },
    { x: 2794, z: 9568 },
    { x: 2805, z: 9568 },
    { x: 2761, z: 9579 },
    { x: 2772, z: 9579 },
    { x: 2783, z: 9579 },
    { x: 2794, z: 9579 },
    { x: 2805, z: 9579 },
    { x: 2761, z: 9590 },
    { x: 2772, z: 9590 },
    { x: 2783, z: 9590 },
    { x: 2794, z: 9590 },
    { x: 2805, z: 9590 } // 24 — ladder landing (no dispenser)
];

/** Server ticket enum is 0–23 only. */
const TICKET_PILLAR_COUNT = 24;
interface ArenaPoint {
    x: number;
    z: number;
}

interface ArenaAxis {
    dx: -1 | 0 | 1;
    dz: -1 | 0 | 1;
}

/** Furthest we search around an obstacle's ideal from-side stand tile. */
const OBSTACLE_APPROACH_RADIUS = 3;

/** Cardinal direction of travel from one platform to an adjacent platform. */
export function obstacleAxis(from: number, to: number): ArenaAxis | null {
    const source = PILLARS[from];
    const destination = PILLARS[to];
    if (!source || !destination) {
        return null;
    }

    const dx = Math.sign(destination.x - source.x) as -1 | 0 | 1;
    const dz = Math.sign(destination.z - source.z) as -1 | 0 | 1;
    // Arena edges are cardinal. Reject an invalid same-tile or diagonal pair so
    // callers never stage on an arbitrary side of an obstacle.
    if ((dx === 0) === (dz === 0)) {
        return null;
    }
    return { dx, dz };
}

// Why: the server's obstacle scripts key off these directional start tiles, not any tile that snaps to the same logical platform.

/** Ideal interaction stand: two tiles from the loc, toward the source platform. */
export function edgeApproachPoint(from: number, to: number, loc: ArenaPoint): ArenaPoint | null {
    const axis = obstacleAxis(from, to);
    if (!axis) {
        return null;
    }
    return {
        x: loc.x - axis.dx * 2,
        z: loc.z - axis.dz * 2
    };
}

// Why: candidates stay within three tiles of the ideal stand, on the source platform, and strictly on the source side of the loc.
// Why: the ideal tile comes first, and equal-radius alternatives prefer lateral movement before changing the distance along the obstacle axis.

/** Deterministic stand candidates for a live collision/reachability filter. */
export function edgeApproachCandidates(
    from: number,
    to: number,
    loc: ArenaPoint,
    radius = OBSTACLE_APPROACH_RADIUS
): ArenaPoint[] {
    const axis = obstacleAxis(from, to);
    const ideal = edgeApproachPoint(from, to, loc);
    if (!axis || !ideal) {
        return [];
    }

    const searchRadius = Math.max(0, Math.min(OBSTACLE_APPROACH_RADIUS, Math.floor(radius)));
    const offsets: Array<{ ox: number; oz: number }> = [];
    for (let ox = -searchRadius; ox <= searchRadius; ox++) {
        for (let oz = -searchRadius; oz <= searchRadius; oz++) {
            offsets.push({ ox, oz });
        }
    }
    offsets.sort((a, b) => {
        const radiusA = Math.max(Math.abs(a.ox), Math.abs(a.oz));
        const radiusB = Math.max(Math.abs(b.ox), Math.abs(b.oz));
        if (radiusA !== radiusB) {
            return radiusA - radiusB;
        }
        const axialA = a.ox * axis.dx + a.oz * axis.dz;
        const axialB = b.ox * axis.dx + b.oz * axis.dz;
        if (Math.abs(axialA) !== Math.abs(axialB)) {
            return Math.abs(axialA) - Math.abs(axialB);
        }
        const lateralA = a.ox * -axis.dz + a.oz * axis.dx;
        const lateralB = b.ox * -axis.dz + b.oz * axis.dx;
        if (lateralA !== lateralB) {
            return lateralA - lateralB;
        }
        if (axialA !== axialB) {
            return axialA - axialB;
        }
        return a.ox - b.ox || a.oz - b.oz;
    });

    const candidates: ArenaPoint[] = [];
    for (const { ox, oz } of offsets) {
        const candidate = { x: ideal.x + ox, z: ideal.z + oz };
        const sourceSide =
            (candidate.x - loc.x) * axis.dx + (candidate.z - loc.z) * axis.dz < 0;
        if (sourceSide && platformAt(candidate.x, candidate.z) === from) {
            candidates.push(candidate);
        }
    }
    return candidates;
}

type ObstacleKind =
    | 'ledge'
    | 'pillar'
    | 'monkey'
    | 'spikes'
    | 'handholds'
    | 'blade'
    | 'rope'
    | 'log'
    | 'plank'
    | 'saws'
    | 'wall'
    | 'pressure'
    | 'swing'
    | 'darts';

type EdgeMode = 'interact' | 'walk';

export interface ArenaEdge {
    a: number;
    b: number;
    kind: ObstacleKind;
    /** Minimum agility to use this edge without guaranteed fail. */
    minLevel: number;
    mode: EdgeMode;
    /** Loc display name for interact edges. */
    locName?: string;
    op?: string;
}

/**
 * Bidirectional edges between platform indices. Built from m43_149 loc placement
 * + zone trap scripts (spikes 20, pressure 20, saws 40, darts 40, handholds 20).
 */
export const ARENA_EDGES: readonly ArenaEdge[] = [
    { a: 0, b: 1, kind: 'ledge', minLevel: 1, mode: 'interact', locName: 'Balancing ledge', op: 'Walk-across' },
    { a: 0, b: 5, kind: 'pillar', minLevel: 1, mode: 'interact', locName: 'Pillar', op: 'Jump-on' },
    { a: 1, b: 2, kind: 'monkey', minLevel: 1, mode: 'interact', locName: 'Monkey bars', op: 'Swing-across' },
    { a: 1, b: 6, kind: 'spikes', minLevel: 20, mode: 'walk' },
    { a: 2, b: 3, kind: 'handholds', minLevel: 20, mode: 'interact', locName: 'Hand holds', op: 'Climb-across' },
    { a: 2, b: 7, kind: 'blade', minLevel: 1, mode: 'walk' },
    { a: 3, b: 4, kind: 'ledge', minLevel: 1, mode: 'interact', locName: 'Balancing ledge', op: 'Walk-across' },
    { a: 3, b: 8, kind: 'rope', minLevel: 1, mode: 'interact', locName: 'Balancing rope', op: 'Walk-on' },
    { a: 4, b: 9, kind: 'log', minLevel: 1, mode: 'interact', locName: 'Log balance', op: 'Walk-on' },
    { a: 5, b: 6, kind: 'plank', minLevel: 1, mode: 'interact', locName: 'Plank', op: 'Walk-on' },
    { a: 5, b: 10, kind: 'handholds', minLevel: 20, mode: 'interact', locName: 'Hand holds', op: 'Climb-across' },
    { a: 6, b: 7, kind: 'saws', minLevel: 40, mode: 'walk' },
    { a: 6, b: 11, kind: 'rope', minLevel: 1, mode: 'interact', locName: 'Balancing rope', op: 'Walk-on' },
    { a: 7, b: 12, kind: 'wall', minLevel: 1, mode: 'interact', locName: 'Low wall', op: 'Climb-over' },
    { a: 8, b: 9, kind: 'pressure', minLevel: 20, mode: 'walk' },
    { a: 8, b: 13, kind: 'monkey', minLevel: 1, mode: 'interact', locName: 'Monkey bars', op: 'Swing-across' },
    { a: 9, b: 14, kind: 'wall', minLevel: 1, mode: 'interact', locName: 'Low wall', op: 'Climb-over' },
    { a: 10, b: 11, kind: 'swing', minLevel: 1, mode: 'interact', locName: 'Rope swing', op: 'Swing-on' },
    { a: 10, b: 15, kind: 'spikes', minLevel: 20, mode: 'walk' },
    { a: 11, b: 16, kind: 'monkey', minLevel: 1, mode: 'interact', locName: 'Monkey bars', op: 'Swing-across' },
    { a: 12, b: 13, kind: 'pillar', minLevel: 1, mode: 'interact', locName: 'Pillar', op: 'Jump-on' },
    { a: 12, b: 17, kind: 'saws', minLevel: 40, mode: 'walk' },
    { a: 13, b: 14, kind: 'spikes', minLevel: 20, mode: 'walk' },
    { a: 13, b: 18, kind: 'darts', minLevel: 40, mode: 'walk' },
    { a: 14, b: 19, kind: 'pillar', minLevel: 1, mode: 'interact', locName: 'Pillar', op: 'Jump-on' },
    { a: 15, b: 16, kind: 'log', minLevel: 1, mode: 'interact', locName: 'Log balance', op: 'Walk-on' },
    { a: 15, b: 20, kind: 'blade', minLevel: 1, mode: 'walk' },
    { a: 16, b: 17, kind: 'saws', minLevel: 40, mode: 'walk' },
    { a: 16, b: 21, kind: 'pressure', minLevel: 20, mode: 'walk' },
    { a: 17, b: 18, kind: 'blade', minLevel: 1, mode: 'walk' },
    { a: 17, b: 22, kind: 'rope', minLevel: 1, mode: 'interact', locName: 'Balancing rope', op: 'Walk-on' },
    { a: 18, b: 19, kind: 'pressure', minLevel: 20, mode: 'walk' },
    { a: 18, b: 23, kind: 'log', minLevel: 1, mode: 'interact', locName: 'Log balance', op: 'Walk-on' },
    { a: 20, b: 21, kind: 'ledge', minLevel: 1, mode: 'interact', locName: 'Balancing ledge', op: 'Walk-across' },
    { a: 21, b: 22, kind: 'wall', minLevel: 1, mode: 'interact', locName: 'Low wall', op: 'Climb-over' },
    { a: 22, b: 23, kind: 'handholds', minLevel: 20, mode: 'interact', locName: 'Hand holds', op: 'Climb-across' },
    // SE ladder landing → ticket grid (rope-swing south onto platform 19).
    { a: 24, b: 19, kind: 'swing', minLevel: 1, mode: 'interact', locName: 'Rope swing', op: 'Swing-on' },
    // Fallback if the swing is awkward — planks west onto platform 23 (broken tiles possible).
    { a: 24, b: 23, kind: 'plank', minLevel: 1, mode: 'interact', locName: 'Plank', op: 'Walk-on' }
];

/** Spike trap between platforms 13↔14 — centre-ish grind while waiting. */
export const SPIKE_EDGE: ArenaEdge = ARENA_EDGES.find(e => e.a === 13 && e.b === 14)!;
export const SPIKE_PLATFORMS = [13, 14] as const;
export const CENTRE_PLATFORM = 12;

export const ARDY_BANK = { x: 2655, z: 3283, level: 0 };
export const ARENA_ENTRANCE = { x: 2809, z: 3194, level: 0 };
export const LADDER_DOWN_STAND = { x: 2809, z: 3194, level: 0 };

function bitSet(varp: number, bit: number): boolean {
    return ((varp >>> bit) & 1) === 1;
}

export function hasPaid(varp: number): boolean {
    return bitSet(varp, PAID_BIT);
}

export function pillarTagged(varp: number): boolean {
    return bitSet(varp, PILLAR_TAGGED_BIT);
}

// Why: at Ardougne or leaving the bank, both boat legs plus the entrance if unpaid are still owed.
// Why: on the Brimhaven surface the outbound boat is spent, leaving the return leg plus the entrance if unpaid.
// Why: without the split, the 230gp left after the 30gp ship reads as underfunded against 260 and the bot banks instead of entering.

/** Coins still required for the rest of the trip. */
export function coinsNeeded(alreadyPaid: boolean, outboundBoatDone = false): number {
    const boatLegs = outboundBoatDone ? 1 : 2;
    const boats = BOAT_FARE * boatLegs;
    return alreadyPaid ? boats : boats + ENTRANCE_FEE;
}

/**
 * Withdraw this many coins at Ardougne bank so a full round-trip is funded
 * from the mainland (always 2 boat legs + entrance if needed).
 */
export function coinsToWithdraw(alreadyPaid: boolean, coinsInPack: number): number {
    const need = coinsNeeded(alreadyPaid, false);
    return Math.max(0, need - coinsInPack);
}

export function shouldBank(tickets: number, foodCount: number, bankAtTickets: number): boolean {
    return foodCount <= 0 || tickets >= bankAtTickets;
}

/** Inventory fields used to distinguish a live stack gain from a removal. */
interface TicketInventoryChange {
    id: number;
    name: string | null;
    count: number;
    previousId: number;
    previousCount: number;
}

/** Tickets newly entering the pack outside a bank interface. */
export function ticketInventoryGain(change: TicketInventoryChange, bankOpen: boolean): number {
    if (bankOpen || change.id === -1 || change.name !== TICKET_NAME) {
        return 0;
    }
    return change.previousId !== change.id
        ? Math.max(1, change.count)
        : Math.max(0, change.count - change.previousCount);
}

// Why: the bank trip is triggered by these shortfalls, so anything still missing when it finishes sends the next loop back to the bank for the same reason.
// Why: the caller stops on a non-null result rather than spinning the bank open and shut when the account ran out of lobsters.

/** What the bank could not supply after a restock, or null when the trip is funded. */
export function restockShortfall(s: {
    food: string;
    foodInPack: number;
    foodPerTrip: number;
    coins: number;
    alreadyPaid: boolean;
}): string | null {
    if (s.foodInPack < s.foodPerTrip) {
        return `out of ${s.food} — only ${s.foodInPack} in the pack after restocking, need ${s.foodPerTrip} per trip. Bank more ${s.food} (or lower "Food per trip") and restart.`;
    }
    const need = coinsNeeded(s.alreadyPaid, false);
    if (s.coins < need) {
        return `out of coins — only ${s.coins} after restocking, need ${need} for the boats${s.alreadyPaid ? '' : ' + arena entrance'}. Bank more coins and restart.`;
    }
    return null;
}

/** Whether low coins alone should force a bank run (location-aware). */
export function needsCoinsRestock(coins: number, alreadyPaid: boolean, atBrimhaven: boolean): boolean {
    return coins < coinsNeeded(alreadyPaid, atBrimhaven);
}

export function shouldEat(hp: number, foodCount: number, eatAt = EAT_AT_HP): boolean {
    return hp > 0 && hp < eatAt && foodCount > 0;
}

/** Nearest platform index for a world tile, or -1 if nowhere near the arena grid. */
export function platformAt(x: number, z: number, maxDist = 6): number {
    let best = -1;
    let bestD = maxDist + 1;
    for (let i = 0; i < PILLARS.length; i++) {
        const p = PILLARS[i];
        const d = Math.max(Math.abs(p.x - x), Math.abs(p.z - z));
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    }
    return best;
}

/** Match a hint arrow tile to a ticket pillar index (0–23), never the landing. */
export function pillarFromHint(hx: number, hz: number): number {
    const p = platformAt(hx, hz, 3);
    return p >= 0 && p < TICKET_PILLAR_COUNT ? p : -1;
}

// Why: the arena occupies the dedicated m43_149 content map square.
// Why: checking the complete square keeps unrelated upper floors and dungeons from matching on plane or z alone.

/** True when the tile falls inside the arena map square. */
export function inArena(x: number, z: number): boolean {
    return x >= 2752 && x <= 2815 && z >= 9536 && z <= 9599;
}

/** True when standing on the ticket platforms (plane 3), not the fall pit below. */
export function onArenaPlatform(level: number): boolean {
    return level >= 3;
}

// Why: a failed obstacle drops the player to plane 0 under the same (x,z) — user report 2802,9590,0.
// Why: pillars still snap by x/z but edge locs exist only on plane 3, so the caller climbs the rope before pathing.

/** True when the player is under the arena rather than on its platforms. */
export function inArenaPit(x: number, z: number, level: number): boolean {
    return inArena(x, z) && level < 3;
}

// Why: 'fallen' is the plane-0 pit, so the caller climbs the rope next.
// Why: 'arrived' is the destination pillar, and a residual anim is fine because the next hop can queue.
// Why: 'elsewhere' left the start pillar for a different platform, which counts as partial progress.
// Why: 'pending' is still mid-attempt, and soft fails need multi-tick idle confirmation in the waiter.

/** Whether an obstacle interact releases control for the next hop. */
type ObstacleOutcome = 'arrived' | 'fallen' | 'elsewhere' | 'pending';

export function obstacleOutcome(
    platform: number,
    from: number,
    to: number,
    inPit: boolean,
    _animating: boolean
): ObstacleOutcome {
    if (inPit) {
        return 'fallen';
    }
    // Landed = done. Residual get-up anims must not hold the next hop.
    if (platform === to) {
        return 'arrived';
    }
    if (platform >= 0 && platform !== from) {
        return 'elsewhere';
    }
    return 'pending';
}

/**
 * Safe to start the next hop. Only the pit blocks — residual landing anims are
 * clickable, and re-click loops handle ignored packets.
 */
export function canStartObstacle(_animating: boolean, inPit: boolean): boolean {
    return !inPit;
}

/** Manhattan tile distance between two arena platforms (for hop tie-breaks). */
function platformGeoDist(a: number, b: number): number {
    const pa = PILLARS[a];
    const pb = PILLARS[b];
    if (!pa || !pb) {
        return 9999;
    }
    return Math.abs(pa.x - pb.x) + Math.abs(pa.z - pb.z);
}

export function usableEdges(agility: number): ArenaEdge[] {
    return ARENA_EDGES.filter(e => agility >= e.minLevel);
}

function arenaAdj(agility: number): Map<number, number[]> {
    const adj = new Map<number, number[]>();
    for (const e of usableEdges(agility)) {
        if (!adj.has(e.a)) {
            adj.set(e.a, []);
        }
        if (!adj.has(e.b)) {
            adj.set(e.b, []);
        }
        adj.get(e.a)!.push(e.b);
        adj.get(e.b)!.push(e.a);
    }
    return adj;
}

/** BFS hop-distance from `src` to every reachable platform. */
function hopDistFrom(src: number, adj: Map<number, number[]>): Map<number, number> {
    const dist = new Map<number, number>();
    const q = [src];
    dist.set(src, 0);
    while (q.length > 0) {
        const cur = q.shift()!;
        const d = dist.get(cur)!;
        for (const n of adj.get(cur) ?? []) {
            if (dist.has(n)) {
                continue;
            }
            dist.set(n, d + 1);
            q.push(n);
        }
    }
    return dist;
}

// Why: among equal-hop routes each step prefers the neighbour geographically closer to `to`, so BFS insertion order cannot send it the long way round the grid.

/** Shortest hop path from `from` to `to`. */
export function pathPlatforms(from: number, to: number, agility: number): number[] | null {
    if (from < 0 || to < 0 || from >= PILLARS.length || to >= PILLARS.length) {
        return null;
    }
    if (from === to) {
        return [];
    }
    const adj = arenaAdj(agility);
    const rem = hopDistFrom(to, adj);
    if (!rem.has(from)) {
        return null;
    }
    const path: number[] = [];
    let cur = from;
    const total = rem.get(from)!;
    for (let step = 0; step < total; step++) {
        const need = rem.get(cur)! - 1;
        const opts = (adj.get(cur) ?? []).filter(n => rem.get(n) === need);
        if (opts.length === 0) {
            return null;
        }
        opts.sort((a, b) => {
            const ga = platformGeoDist(a, to);
            const gb = platformGeoDist(b, to);
            if (ga !== gb) {
                return ga - gb;
            }
            return a - b;
        });
        cur = opts[0];
        path.push(cur);
    }
    return path;
}

/** Whether this hop is a chase toward a ticket pillar (run) vs centre/spikes (walk). */
export function wantRunForGoal(chasingTag: boolean): boolean {
    return chasingTag;
}

export function edgeBetween(a: number, b: number, agility: number): ArenaEdge | null {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return usableEdges(agility).find(e => Math.min(e.a, e.b) === lo && Math.max(e.a, e.b) === hi) ?? null;
}

/** Next hop platform toward `goal`, or null if stuck/arrived. */
export function nextHop(from: number, goal: number, agility: number): number | null {
    const path = pathPlatforms(from, goal, agility);
    if (path === null) {
        return null;
    }
    return path[0] ?? null;
}

/**
 * Where to idle between tags: prefer spike platforms when agility ≥ 20,
 * otherwise the geometric centre platform.
 */
export function waitPlatform(agility: number, here: number): number {
    if (agility >= 20) {
        // Prefer the nearer of the two spike platforms so we don't cross half the map.
        const d13 = pathPlatforms(here, 13, agility)?.length ?? 99;
        const d14 = pathPlatforms(here, 14, agility)?.length ?? 99;
        return d13 <= d14 ? 13 : 14;
    }
    return CENTRE_PLATFORM;
}

/** Inventory keep list when depositing: food name forms + coins. */
export function keepOnDeposit(food: string): string[] {
    return ['Coins', food];
}
