import { EventSignal } from '../../../execution/EventSignal.js';
import { Execution } from '../../../execution/Execution.js';
import { Game } from '../../../game/Game.js';
import { GroundItems } from '../../../grounditems/GroundItems.js';
import { Inventory } from '../../../inventory/Inventory.js';
import { Npcs, type Npc } from '../../../npcs/Npcs.js';
import { Reachability } from '../../../../event/webwalk/geometry/Reachability.js';
import { Sustain } from '../../../sustain/Sustain.js';
import { Traversal } from '../../../walking/Traversal.js';
import type { GroundItem } from '../../../model/GroundItem.js';
import Tile from '../../../../geometry/Tile.js';
import { QUESTS } from '../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import type { NpcStop } from '../exec/primitives.js';

interface ImpBead {
    name: string;
    id: number;
}

export const IMP_BEADS: readonly ImpBead[] = [
    { name: 'Red bead', id: 1470 },
    { name: 'Yellow bead', id: 1472 },
    { name: 'Black bead', id: 1474 },
    { name: 'White bead', id: 1476 }
];

const DRAYNOR_BANK = new Tile(3093, 3243, 0);

// Why: the polite line is preferred first because Mizgog's third option ends with the string "Give me a quest!", and a substring match would hand that sarcastic branch the quest-start click.
export const MIZGOG: NpcStop = {
    npc: 'Wizard Mizgog',
    anchor: new Tile(3103, 3163, 2),
    leash: 6,
    prefer: ['Give me a quest please.', 'Give me a quest!']
};

/** The eight Karamja volcano imp spawns, from the map squares, in ring order. */
export const IMP_SPAWNS: readonly Tile[] = [
    new Tile(2832, 3170, 0),
    new Tile(2832, 3177, 0),
    new Tile(2837, 3184, 0),
    new Tile(2849, 3186, 0),
    new Tile(2857, 3179, 0),
    new Tile(2859, 3177, 0),
    new Tile(2850, 3165, 0),
    new Tile(2841, 3163, 0)
];

const FIELD_LEVEL = 0;

/** Close enough to a spawn to count as standing on it and move round the ring. */
const PATROL_ARRIVED = 4;

// Why: two spawns sit two tiles apart, and walking between them is a no-op the arrival radius already satisfies, so the ring keeps only stops worth a walk.

/** The spawns walked between, one per cluster. */
export const PATROL_RING: readonly Tile[] = IMP_SPAWNS.reduce<Tile[]>(
    (kept, spawn) => (kept.every(stop => stop.distanceTo(spawn) > PATROL_ARRIVED) ? [...kept, spawn] : kept),
    []
);

// Why: the bank is a sea crossing away, so anything the bot has to fetch must be fetched before it boards.

/** Karamja and the water around it: the ground with no bank on it. */
export const KARAMJA = { minX: 2740, maxX: 2970, minZ: 3020, maxZ: 3230 };

const SHIP_FARE = 30;
/** Withdrawn in one go, so a fare paid mid-quest never triggers another bank trip. */
const COIN_RESERVE = 200;
const COIN_FLOOR = SHIP_FARE * 2;

// Why: `wanderrange=27` plus a `map_findsquare(npc_coord, 0, 20)` teleport puts an imp anywhere in this box, and one outside it belongs to a different spawn cluster.

/** The ground an imp from these spawns can be standing on. */
export const IMP_FIELD = { minX: 2810, maxX: 2885, minZ: 3140, maxZ: 3210 };

const IMP = 'Imp';
/** The client streams a 104-tile scene, so this is most of what it can see. */
const SEARCH_RADIUS = 50;
const BEAD_RADIUS = 30;
const ENGAGE_RADIUS = 6;
/** Past this the imp teleported out of the fight rather than moved. */
const LOST_RADIUS = 12;
/** Scene-BFS budget: enough open ground to answer for anything inside `SEARCH_RADIUS`. */
const REACH_STEPS = 20_000;
// Why: only two of the eight mapped spawns put an imp inside the ring, and each respawns 100 ticks after it dies, so leaving the spot costs more than waiting on it.

/** How long to wait on a respawn where imps have been before walking on. */
const RESPAWN_HOLD_MS = 40_000;
const KILL_MS = 30_000;
const TAKE_MS = 6000;
/** A walk onto Karamja crosses the Port Sarim ship, so it needs far longer than a mainland leg. */
const BOAT_WALK_MS = 300_000;

