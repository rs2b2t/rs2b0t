export const CAPACITY = 16;
export const HOLD_TICKS = 9;
export const SKIRT = 1013;
export const PURE_WALK = { useTeleportCatalog: false, policy: { useTeleports: false } };
export const SHOP_TILE = { x: 3204, z: 3417, level: 0 };
export const MAN_TILE = { x: 3222, z: 3218, level: 0 };
// Frozen WalkTo order: distributed copies must agree even across client updates.
export const DESTINATIONS = [
    ['Lumbridge', 3221, 3218, 3224, 3223],
    ['Varrock', 3213, 3424, 3210, 3422],
    ['Falador', 2965, 3378, 2964, 3377],
    ['Ardougne', 2661, 3301, 2661, 3301],
    ['Rellekka', 2668, 3660, 2668, 3660],
    ['Taverley', 2895, 3435, 2895, 3436],
    ['Draynor', 3093, 3243, 3101, 3237],
    ['Al Kharid', 3269, 3167, 3275, 3161],
    ['Edgeville', 3094, 3493, 3088, 3487],
    ["Seers' Village", 2725, 3491, 2739, 3501],
    ['Catherby', 2809, 3441, 2804, 3435],
    ['Yanille', 2612, 3092, 2604, 3085]
].map(([name, x, z, ax, az]) => ({ name, tile: { x, z, level: 0 }, anchor: { x: ax, z: az, level: 0 } }));
// Centres baked against collision pack SHA256:
// 04ef48054324935f7eca00efa76f9744b77d00a5824d43b7544f067ab4d7715a
// Fixed centres are essential: doors opening during a live search must not split a group.

const plus = [
    [0, 2],
    [2, 0],
    [0, -2],
    [-2, 0],
    [0, 0],
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0]
];
const cross = [
    [2, 2],
    [2, -2],
    [-2, -2],
    [-2, 2],
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
    [0, 0]
];
const filled = [
    [-1, 1],
    [0, 1],
    [1, 1],
    [-1, 0],
    [0, 0],
    [1, 0],
    [-1, -1],
    [0, -1],
    [1, -1]
];
const outline = [
    [-2, 2],
    [2, 2],
    [2, -2],
    [-2, -2],
    [-1, 2],
    [0, 2],
    [1, 2],
    [2, 1],
    [2, 0],
    [2, -1],
    [1, -2],
    [0, -2],
    [-1, -2],
    [-2, -1],
    [-2, 0],
    [-2, 1]
];
const slots = points => Array.from({ length: CAPACITY }, (_, i) => points[i % points.length]);
export const PATTERNS = [slots(plus), slots(cross), slots(filled), outline, slots([[0, 0]])];
export const LABELS = ['Plus', 'Cross', 'Filled 3x3', 'Outlined 5x5', 'Dot'];
export const normalName = name =>
    String(name ?? '')
        .replace(/_/g, ' ')
        .trim()
        .toLowerCase();
const compareName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
export const distance = (a, b) => (!a || !b || a.level !== b.level ? Infinity : Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z)));
export const same = (a, b) => distance(a, b) === 0;
const offset = (a, dx, dz) => ({ x: a.x + dx, z: a.z + dz, level: a.level });
export const stagingTile = a => offset(a, 0, 4);
export const queueTile = a => offset(a, 0, 6);
export const poseTile = (a, phase, rank) => offset(a, ...PATTERNS[phase][rank]);
const inCore = (p, a) => distance(p, a) <= 2 || (p.x === a.x && p.level === a.level && p.z >= a.z + 3 && p.z <= a.z + 4);
const inArea = (p, a) => distance(p, a) <= 8;

/** Existing dancers take precedence; simultaneous newcomers break ties by name.
 * Names assign slots only. No rank has authority or a special timing role.
 */
export function selectMembers(rows, anchor) {
    const unique = new Map();
    for (const row of rows) if (row.name && inArea(row.tile, anchor)) unique.set(normalName(row.name), { ...row, name: normalName(row.name) });
    return [...unique.values()]
        .sort((a, b) => Number(inCore(b.tile, anchor)) - Number(inCore(a.tile, anchor)) || compareName(a, b))
        .slice(0, CAPACITY)
        .sort(compareName);
}

/** Appearance alone never grants membership. Entry is a held 6 -> 5 -> 6 -> 5 -> 6
 * lane gesture. Late observers also recognize dancers holding three successive
 * pattern positions for the same slot. This is behavioral recognition, not identity
 * authentication: someone deliberately copying the protocol can participate.
 */