function heldCount(snap: QuestSnapshot, bead: ImpBead): number {
    if (snap.invIds !== undefined && snap.invIds.size > 0) {
        return snap.invIds.get(bead.id) ?? 0;
    }
    return snap.inv.get(bead.name.toLowerCase()) ?? 0;
}

function bankedCount(snap: QuestSnapshot, bead: ImpBead): number {
    if (snap.bankIds !== undefined && snap.bankIds.size > 0) {
        return snap.bankIds.get(bead.id) ?? 0;
    }
    return snap.bank?.get(bead.name.toLowerCase()) ?? 0;
}

function missingBeads(snap: QuestSnapshot): ImpBead[] {
    return IMP_BEADS.filter(bead => heldCount(snap, bead) === 0);
}

function inField(tile: { x: number; z: number; level: number }): boolean {
    return tile.level === FIELD_LEVEL
        && tile.x >= IMP_FIELD.minX && tile.x <= IMP_FIELD.maxX
        && tile.z >= IMP_FIELD.minZ && tile.z <= IMP_FIELD.maxZ;
}

// Why: two of the eight spawns sit two tiles apart, and a walk whose arrival radius already covers the target returns at once without moving, so an advance that lands on one of those never leaves the other and the watchdog parks the quest.

/** The next spawn to stand at: the nearest from off the ring, the next one worth walking to from on it. */
export function nextPatrolTarget(here: { x: number; z: number; level: number } | null | undefined): Tile {
    if (!here) {
        return PATROL_RING[0];
    }
    let nearest = 0;
    for (let i = 1; i < PATROL_RING.length; i++) {
        if (PATROL_RING[i].distanceTo(here) < PATROL_RING[nearest].distanceTo(here)) {
            nearest = i;
        }
    }
    if (PATROL_RING[nearest].distanceTo(here) > PATROL_ARRIVED || here.level !== FIELD_LEVEL) {
        return PATROL_RING[nearest];
    }
    for (let step = 1; step <= PATROL_RING.length; step++) {
        const candidate = PATROL_RING[(nearest + step) % PATROL_RING.length];
        if (candidate.distanceTo(here) > PATROL_ARRIVED) {
            return candidate;
        }
    }
    return PATROL_RING[nearest];
}

function wantedBeadIds(): Set<number> {
    return new Set(IMP_BEADS.filter(bead => Inventory.countById(bead.id) === 0).map(bead => bead.id));
}

interface FieldTarget {
    tile: { x: number; z: number; level: number };
    distance: number;
}

export interface ImpCandidate extends FieldTarget {
    index: number;
    contested: boolean;
}

type Reachable = (tile: { x: number; z: number; level: number }) => boolean;

// Why: an imp teleports up to 20 tiles on its own timer, which lands some of them and their drops on the volcano, where every walk answers "unreachable" and costs the step its budget.

/** The closest candidate the scene can path to, skipping the nearer ones it cannot. */
export function nearestReachable<T extends FieldTarget>(candidates: readonly T[], reachable: Reachable): T | null {
    return [...candidates].sort((a, b) => a.distance - b.distance).find(item => reachable(item.tile)) ?? null;
}

/** The nearest imp in the field that nobody else is fighting and the scene can path to. */
export function pickImp<T extends ImpCandidate>(candidates: readonly T[], reachable: Reachable): T | null {
    return nearestReachable(candidates.filter(imp => inField(imp.tile) && !imp.contested), reachable);
}

interface ImpCensus {
    scene: number;
    inField: number;
    free: number;
    reachable: number;
}

// Why: "no imp in the scene" cannot tell an empty scene from a filter eating every candidate, and those have different fixes.

// Why: zero imps in the scene reads the same whether the spawns are dead or the zone never streamed, and the neighbours tell those apart.

/** NPC names in the scene, counted, most numerous first. */
export function tallyNames(names: readonly (string | null)[]): string {
    if (names.length === 0) {
        return 'nothing';
    }
    const counts = new Map<string, number>();
    for (const name of names) {
        const key = name ?? '?';
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
        .sort(([aName, aCount], [bName, bCount]) => bCount - aCount || aName.localeCompare(bName))
        .map(([name, count]) => (count > 1 ? `${name} x${count}` : name))
        .join(', ');
}

/** How many imps survive each filter, for the log line when none does. */
export function impCensus(candidates: readonly ImpCandidate[], reachable: Reachable): ImpCensus {
    const inside = candidates.filter(imp => inField(imp.tile));
    const free = inside.filter(imp => !imp.contested);
    return {
        scene: candidates.length,
        inField: inside.length,
        free: free.length,
        reachable: free.filter(imp => reachable(imp.tile)).length
    };
}

function sceneReachable(tile: { x: number; z: number; level: number }): boolean {
    return Reachability.canReach(tile, { adjacentOk: true, maxSteps: REACH_STEPS });
}

function beadOnGround(wanted: Set<number>): GroundItem | null {
    const drops = GroundItems.query().where(item => wanted.has(item.id)).action('Take').within(BEAD_RADIUS).results();
    return nearestReachable(drops.map(drop => ({ item: drop, tile: drop.tile(), distance: drop.distance() })), sceneReachable)?.item ?? null;
}

function impCandidates(): (ImpCandidate & { item: Npc })[] {
    return Npcs.query().name(IMP).action('Attack').within(SEARCH_RADIUS).results().map(npc => ({
        item: npc,
        index: npc.index,
        tile: npc.tile(),
        distance: npc.distance(),
        contested: npc.targetsAnotherPlayer()
    }));
}

async function takeBead(bead: GroundItem, log: (m: string) => void): Promise<boolean> {
    if (Inventory.free() === 0) {
        log('the pack is full, so a dropped bead cannot be taken');
        return false;
    }
    const id = bead.id;
    const where = bead.tile();
    if (bead.distance() > 1 && !(await Traversal.walkResilient(where, { radius: 1, attempts: 2, timeoutMs: 60_000, log }))) {
        return false;
    }
    const drop = GroundItems.query().where(item => item.id === id).action('Take').within(BEAD_RADIUS).nearest();
    if (!drop) {
        log(`the ${bead.name ?? id} at (${where.x},${where.z}) was taken by someone else`);
        return false;
    }
    const before = Inventory.countById(id);
    if (!(await drop.interact('Take'))) {
        return false;
    }
    const took = await Execution.delayUntil(() => Inventory.countById(id) > before, TAKE_MS);
    if (took) {
        log(`picked up ${drop.name ?? id}`);
    }
    return took;
}

async function killImp(imp: Npc, log: (m: string) => void): Promise<boolean> {
    const index = imp.index;
    const live = (): Npc | null => Npcs.all().find(npc => npc.index === index && npc.name === IMP) ?? null;

    if (imp.distance() > ENGAGE_RADIUS && !(await Traversal.walkResilient(imp.tile(), { radius: 2, attempts: 2, timeoutMs: 90_000, log }))) {
        return false;
    }
    const target = live();
    if (!target) {
        return false;
    }
    if (!(await target.interact('Attack'))) {
        log(`Attack on imp ${index} was rejected`);
        return false;
    }

    // Why: `ai_queue2,imp` rolls a 1-in-10 teleport on every hit the imp survives, so a fight that stops making progress is the normal case and not a stuck step.
    const deadline = performance.now() + KILL_MS;
    while (performance.now() < deadline) {
        await Sustain.run();
        if (EventSignal.pending()) {
            return false;
        }
        const npc = live();
        if (!npc) {
            log(`imp ${index} died`);
            return true;
        }
        if (npc.distance() > LOST_RADIUS) {
            log(`imp ${index} teleported out of the fight`);
            return false;
        }
        if (npc.targetsAnotherPlayer()) {
            log(`imp ${index} was taken over by another player`);
            return false;
        }
        await Execution.delayTicks(1);
    }
    log(`imp ${index} outlived ${KILL_MS / 1000}s of combat`);
    return false;
}

// Why: walking the ring is the respawn wait — the volcano blocks the middle, so standing still watches one arc of it and the far spawns are never seen.
async function patrolRing(census: ImpCensus, log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    const neighbours = census.scene === 0
        ? ` · scene holds ${tallyNames(Npcs.query().within(SEARCH_RADIUS).results().map(npc => npc.name))}`
        : '';
    const seen = `no imp to fight within ${SEARCH_RADIUS} tiles`
        + ` (${census.scene} in scene, ${census.inField} in the field, ${census.free} free, ${census.reachable} reachable)${neighbours}`;

    if (here && inField(here)) {
        log(`${seen} — holding ${RESPAWN_HOLD_MS / 1000}s for a respawn`);
        const appeared = await Execution.delayUntil(
            () => pickImp(impCandidates(), sceneReachable) !== null || EventSignal.pending(),
            RESPAWN_HOLD_MS
        );
        if (appeared && !EventSignal.pending()) {
            return true;
        }
    }
    const target = nextPatrolTarget(here);
    log(`${seen} — walking the volcano ring to (${target.x},${target.z})`);
    return Traversal.walkResilient(target, { radius: 2, attempts: 3, timeoutMs: BOAT_WALK_MS, log });
}

/** One unit of bead farming: take a drop, kill an imp, or close on the field. */
async function farmBeads(log: (m: string) => void): Promise<boolean> {
    const wanted = wantedBeadIds();
    if (wanted.size === 0) {
        return true;
    }
    const bead = beadOnGround(wanted);
    if (bead) {
        return takeBead(bead, log);
    }
    const candidates = impCandidates();
    const imp = pickImp(candidates, sceneReachable);
    if (imp) {
        return killImp(imp.item, log);
    }
    return patrolRing(impCensus(candidates, sceneReachable), log);
}

function onKaramja(tile: QuestSnapshot['tile']): boolean {
    return tile !== null && tile !== undefined
        && tile.x >= KARAMJA.minX && tile.x <= KARAMJA.maxX
        && tile.z >= KARAMJA.minZ && tile.z <= KARAMJA.maxZ;
}

const BEAD_IDS: readonly number[] = IMP_BEADS.map(bead => bead.id);

export function gatherBead(snap: QuestSnapshot): QuestStep {
    const missing = missingBeads(snap);
    if (missing.length === 0) {
        return { kind: 'wait', reason: 'every bead is already held' };
    }
    // Why: an unread bank is not an empty bank, and a bead banked by an earlier run is 50 imp kills cheaper than another farm.
    if (!snap.bankKnown) {
        return { kind: 'scanBank', bank: DRAYNOR_BANK };
    }
    if (snap.freeSlots !== undefined && snap.freeSlots < missing.length) {
        return { kind: 'deposit', keep: ['coins'], keepIds: BEAD_IDS, bank: DRAYNOR_BANK, exactKeep: true };
    }
    const banked = missing.filter(bead => bankedCount(snap, bead) > 0);
    if (banked.length > 0) {
        return {
            kind: 'withdraw',
            items: banked.map(bead => ({ name: bead.name, id: bead.id, qty: 1 })),
            bank: DRAYNOR_BANK
        };
    }
    // Why: the fare is fetched before boarding and never from the island, as a top-up on Karamja sails home for the coins it has spent and never kills an imp.
    const coins = snap.inv.get('coins') ?? 0;
    if (coins < COIN_FLOOR && !onKaramja(snap.tile) && snap.bankCoins > 0) {
        return {
            kind: 'withdraw',
            items: [{ name: 'Coins', qty: Math.min(COIN_RESERVE - coins, snap.bankCoins) }],
            bank: DRAYNOR_BANK
        };
    }
    return {
        kind: 'custom',
        name: `kill imps for ${missing.map(bead => bead.name).join(', ')}`,
        run: farmBeads
    };
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') {
        return { kind: 'done' };
    }
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    if (snap.journal === 'notStarted') {
        return { kind: 'talk', stop: MIZGOG };
    }
    if (missingBeads(snap).length > 0) {
        return gatherBead(snap);
    }
    return { kind: 'talk', stop: MIZGOG };
}

export const impcatcher: QuestModule = {
    record: QUESTS.find(record => record.id === 'imp')!,
    bank: DRAYNOR_BANK,
    // Why: the engine restores its coin float on every provisioning tick, which turns the ship's 30-coin fare into a round trip across the sea and never kills an imp.
    ownsInventory: true,
    grind: [IMP],
    gather: Object.fromEntries(IMP_BEADS.map(bead => [bead.name.toLowerCase(), gatherBead])),
    decide
};