export class ParticipantTracker {
    constructor(anchor) {
        this.anchor = anchor;
        this.seen = new Map();
    }
    observe(tick, rows, assembling = false) {
        const present = new Set();
        for (const row of rows) {
            const name = normalName(row.name);
            if (!name || !inArea(row.tile, this.anchor)) continue;
            present.add(name);
            let s = this.seen.get(name);
            if (!s) {
                s = { tile: row.tile, since: tick, gesture: 0, proof: [], verified: false };
                this.seen.set(name, s);
            }
            if (!same(s.tile, row.tile)) {
                if (tick - s.since >= 2 && (distance(s.tile, this.anchor) <= 2 || same(s.tile, queueTile(this.anchor)))) s.approach = tick;
                s.tile = row.tile;
                s.since = tick;
                s.recorded = false;
            }
            if (tick - s.since < 2 || s.recorded) continue;
            s.recorded = true;
            // During a real admission barrier, late observers can recognize the
            // deliberate approach-and-wait too, even if they missed an earlier
            // newcomer's lane gesture. Someone already standing here never qualifies.
            if (assembling && s.approach !== undefined && tick - s.approach <= 8 && same(row.tile, stagingTile(this.anchor))) s.verified = true;
            const lane = [6, 5, 6, 5, 6];
            if (same(row.tile, offset(this.anchor, 0, lane[s.gesture]))) s.gesture++;
            else s.gesture = same(row.tile, queueTile(this.anchor)) ? 1 : 0;
            if (s.gesture === lane.length) {
                s.verified = true;
                s.gesture = 1;
            }
            if (distance(row.tile, this.anchor) <= 2) {
                s.proof.push([row.tile.x - this.anchor.x, row.tile.z - this.anchor.z]);
                s.proof = s.proof.slice(-3);
                if (
                    s.proof.length === 3 &&
                    PATTERNS.some((_, phase) =>
                        Array.from({ length: CAPACITY }, (_, rank) => rank).some(rank => s.proof.every((p, i) => p[0] === PATTERNS[(phase + i) % PATTERNS.length][rank][0] && p[1] === PATTERNS[(phase + i) % PATTERNS.length][rank][1]))
                    )
                )
                    s.verified = true;
            }
        }
        for (const name of this.seen.keys()) if (!present.has(name)) this.seen.delete(name);
        return rows.filter(p => this.seen.get(normalName(p.name))?.verified).map(p => ({ ...p, name: normalName(p.name) }));
    }
}

/** Independent peers retain their roster until a cycle boundary or real failure.
 * The physical assembly barrier is used for startup, batched joins and recovery.
 */
export class FormationPeer {
    constructor(name, anchor) {
        this.name = normalName(name);
        this.anchor = anchor;
        this.roster = [];
        this.tracker = new ParticipantTracker(anchor);
        this.joined = false;
        this.created = null;
        this.gesture = 0;
        this.gestureSince = null;
        this.assemblySince = null;
        this.missingSince = null;
        this.completed = 0;
        this.phase = -1;
        this.since = null;
        this.lastTick = null;
        this.entered = 0;
        this.resetCount = 0;
    }
    reset(tick) {
        this.phase = -1;
        this.since = null;
        this.entered = tick;
        this.assemblySince = null;
        this.resetCount++;
    }
    advance(tick) {
        this.phase = (this.phase + 1) % PATTERNS.length;
        this.since = null;
        this.entered = tick;
    }
    step(tick, rows) {
        const gap = this.lastTick !== null && tick - this.lastTick !== 1;
        if (tick === this.lastTick) return { ...this.output, fresh: false };
        this.lastTick = tick;
        if (this.created === null) this.created = tick;
        rows = rows.filter(p => inArea(p.tile, this.anchor)).map(p => ({ ...p, name: normalName(p.name) }));
        const verified = this.tracker.observe(tick, rows, this.phase === -1 && (this.joined || this.gesture >= 5));
        const here = rows.find(p => p.name === this.name)?.tile;
        if (!here) return { fresh: true, overflow: true, members: [] };
        const assembly = stagingTile(this.anchor);
        const waiting = target => {
            this.output = { fresh: true, overflow: false, waiting: true, target, phase: -1, rank: -1, members: [], holding: false, heldTicks: 0, completed: this.completed };
            return this.output;
        };
        if (!this.joined) {
            const lane = [6, 5, 6, 5, 6];
            if (this.gesture < lane.length) {
                const target = offset(this.anchor, 0, lane[this.gesture]);
                if (!same(here, target)) this.gestureSince = null;
                else if (this.gestureSince === null) this.gestureSince = tick;
                else if (tick - this.gestureSince >= 3) {
                    this.gesture++;
                    this.gestureSince = null;
                }
                return waiting(this.gesture < lane.length ? offset(this.anchor, 0, lane[this.gesture]) : queueTile(this.anchor));
            }
            const active = verified.filter(p => p.name !== this.name && inCore(p.tile, this.anchor));
            if (active.length >= CAPACITY) return { fresh: true, overflow: true, members: active };
            const inviting = active.some(p => same(p.tile, assembly));
            // Allow enough observation to recognize a running group before starting
            // a new one. A stationary bystander eventually fails this check.
            const corePresent = rows.some(p => p.name !== this.name && distance(p.tile, this.anchor) <= 2);
            const observing = tick - this.created < (corePresent ? 100 : 24);
            if (!inviting && (active.length || observing)) return waiting(queueTile(this.anchor));
            const selected = selectMembers(verified, this.anchor);
            if (!selected.some(p => p.name === this.name)) return { fresh: true, overflow: true, members: selected };
            this.joined = true;
            this.roster = selected.map(p => p.name);
            this.reset(tick);
        }
        if (gap) this.reset(tick);
        let members = this.roster.map(name => rows.find(p => p.name === name)).filter(Boolean);
        if (members.length !== this.roster.length) {
            if (this.missingSince === null) this.missingSince = tick;
            if (tick - this.missingSince >= 3) {
                this.roster = members.map(p => p.name);
                this.missingSince = null;
                this.reset(tick);
            } else return waiting(here);
        } else this.missingSince = null;
        if (this.phase === -1) {
            const candidates = selectMembers([...verified, ...members], this.anchor);
            const names = candidates.map(p => p.name);
            if (names.join('|') !== this.roster.join('|')) {
                this.roster = names;
                this.assemblySince = null;
            }
            members = candidates;
        }
        const rank = members.findIndex(p => p.name === this.name);
        if (rank < 0) return { fresh: true, overflow: true, members };
        const allAssembly = members.every(p => same(p.tile, assembly));
        // Ignore the tail of the initial departure only while PLUS is assembling.
        // Any peer, regardless of rank, can request a reset by visiting assembly.
        if (this.phase >= 0 && members.some(p => same(p.tile, assembly)) && !(this.phase === 0 && this.since === null && tick - this.entered <= 10)) this.reset(tick);

        if (this.phase === -1) {
            // Time the shared physical barrier, not each account's join time.
            if (allAssembly) {
                if (this.assemblySince === null) this.assemblySince = tick;
                if (tick - this.assemblySince >= 6) this.advance(tick);
            } else if (this.assemblySince !== null && tick - this.assemblySince >= 5) this.advance(tick);
            else this.assemblySince = null;
        } else {
            const allArrived = members.every((p, i) => same(p.tile, poseTile(this.anchor, this.phase, i)));
            if (allArrived) {
                if (this.since === null) this.since = tick;
                if (tick - this.since >= HOLD_TICKS) {
                    this.completed++;
                    const pending = verified.some(p => !this.roster.includes(p.name) && same(p.tile, queueTile(this.anchor)));
                    if (this.phase === PATTERNS.length - 1 && pending && this.roster.length < CAPACITY) {
                        this.reset(tick);
                    } else this.advance(tick);
                }
            } else if (this.since !== null) {
                // A delayed observer catches an already started transition by any
                // peer. This is not a leader election or a majority-name choice.
                const next = (this.phase + 1) % PATTERNS.length;
                if (tick - this.since >= HOLD_TICKS - 1 && members.some((p, i) => !same(poseTile(this.anchor, this.phase, i), poseTile(this.anchor, next, i)) && same(p.tile, poseTile(this.anchor, next, i)))) {
                    this.completed++;
                    this.advance(tick);
                } else this.since = null;
            }
            if (tick - this.entered > 60) this.reset(tick);
        }
        const target = this.phase < 0 ? assembly : poseTile(this.anchor, this.phase, rank);
        this.output = { fresh: true, overflow: false, target, phase: this.phase, rank, members, completed: this.completed, holding: this.since !== null, heldTicks: this.since === null ? 0 : tick - this.since };
        return this.output;
    }
}

/** Deterministic nearest open 5x5 square plus a narrow assembly/entry lane.
 * Check edges as well as floor: walkable tiles can have walls between them.
 */
export function findAnchor(destination, walkable, canStep) {
    for (let radius = 0; radius <= 14; radius++) {
        for (let dz = -radius; dz <= radius; dz++)
            for (let dx = -radius; dx <= radius; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
                const a = offset(destination, dx, dz);
                if (validFloor(a, walkable, canStep)) return a;
            }
    }
    return null;
}

export function validFloor(a, walkable, canStep) {
    const tiles = [];
    for (let z = -2; z <= 2; z++) for (let x = -2; x <= 2; x++) tiles.push(offset(a, x, z));
    for (let z = 3; z <= 6; z++) tiles.push(offset(a, 0, z));
    return tiles.every(walkable) && tiles.every(t => tiles.every(u => distance(t, u) !== 1 || canStep(t, u)));
}

/** One tile per server update, independent of run energy and auto-run settings. */
export function nextStep(here, target, anchor) {
    if (same(here, target)) return here;
    // All assembly traffic uses the tested central lane above the square.
    if (here.z > anchor.z + 2) return offset(here, Math.sign(anchor.x - here.x), here.x === anchor.x ? Math.sign(target.z - here.z) : 0);
    if (target.z > anchor.z + 2) return offset(here, Math.sign(anchor.x - here.x), here.x === anchor.x ? 1 : Math.sign(anchor.z + 2 - here.z));
    return offset(here, Math.sign(target.x - here.x), Math.sign(target.z - here.z));
}
